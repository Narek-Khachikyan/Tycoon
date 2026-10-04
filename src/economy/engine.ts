import { CATALOG, LAST_GENERATION, MODEL_BY_ID, type Model } from './catalog';
import type { LabId } from '../data/labs';
import { perkEffects, PERK_BY_ID, START_TOKENS_UNITS, GEN_PERK_MAX_TOTAL, genPerkCost, genPerkGeneration, isGenPerkId, type PerkEffect } from './perks';
import type { GameState } from './state';
import {
  clickUpgradeId,
  CLICK_UPGRADES,
  isUpgradeUnlocked,
  labAgents,
  modelUpgradeId,
  MODEL_TIERS,
  PAIR_SYNERGY_MULT,
  SYNERGY_MIN_AGENTS,
  SYNERGY_PER_AGENT,
  synergyUpgradeId,
  UPGRADE_BY_ID,
  UPGRADES_BY_GEN,
} from './upgrades';

export const PRICE_GROWTH = 1.15;
export const SELL_REFUND = 0.25;
export const COMPUTE_BONUS = 0.01;
export const PRESTIGE_DIVISOR_UNITS = 1e5;
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

export function globalMult(state: GameState): number {
  return 1 + state.compute * COMPUTE_BONUS;
}

export function modelIncome(state: GameState, model: Model): number {
  const n = state.agents[model.id] ?? 0;
  if (!n) return 0;
  let mult = 1;
  for (let t = 0; t < MODEL_TIERS.length; t++) {
    if (state.upgrades.includes(modelUpgradeId(model.id, t))) mult *= 2;
  }
  if (state.upgrades.includes(synergyUpgradeId(state.generation, model.lab))) {
    mult *= 1 + SYNERGY_PER_AGENT * labAgents(state, model.lab);
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
  for (const e of perkEffects(state.perks)) {
    if (e.kind === 'labBoost' && e.lab === model.lab) mult *= e.mult;
  }
  // Особый Перк усиливает только Модели своего Поколения и одинаково все его ранги,
  // поэтому ранговая лестница внутри Поколения не инвертируется по построению.
  mult *= generationBoostMult(perkEffects(state.perks), model.generation);
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

export function totalIncome(state: GameState): number {
  return CATALOG[state.generation].models.reduce((s, m) => s + modelIncome(state, m), 0);
}

/**
 * На сколько вырос бы общий Доход от покупки `n` Агентов Модели.
 *
 * Ответ собирается тем же `totalIncome`, что и тик: покупка подставляется в состояние, Доход
 * пересчитывается, подпись — разница. Отдельная формула разошлась бы с настоящей экономикой на
 * первом же Перке или Синергии, то есть ровно там, где подпись в магазине нужнее всего.
 *
 * Кошелёк не спрашивается намеренно: вопрос «на сколько вырастет, если купить» и вопрос «хватает
 * ли сейчас» — разные, и магазин показывает оба.
 */
export function incomeGain(state: GameState, modelId: string, n: number): number {
  if (n <= 0) return 0;
  const model = MODEL_BY_ID[modelId];
  if (!model || model.generation !== state.generation) return 0;
  const hired: GameState = {
    ...state,
    agents: { ...state.agents, [modelId]: (state.agents[modelId] ?? 0) + n },
  };
  return totalIncome(hired) - totalIncome(state);
}

/** Доход Лаборатории: сумма Дохода её Моделей. Каждая Модель принадлежит ровно одной
 *  Лаборатории, поэтому доли всех Лабораторий в сумме дают единицу. */
function labIncome(state: GameState, lab: LabId): number {
  return CATALOG[state.generation].models
    .filter((m) => m.lab === lab)
    .reduce((s, m) => s + modelIncome(state, m), 0);
}

/** Доля Лаборатории в общем Доходе. Пока Агентов нет, общий Доход нулевой, и деление
 *  выдало бы NaN прямо на экране, поэтому такая Лаборатория читается как ноль. */
export function labIncomeShare(state: GameState, lab: LabId): number {
  const total = totalIncome(state);
  return total === 0 ? 0 : labIncome(state, lab) / total;
}

export function clickValue(state: GameState, income = totalIncome(state)): number {
  const gen = state.generation;
  let flat = CATALOG[gen].scale;
  let pct = 0;
  CLICK_UPGRADES.forEach((c, i) => {
    if (!state.upgrades.includes(clickUpgradeId(gen, i))) return;
    if (c.kind === 'x2') flat *= 2;
    else pct += 0.01;
  });
  for (const e of perkEffects(state.perks)) if (e.kind === 'clickMult') flat *= e.mult;
  return flat * globalMult(state) + income * pct;
}

export function autoclicksPerSecond(state: GameState): number {
  return perkEffects(state.perks).reduce((s, e) => (e.kind === 'autoclick' ? s + e.perSecond : s), 0);
}

// ---------- Действия ----------

const earn = (state: GameState, amount: number): GameState => ({
  ...state,
  tokens: state.tokens + amount,
  runTokens: state.runTokens + amount,
  totalTokens: state.totalTokens + amount,
});

export function click(state: GameState): GameState {
  const s = earn(state, clickValue(state));
  return { ...s, clicks: s.clicks + 1, runClicks: s.runClicks + 1 };
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

/** Продвигает игру на `dt` секунд (Доход + автоклик). */
export function advance(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  const income = totalIncome(state);
  const autoClicks = autoclicksPerSecond(state) * dt;
  const auto = autoClicks * clickValue(state, income);
  const s = earn(state, income * dt + auto);
  return {
    ...s,
    // Автоклики — обычные клики: они тоже должны попадать в статистику и Достижения.
    clicks: s.clicks + autoClicks,
    runClicks: s.runClicks + autoClicks,
    // lastTick обязано двигаться вместе с доходом, иначе applyOffline
    // повторно начислит уже обработанный активный интервал.
    lastTick: state.lastTick + dt * 1000,
  };
}

export function offlineCapHours(state: GameState): number {
  return perkEffects(state.perks).reduce(
    (h, e) => (e.kind === 'offlineCap' ? Math.max(h, e.hours) : h),
    BASE_OFFLINE_HOURS,
  );
}

/** Начисляет Оффлайн-доход за время с `lastTick` до `now`, с лимитом. */
export function applyOffline(state: GameState, now: number): { state: GameState; seconds: number; earned: number } {
  const raw = Math.max(0, (now - state.lastTick) / 1000);
  const seconds = Math.min(raw, offlineCapHours(state) * 3600);
  const earned = totalIncome(state) * seconds;
  const s = earn(state, earned);
  return { state: { ...s, lastTick: now }, seconds, earned };
}

/**
 * Продвигает состояние на `dt` секунд игрового цикла.
 *
 * Пауза длиннее OFFLINE_THRESHOLD_SEC (фоновая вкладка, сон, переключение окон)
 * идёт через applyOffline: иначе один тик начислил бы весь простой без лимита
 * и обошёл cap оффлайна. applyOffline заодно приводит lastTick к текущему времени,
 * поэтому простой нельзя «доначислить» повторно при следующей перезагрузке.
 */
export function advanceTime(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  if (dt < OFFLINE_THRESHOLD_SEC) return advance(state, dt);
  return applyOffline(state, state.lastTick + dt * 1000).state;
}

// ---------- Престиж ----------
export function canPrestige(state: GameState): boolean {
  return (state.agents[CATALOG[state.generation].flagship.id] ?? 0) >= 1;
}

export function prestigeGain(state: GameState): number {
  const divisor = PRESTIGE_DIVISOR_UNITS * CATALOG[state.generation].scale;
  return Math.floor(Math.cbrt(state.runTokens / divisor));
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
    runStartedAt: now,
    lastTick: now,
  };
}
