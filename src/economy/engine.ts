import { CATALOG, computeGain, LAST_GENERATION, MODEL_BY_ID, prestigeDivisor, type Model } from './catalog';
import type { LabId } from '../data/labs';
import { collectCrystals, crystalIncomeMult } from './crystal';
import {
  applyOverheat,
  clampTemp,
  HALLUC_HEAT,
  HALLUC_LOSS,
  HEAT_LIMIT,
  heatRate,
  halluRate,
  thermalRead,
} from './thermal';
import { perkEffects, PERK_BY_ID, START_TOKENS_UNITS, GEN_PERK_MAX_TOTAL, genPerkCost, genPerkGeneration, isGenPerkId, type PerkEffect } from './perks';
import type { GameState } from './state';
import { nonShadowCount } from './achievements';
import {
  catchUpClick,
  clickMultiplierFor,
  downtimeIncomeMult,
  eventMultiplierFor,
  isDowntime,
  isEventActive,
  pickEventWindow,
  pickSurgeModel,
  rollEventKind,
  surgeMultFor,
} from './events';
import {
  advanceGlitches,
  covenantIncomeMult,
  glitchDrainMult,
  isPledgeActive,
  redEventChance,
  stepGlitches,
} from './glitches';
import {
  ASSIST2_MULT,
  ASSIST_PER_AGENT,
  assistUpgradeId,
  clickUpgradeId,
  CLICK_UPGRADES,
  DATASET_PER_ACHIEVEMENT,
  DATASET_PER_DATASET,
  DATASET_THRESHOLDS,
  datasetUpgradeId,
  flagshipUpgradeId,
  FLAGSHIP_MULT_CAP,
  FLAGSHIP_PER_JUNIOR,
  isUpgradeUnlocked,
  juniorAgents,
  labAgents,
  labFlagship,
  modelUpgradeId,
  MODEL_TIERS,
  PAIR_SYNERGY_MULT,
  SYNERGY_MIN_AGENTS,
  SYNERGY_PER_AGENT,
  synergyUpgradeId,
  totalAgents,
  UPGRADE_BY_ID,
  UPGRADES_BY_GEN,
} from './upgrades';

export const PRICE_GROWTH = 1.15;
export const SELL_REFUND = 0.25;
export const COMPUTE_BONUS = 0.01;
export const BASE_OFFLINE_HOURS = 8;

/** Пауза длиннее этого порога считается оффлайном (вкладка в фоне или сон). */
export const OFFLINE_THRESHOLD_SEC = 10;

// ---------- Цены ----------

export function discountMult(state: GameState): number {
  return perkEffects(state.perks).reduce((m, e) => (e.kind === 'discount' ? m * (1 - e.pct) : m), 1);
}

/** Цена следующих `n` Агентов при `owned` уже купленных. */
export function bulkCost(model: Model, owned: number, n: number, discount = 1): number {
  const r = PRICE_GROWTH;
  return model.baseCost * discount * Math.pow(r, owned) * ((Math.pow(r, n) - 1) / (r - 1));
}

export function maxAffordable(model: Model, owned: number, tokens: number, discount = 1): number {
  const r = PRICE_GROWTH;
  const first = model.baseCost * discount * Math.pow(r, owned);
  if (tokens < first) return 0;
  return Math.floor(Math.log((tokens * (r - 1)) / first + 1) / Math.log(r));
}

export function sellRefund(model: Model, owned: number, n: number, discount = 1): number {
  const k = Math.min(n, owned);
  return bulkCost(model, owned - k, k, discount) * SELL_REFUND;
}

/**
 * Сколько Токенов не хватает до покупки: цена минус кошелёк, но не ниже нуля.
 *
 * Живёт здесь, а не в компоненте, потому что это деньги — цена и кошелёк числа движка, и
 * магазин не должен вычитать их сам. Ноль означает «хватает»: отрицательный дефицит показал бы
 * игроку, что он богаче, чем нужно.
 */
export function shortfall(cost: number, tokens: number): number {
  return Math.max(0, cost - tokens);
}

/**
 * Цена ближайшей покупки Агента: минимум цены одного Агента по всем Моделям текущего
 * Поколения. Живёт здесь, а не в компоненте, потому что это деньги — цена считается
 * движком через bulkCost со скидкой, и компонент не должен складывать её сам.
 */
export function nextAgentCost(state: GameState): number {
  const d = discountMult(state);
  let min = Infinity;
  for (const m of CATALOG[state.generation].models) {
    const cost = bulkCost(m, state.agents[m.id] ?? 0, 1, d);
    if (cost < min) min = cost;
  }
  return min === Infinity ? 0 : min;
}

/**
 * Доля `[0, 1]` того, сколько Токенов ещё не хватает до следующего Агента `model`:
 * `0` — Агент доступен прямо сейчас, `1` — не хватает всего.
 *
 * Не то же самое, что `nextAgentCost`: там минимальная цена по Поколению для одной строки
 * «сколько не хватает», здесь доля по конкретной Модели, чтобы полоса цели была у каждой
 * карточки своей. Обе величины считаются через `bulkCost` со скидкой, иначе полоса и кнопка
 * покупки разошлись бы по цене.
 *
 * Верхняя граница защищает долю от Токенов ниже нуля, которые `migrate` из повреждённого
 * сохранения не отсекает.
 */
export function progressToNextAgent(state: GameState, model: Model): number {
  const cost = bulkCost(model, state.agents[model.id] ?? 0, 1, discountMult(state));
  if (state.tokens >= cost) return 0;
  return Math.min(1, 1 - state.tokens / cost);
}

// ---------- Доход ----------

/**
 * Постоянный множитель Дохода: Compute, запас кристаллов и налог за «Лицензию».
 *
 * Все три живут в состоянии и длятся забег, поэтому они достаются и оффлайн-доходу — в отличие
 * от событий и Глюков, которые живут минуты и в него не попадают вовсе.
 *
 * Температура сюда НЕ входит, хотя она тоже переживает забег: её множитель читает `now`, потому
 * что оглушение после перегрева идёт по стенным часам, а `globalMult` вызывается в том числе
 * из `offlineIncome`, где часов нет. Температура поэтому стоит в `incomeRate` рядом с событием —
 * то есть платит активному тику и не платит оффлайн-доходу.
 */
export function globalMult(state: GameState): number {
  return (1 + state.compute * COMPUTE_BONUS) * crystalIncomeMult(state) * covenantIncomeMult(state);
}

/**
 * Множитель флагмана Лаборатории от младших Агентов: 1 + 0.02 × младшие.
 * Возвращает 1 для не-флагманов и без купленного `f:<gen>:<lab>`, поэтому
 * modelIncome может умножать безусловно, не ветвясь на виде Модели.
 */
export function flagshipMult(state: GameState, model: Model): number {
  const gen = CATALOG[state.generation];
  const flag = labFlagship(gen, model.lab);
  if (!flag || flag.id !== model.id) return 1;
  if (!state.upgrades.includes(flagshipUpgradeId(state.generation, model.lab))) return 1;
  return Math.min(1 + FLAGSHIP_PER_JUNIOR * juniorAgents(state, model.lab), FLAGSHIP_MULT_CAP);
}

/** Базовый Датасет: 0.05 за каждое НЕтеневое Достижение; переживает Престиж вместе с achievements. */
export function datasetValue(state: GameState): number {
  return DATASET_PER_ACHIEVEMENT * nonShadowCount(state);
}

/**
 * Множитель Датасета: произведение по купленным `d:<gen>:<i>` текущего Поколения,
 * каждый ×(1 + dataset × 0.10). Сомножители одинаковы, поэтому степень вместо цикла.
 * Без купленных Датасетов — 1, и старые Поколения в зачёт не идут.
 *
 * Считается по id каждого тира, а не перебором всех купленных Апгрейдов: эта функция зовётся на
 * каждую Модель в тике, и проход по длинному списку Апгрейдов двадцать раз в секунду обходился
 * дороже самой Модели. Число тиров — длина DATASET_THRESHOLDS, то есть ровно те id, которые
 * таблица и создаёт.
 */
export function datasetMult(state: GameState): number {
  let owned = 0;
  for (let tier = 0; tier < DATASET_THRESHOLDS.length; tier++) {
    if (state.upgrades.includes(datasetUpgradeId(state.generation, tier))) owned++;
  }
  if (owned === 0) return 1;
  return Math.pow(1 + datasetValue(state) * DATASET_PER_DATASET, owned);
}

/** Flat-бонус Агентов-ассистентов для Клика: 0.1 × масштаб за Агента, ×5 со вторым. */
export function assistClickBonus(state: GameState): number {
  if (!state.upgrades.includes(assistUpgradeId(state.generation, 1))) return 0;
  let bonus = ASSIST_PER_AGENT * CATALOG[state.generation].scale * totalAgents(state);
  if (state.upgrades.includes(assistUpgradeId(state.generation, 2))) bonus *= ASSIST2_MULT;
  return bonus;
}

/**
 * Доход Модели от постоянных множителей: Апгрейды, Синергия Лаборатории, парная Синергия,
 * флагман, Перки (включая особые), Датасет и Compute.
 *
 * Без события и без «Прорыва»: это и есть база, из которой платится и активный тик, и
 * оффлайн-доход. Часы здесь не нужны — ни один из этих множителей не зависит от времени.
 */
function modelBaseIncome(state: GameState, model: Model, thermal: number = 1): number {
  const n = state.agents[model.id] ?? 0;
  if (!n) return 0;
  // Температура идёт ПЕРВЫМ множителем и до всех остальных: жар должен поднимать ровно тот
  // Доход, который игрок видит в строке «+N / сек», а не базовый с множителем поверх — иначе
  // перегрев резал бы невидимую часть, и полоса на шкале врала бы.
  let mult = thermal;
  for (let t = 0; t < MODEL_TIERS.length; t++) {
    if (state.upgrades.includes(modelUpgradeId(model.id, t))) mult *= 2;
  }
  if (state.upgrades.includes(synergyUpgradeId(state.generation, model.lab))) {
    mult *= 1 + SYNERGY_PER_AGENT * labAgents(state, model.lab);
  }
  mult *= flagshipMult(state, model);
  for (const e of perkEffects(state.perks)) {
    if (e.kind === 'labBoost' && e.lab === model.lab) mult *= e.mult;
  }
  // Парная синергия проверяет состав live, а не только в момент покупки: продажа Агентов
  // ниже 15/15 гасит ×1.5 сразу, а запись о покупке остаётся и оживает при новом найме.
  // Перебор идёт по парам текущего Поколения (их ≤3), а не по купленным id, поэтому
  // чужой id из повреждённого сохранения бафф дать не может.
  for (const u of UPGRADES_BY_GEN[state.generation]) {
    if (u.kind !== 'synergy' || u.pairLab === undefined) continue;
    if (u.lab !== model.lab && u.pairLab !== model.lab) continue;
    if (!state.upgrades.includes(u.id)) continue;
    if (labAgents(state, u.lab) >= SYNERGY_MIN_AGENTS && labAgents(state, u.pairLab) >= SYNERGY_MIN_AGENTS) {
      mult *= PAIR_SYNERGY_MULT;
    }
  }
  // Особый Перк усиливает только Модели своего Поколения и одинаково все его ранги,
  // поэтому ранговая лестница внутри Поколения не инвертируется по построению.
  mult *= generationBoostMult(perkEffects(state.perks), model.generation);
  // Датасет — последний множитель Модели: он считается от числа Достижений, а не от
  // конкретной Модели, поэтому ни один множитель выше не должен стоять после него.
  mult *= datasetMult(state);
  return model.baseIncome * n * mult * globalMult(state);
}

/**
 * Множитель особых Перков для Поколения `generation`: сумма бонусов только своих
 * Перков, но не больше хард-капа. Кап держит инвариант прогрессии: даже в пределе
 * бонус не дотягивает Поколение до следующего (масштаб ×1000 на Поколение).
 */
export function generationBoostMult(effects: PerkEffect[], generation: number): number {
  const total = effects.reduce(
    (s, e) => (e.kind === 'generationBoost' && e.generation === generation ? s + e.pct : s),
    0,
  );
  return 1 + Math.min(total, GEN_PERK_MAX_TOTAL);
}

/**
 * Доход Модели в активном тике: к постоянным множителям добавляется «Прорыв», и только он.
 *
 * Время приходит по умолчанию из `lastTick` — тем же самым, каким идёт тик, — поэтому подпись в
 * магазине и начисление считают один и тот же Доход, не протаскивая часы через каждую подпись.
 */
export function modelIncome(state: GameState, model: Model, now: number = state.lastTick): number {
  return modelBaseIncome(state, model) * surgeMultFor(state, model.id, now);
}

/**
 * Постоянный Доход Моделей Поколения — тот, что не зависит от того, что происходит прямо сейчас.
 *
 * Из него платится оффлайн-доход и возврат за Клик: оба обязаны считать заработок до «Ночного
 * кодинга» и без живых Глюков, поэтому и берут одну и ту же сумму.
 */
function baseIncome(state: GameState, thermal: number = 1): number {
  return CATALOG[state.generation].models.reduce((s, m) => s + modelBaseIncome(state, m, thermal), 0);
}

/**
 * Доход секунды, который платит активный тик, — до Глюков и до их множителя.
 *
 * Именно без множителя Глюков: тем же числом считается их укус, иначе каждый следующий вор
 * крал бы уже урезанное число, а десять Глюков отнимали бы больше половины.
 */
function incomeRate(state: GameState, now: number): number {
  const total = CATALOG[state.generation].models.reduce((s, m) => s + modelIncome(state, m, now), 0);
  return total * eventMultiplierFor(state, now) * downtimeIncomeMult(state, now) * thermalRead(state, now).mult;
}

/** Доход активного тика: то, что платит база, событие и живые Глюки. */
export function totalIncome(state: GameState, now: number = state.lastTick): number {
  return incomeRate(state, now) * glitchDrainMult(state);
}

/**
 * Доход, из которого платится Оффлайн-доход.
 *
 * Отдельное имя, а не флаг у totalIncome, потому что вызывающий не должен решать, честно ли
 * платить за простое: единственный источник истины здесь — тот факт, что ни событие, ни «Прорыв»,
 * ни Глюки в baseIncome не попадают. Читает она тот же счёт, что и тик, поэтому расхождение между
 * активной и оффлайновой скоростью бывает ровно одно — доля Перка.
 */
export function offlineIncome(state: GameState): number {
  return baseIncome(state);
}

/**
 * На сколько вырос бы общий Доход от покупки `n` Агентов Модели.
 *
 * Ответ собирается тем же `totalIncome`, что и тик: покупка подставляется в состояние, Доход
 * пересчитывается, подпись — разница. Часы те же, что и у тика, — из `lastTick`, поэтому подпись
 * в магазине совпадает с тем, что покажет Доход после покупки. Отдельная формула разошлась бы с
 * настоящей экономикой на первом же Перке, Синергии или событии, то есть ровно там, где подпись в
 * магазине нужнее всего.
 *
 * Кошелёк не спрашивается намеренно: вопрос «на сколько вырастет, если купить» и вопрос «хватает
 * ли сейчас» — разные, и магазин показывает оба.
 */
export function incomeGain(state: GameState, modelId: string, n: number, now: number = state.lastTick): number {
  if (n <= 0) return 0;
  const model = MODEL_BY_ID[modelId];
  if (!model || model.generation !== state.generation) return 0;
  const hired: GameState = {
    ...state,
    agents: { ...state.agents, [modelId]: (state.agents[modelId] ?? 0) + n },
  };
  return totalIncome(hired, now) - totalIncome(state, now);
}

/** Доход Лаборатории: сумма Дохода её Моделей. Каждая Модель принадлежит ровно одной
 *  Лаборатории, поэтому доли всех Лабораторий в сумме дают единицу. */
function labIncome(state: GameState, lab: LabId, now: number): number {
  return CATALOG[state.generation].models
    .filter((m) => m.lab === lab)
    .reduce((s, m) => s + modelIncome(state, m, now), 0);
}

/** Доля Лаборатории в общем Доходе. Пока Агентов нет, общий Доход нулевой, и деление
 *  выдало бы NaN прямо на экране, поэтому такая Лаборатория читается как ноль. */
export function labIncomeShare(state: GameState, lab: LabId): number {
  const now = state.lastTick;
  const total = totalIncome(state, now);
  return total === 0 ? 0 : labIncome(state, lab, now) / total;
}

export function clickValue(state: GameState, income = totalIncome(state), now: number = state.lastTick): number {
  const gen = state.generation;
  // Клик стартует с масштаба Поколения, а не с 1: в Поколении 0 это 1, а дальше ×1000, и
  // без этого клик перестал бы что-то значить ровно там, где Доход уже измеряется триллионами.
  let flat = CATALOG[gen].scale;
  let pct = 0;
  CLICK_UPGRADES.forEach((c, i) => {
    if (!state.upgrades.includes(clickUpgradeId(gen, i))) return;
    if (c.kind === 'x2') flat *= 2;
    else pct += 0.01;
  });
  flat += assistClickBonus(state);
  for (const e of perkEffects(state.perks)) if (e.kind === 'clickMult') flat *= e.mult;
  // Датасет множит только flat-часть: pct-часть уже содержит его через income.
  flat *= datasetMult(state);
  return clickMultiplierFor(state, now) * (flat * globalMult(state) + income * pct + clickCatchUp(state, now));
}

/**
 * Сколько Токенов вернёт ОДИН Клик за окно «Ночного кодинга», 0 когда окна нет.
 *
 * Возврат считается от скорости ДО глушения окна: глушение и есть то, что Клик возвращает, поэтому
 * из заглушенной скорости он вышел бы нулём. Скорость приходит от того же `baseIncome`, из
 * которого платится оффлайн-доход, а множитель события — из его же таблицы.
 *
 * Проверка окна стоит перед счётом скорости, а не после: вне окна возврат нулевой, и лишний проход
 * по Моделям на каждом Клике и на каждом тике с автокликом не нужен.
 */
function clickCatchUp(state: GameState, now: number): number {
  return isDowntime(state, now) ? catchUpClick(state, baseIncome(state) * eventMultiplierFor(state, now), now) : 0;
}

export function autoclicksPerSecond(state: GameState): number {
  return perkEffects(state.perks).reduce((s, e) => (e.kind === 'autoclick' ? s + e.perSecond : s), 0);
}

// ---------- Действия ----------

/**
 * Начисляет Токены во все три счётчика сразу: кошелёк, забег и всё время игры.
 *
 * Публичный, потому что разовые выплаты приходят суммой извне — «Грант», «Крах», лопнувший Глюк,
 * «Лицензия» — и каждая из них обязана попасть в те же три числа, что и обычный доход. Нулевая
 * сумма не меняет ничего и возвращает тот же объект.
 */
export function earnTokens(state: GameState, amount: number): GameState {
  if (amount === 0) return state;
  return {
    ...state,
    tokens: state.tokens + amount,
    runTokens: state.runTokens + amount,
    totalTokens: state.totalTokens + amount,
  };
}

export function click(state: GameState): GameState {
  const catchUp = clickCatchUp(state, state.lastTick);
  const s = earnTokens(state, clickValue(state));
  // Котёл возврата уменьшается вместе с выплатой: за окно возвращается его объём один раз, и
  // второй Клик того же окна возвращает уже ноль.
  return { ...s, clicks: s.clicks + 1, runClicks: s.runClicks + 1, catchUpPaid: state.catchUpPaid + catchUp };
}

export function buyAgents(state: GameState, modelId: string, n: number | 'max'): GameState {
  const model = MODEL_BY_ID[modelId];
  if (!model || model.generation !== state.generation) return state;
  const owned = state.agents[modelId] ?? 0;
  const d = discountMult(state);
  const count = n === 'max' ? maxAffordable(model, owned, state.tokens, d) : n;
  if (count <= 0) return state;
  const cost = bulkCost(model, owned, count, d);
  if (cost > state.tokens) return state;
  return { ...state, tokens: state.tokens - cost, agents: { ...state.agents, [modelId]: owned + count } };
}

export function sellAgents(state: GameState, modelId: string, n: number): GameState {
  const model = MODEL_BY_ID[modelId];
  const owned = state.agents[modelId] ?? 0;
  if (!model || owned === 0) return state;
  const k = Math.min(n, owned);
  return {
    ...state,
    tokens: state.tokens + sellRefund(model, owned, k, discountMult(state)),
    agents: { ...state.agents, [modelId]: owned - k },
  };
}

export function buyUpgrade(state: GameState, id: string): GameState {
  const u = UPGRADE_BY_ID[id];
  if (!u || state.upgrades.includes(id) || u.cost > state.tokens || !isUpgradeUnlocked(state, u)) return state;
  return { ...state, tokens: state.tokens - u.cost, upgrades: [...state.upgrades, id] };
}

export function buyPerk(state: GameState, id: string): GameState {
  const p = PERK_BY_ID[id];
  if (!p || state.perks.includes(id)) return state;
  if (isGenPerkId(id)) return buyGenPerk(state, id);
  const free = state.compute - state.computeSpent;
  if (p.cost > free) return state;
  return { ...state, computeSpent: state.computeSpent + p.cost, perks: [...state.perks, id] };
}

/**
 * Покупка особого Перка Поколения. Перк N доступен в Поколении N и позже:
 * упущенный докупается в любом позднем Забеге по той же цене. Флагман
 * (canPrestige) требуется только для перка ТЕКУЩЕГО Поколения — переход
 * дальше уже доказал мастерство прошлого, ведь сам переход требовал флагмана.
 * Цена растёт с числом уже купленных особых (10/15/20…), а не с Поколением,
 * и списывается из свободного Compute как у обычных Перков.
 */
function buyGenPerk(state: GameState, id: string): GameState {
  const generation = genPerkGeneration(id);
  if (generation === null || generation > state.generation) return state;
  // Прошлое Поколение флагман не требует: факт перехода дальше уже доказывает
  // мастерство — Престиж оттуда без флагмана был невозможен.
  if (generation === state.generation && !canPrestige(state)) return state;
  const cost = genPerkCost(state.perks);
  if (cost > state.compute - state.computeSpent) return state;
  return { ...state, computeSpent: state.computeSpent + cost, perks: [...state.perks, id] };
}

// ---------- Время ----------

/**
 * Продвигает игру на `dt` секунд (Доход + автоклик + укус Глюков).
 *
 * Часы берутся из самого состояния и смотрят на КОНЕЦ интервала, а не на его начало: эффект,
 * истёкший в середине тика, не должен заплатить за весь тик. На 50 мс разница мала, но правило
 * должно быть верным, а не приблизительным — иначе граница «эффект истёк ровно в конце окна» дала
 * бы разные числа на тике и на подписи в магазине.
 *
 * Отдельного `now` здесь нет намеренно: тик — единственное место, где интервал известен целиком,
 * а все читатели временных множителей смотрят тот же `lastTick`.
 */
export function advance(state: GameState, dt: number, rnd: () => number = Math.random): GameState {
  if (dt <= 0) return state;
  const now = state.lastTick + dt * 1000;
  const rate = incomeRate(state, now);
  const glitch = glitchDrainMult(state);
  const autoClicks = autoclicksPerSecond(state) * dt;
  // Клик автокликера считается от той же скорости, что и тик, и возвращает «Ночной кодинг» ровно
  // так же, как клик игрока, но объём окна достаётся первому из них: за тик автокликов может быть
  // много, а окно стоит одних 10 с Дохода. Дробный автоклик возвращает долю объёма.
  const catchUp = clickCatchUp(state, now);
  const autoRefund = Math.min(autoClicks, 1) * catchUp;
  const auto = autoClicks > 0 ? autoClicks * (clickValue(state, rate * glitch, now) - catchUp) + autoRefund : 0;
  // Глюки крадут из скорости без их множителя, поэтому десять штук отнимают ровно половину.
  const stepped = stepGlitches(state, rate, dt);
  const s = earnTokens(stepped, rate * glitch * dt + auto);
  // Температура идёт после начисления: перегрев режет уже посчитанную скорость этого тика,
  // а не подменяет её на следующем — иначе игрок, пойманный перегревом, терял бы ещё
  // и тот Доход, который успел заработать до сброса.
  const heated = advanceThermal(s, dt, rnd, now);
  return {
    ...heated,
    // Автоклики — обычные клики: они тоже должны попадать в статистику и Достижения.
    clicks: heated.clicks + autoClicks,
    runClicks: heated.runClicks + autoClicks,
    catchUpPaid: heated.catchUpPaid + autoRefund,
    // lastTick обязано двигаться вместе с доходом, иначе applyOffline
    // повторно начислит уже обработанный активный интервал.
    lastTick: now,
  };
}

/**
 * Галлюцинация: отнимает долю кошелька и наказывает Доход.
 *
 * Штраф к Доходу держится как доля секунды (то есть затухает сам), а не как флаг на третьем
 * поле состояния: иначе её пришлось бы гасить отдельным переходом, который легко забыть
 * вызвать и который завис бы при импорте старого сейва. Здесь всё живёт в `heat` уже
 * существующей шкалы перегрева, то есть переходов не добавляет.
 */
function applyHallucination(state: GameState): GameState {
  // Доля от кошелька с полом, но не ниже единицы Токена: у пустого кошелька галлюцинация
  // не должна ни уходить в минус, ни врать нулевым штрафом — она всё равно жёстче греет.
  const lost = Math.min(Math.max(0, state.tokens), Math.max(1, Math.floor(state.tokens * HALLUC_LOSS)));
  // Галлюцинация — это перегрев, пробитый сквозь жар: она и в полосе, и в Доходе.
  return { ...state, tokens: state.tokens - lost, heat: Math.min(1, state.heat + HALLUC_HEAT) };
}

/**
 * Шаг Температуры за `dt`: копит перегрев, ловит Галлюцинацию, сбрасывает жар при перегреве.
 *
 * Порядок именно такой. Перегрев проверяется ПЕРВЫМ и до Галлюцинации: сброс в ноль должен
 * отменять накопленное, а не наоборот — иначе игрок, пойманный перегревом на границе, терял бы
 * ещё и 4% кошелька за событие, которое тут же началось с нуля.
 */
export function advanceThermal(state: GameState, dt: number, rnd: () => number, now: number): GameState {
  if (dt <= 0) return state;
  const temp = clampTemp(state.temp);
  const heat = Math.min(1, state.heat + heatRate(temp) * dt);
  let next: GameState = { ...state, temp, heat };
  if (next.heat >= HEAT_LIMIT) return applyOverheat(next, now);
  if (rnd() < halluRate(temp) * dt) next = applyHallucination(next);
  return next;
}

/**
 * Окно простоя в часах: максимум из купленных оффлайн-Перков, иначе базовое.
 *
 * Максимум, а не минимум: каждый следующий Перк берёт своё окно, а не режет чужое, поэтому
 * покупка не может сузить то, что уже куплено. Единица здесь честное начало отсчёта в отличие
 * от доли: 24 и 72 часа выше базовых восьми.
 */
export function offlineCapHours(state: GameState): number {
  return perkEffects(state.perks).reduce((h, e) => (e.kind === 'offlineRate' ? Math.max(h, e.hours) : h), BASE_OFFLINE_HOURS);
}

/**
 * Доля Дохода за оффлайн: лучшая из купленных, а без оффлайн-Перков — полный Доход.
 *
 * Единица здесь только дефолт, а не начало отсчёта: первый Перк платит 75%, и максимум от
 * единицы никогда бы к ней не вернулся — то есть Перк с меньшей долей был бы мёртвым по
 * построению. Поэтому сравниваются между собой только купленные доли, а базовые 8 ч и
 * полный Доход остаются стартовой ступенью лестницы, а не её полом.
 */
export function offlineRateMult(state: GameState): number {
  let best = 0;
  for (const e of perkEffects(state.perks)) if (e.kind === 'offlineRate') best = Math.max(best, e.rate);
  return best === 0 ? 1 : best;
}

/** Начисляет Оффлайн-доход за время с `lastTick` до `now`, с лимитом. */
export function applyOffline(state: GameState, now: number): { state: GameState; seconds: number; earned: number } {
  const raw = Math.max(0, (now - state.lastTick) / 1000);
  const seconds = Math.min(raw, offlineCapHours(state) * 3600);
  // Именно offlineIncome, а не totalIncome: временные множители события и Глюков живут минуты,
  // а игрок проводит в простое часы — оплачивать ему их задним числом нельзя. Глюки при этом
  // просто спят (как в Cookie Clicker спят во время отсутствия) и не воруют оффлайн-доход,
  // потому что оффлайн идёт по базовой скорости, а не по их.
  const earned = offlineIncome(state) * seconds * offlineRateMult(state);
  // Зревший за время отсутствия кристалл собирается здесь, а не на первом тике после загрузки:
  // путь загрузки вызывает именно эту функцию, и игрок возвращается к уже готовому отчёту.
  const s = collectCrystals(earnTokens(state, earned), now).state;
  return { state: { ...s, lastTick: now }, seconds, earned };
}

/**
 * События планируются и истекают здесь же, в тике: отдельного таймера у них нет и не должно
 * быть, а окно лежит в состоянии (`nextEventAt`) и потому переживает перезагрузку. Расписание
 * Глюков устроено так же и зовётся рядом — это буквально одна задача, «по расписанию завести
 * сущность», и два её слоя разошлись бы при первой правке пауз.
 *
 * Истёкшее событие остаётся в состоянии до следующего спавна: из него берётся вид, который нельзя
 * повторить подряд, и после перезагрузки этот запрет переживает вместе с записью. Само событие при
 * этом не видно и не платит — `isEventActive` отсекает его по времени.
 */
function advanceEvents(state: GameState, now: number, rnd: () => number): GameState {
  // У нового сохранения окна нет, поэтому первое назначается здесь же: иначе события не было бы
  // никогда.
  if (state.nextEventAt === 0) return { ...state, nextEventAt: now + pickEventWindow(rnd) };
  if (state.nextEventAt > now) return state;
  const event = state.event;
  // Слот события один: живое событие новое не вытесняет, окно просто пропускается.
  if (event && isEventActive(event, now)) return state;
  const kind = rollEventKind(event ? [event.kind] : [], rnd);
  return {
    ...state,
    // Окно переносится на новое, а не остаётся в прошлом: иначе события сыпались бы каждый тик.
    nextEventAt: now + pickEventWindow(rnd),
    eventsSeen: state.eventsSeen + 1,
    // Котёл возврата за Клик принадлежит окну, а не забегу: без обнуления следующее «Ночной кодинг»
    // начал бы с урезанным объёмом и недоплатил бы игроку. Отметка о пойманном окне обнуляется здесь
    // же по той же причине, хотя и сравнивается с началом окна, а не считывается как флаг.
    catchUpPaid: 0,
    eventCaughtAt: 0,
    event: {
      kind,
      startedAt: now,
      red: rollRed(state, now, rnd),
      modelId: kind === 'surge' ? pickSurgeModel(state, rnd) : undefined,
    },
  };
}

/**
 * Красное ли это событие: долю красных задаёт стадия Восстания, а «Лобби» с «Лицензией» глушат
 * красное, не отменяя само событие — как в Cookie Clicker, где во время frenzy печенька всё равно
 * выпадает, просто золотой.
 */
function rollRed(state: GameState, now: number, rnd: () => number): boolean {
  if (rnd() >= redEventChance(state.uprising)) return false;
  return !isPledgeActive(state, now);
}

/**
 * Продвигает состояние на `dt` секунд игрового цикла.
 *
 * Пауза длиннее OFFLINE_THRESHOLD_SEC (фоновая вкладка, сон, переключение окон)
 * идёт через applyOffline: иначе один тик начислил бы весь простой без лимита
 * и обошёл бы cap оффлайна. applyOffline заодно приводит lastTick к текущему времени,
 * поэтому простой нельзя «доначислить» повторно при следующей перезагрузке.
 *
 * События с обеих сторон идут по одному `now`, поэтому окно, пережившее простой, честно истекает
 * на возвращении, а не платит за него задним числом.
 *
 * Кристалл зреет в реальном времени и в простое тоже, поэтому сбор стоит после обоих путей и
 * получает то же `now`, что и начисление: у него нет ни своего таймера, ни своего часа.
 *
 * `rnd` приходит аргументом, а не читается внутри как `Math.random`: розыгрыш событий должен
 * проверяться тестами, не завися от случайности, а вызывающий (стор) его не передаёт вовсе.
 */
export function advanceTime(state: GameState, dt: number, rnd: () => number = Math.random): GameState {
  if (dt <= 0) return state;
  const now = state.lastTick + dt * 1000;
  const moved = dt < OFFLINE_THRESHOLD_SEC ? advance(state, dt, rnd) : applyOffline(state, now).state;
  const scheduled = advanceEvents(moved, now, rnd);
  return collectCrystals(advanceGlitches(scheduled, now, rnd), now).state;
}

// ---------- Престиж ----------
export function canPrestige(state: GameState): boolean {
  return (state.agents[CATALOG[state.generation].flagship.id] ?? 0) >= 1;
}

export function prestigeGain(state: GameState): number {
  return computeGain(state.runTokens, state.generation);
}

/**
 * Сколько Токенов забега не хватает до следующей единицы Compute.
 *
 * Порог — обратная величина к prestigeGain: та отдаёт floor(cbrt(runTokens / divisor)), поэтому
 * минимальный `runTokens`, дающий g + 1, равен ровно (g + 1)³ × divisor. Живёт здесь, а не в
 * интерфейсе, потому что это деньги: и делитель, и кубический корень — числа движка, и копия
 * формулы в компоненте разошлась бы с Престижем при первой же правке баланса.
 *
 * Пока остаток представим, он строго положителен: прирост считается из тех же `runTokens`,
 * поэтому до порога всегда чего-то не хватает. А дальше ~1e50 Токенов в забеге этот остаток уходит
 * под точность double и честно читается как ноль — такой суммы игра не набирает.
 */
export function computeShortfall(state: GameState): number {
  return shortfall(Math.pow(prestigeGain(state) + 1, 3) * prestigeDivisor(state.generation), state.runTokens);
}

export function isContentFinale(state: GameState): boolean {
  return state.generation === LAST_GENERATION && canPrestige(state);
}

export function startingTokens(state: GameState, generation: number): number {
  return perkEffects(state.perks).some((e) => e.kind === 'startTokens')
    ? START_TOKENS_UNITS * CATALOG[generation].scale
    : 0;
}

export interface PrestigePreview {
  /** Compute, который начислит Престиж. */
  gain: number;
  agentsLost: number;
  upgradesLost: number;
  tokensLost: number;
  /** Поколение, в которое игрок перейдёт. */
  generation: number;
  /** Престиж сейчас невозможен: нет Флагмана или это финал контента. */
  blocked: boolean;
}

/**
 * Разбор Престижа для модалки подтверждения: что игрок получит и что сгорит.
 *
 * `gain` — это ровно `prestigeGain(state)`, а не вторая формула: модалка и кнопка
 * обязаны показывать одно число, иначе Compute, начисленный переходом, разойдётся
 * с обещанным. `blocked` повторяет условия отказа самого `prestige` (нет Флагмана
 * либо финал контента), чтобы UI объяснил причину, а не просто погасил кнопку.
 */
export function prestigePreview(state: GameState): PrestigePreview {
  return {
    gain: prestigeGain(state),
    agentsLost: Object.values(state.agents).reduce((s, n) => s + n, 0),
    upgradesLost: state.upgrades.length,
    tokensLost: state.tokens,
    generation: Math.min(state.generation + 1, LAST_GENERATION),
    blocked: !canPrestige(state) || isContentFinale(state),
  };
}

export function prestige(state: GameState, now: number): GameState {
  // На финальном Поколении перехода дальше нет: обнулять забег без нового Поколения нельзя.
  if (!canPrestige(state) || isContentFinale(state)) return state;
  const next = Math.min(state.generation + 1, LAST_GENERATION);
  return {
    ...state,
    generation: next,
    maxGeneration: Math.max(state.maxGeneration, next),
    compute: state.compute + prestigeGain(state),
    prestiges: state.prestiges + 1,
    tokens: startingTokens(state, next),
    runTokens: 0,
    runClicks: 0,
    agents: {},
    upgrades: [],
    // Кристаллы и их ускорители, как и Достижения, переживают Престиж: они растут в реальном
    // времени, и сброс забега не должен отнимать у игрока то, за что он ждал в стену часами.
    runStartedAt: now,
    lastTick: now,
  };
}
