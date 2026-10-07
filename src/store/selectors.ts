import type { Model } from '../economy/catalog';
import type { LabId } from '../data/labs';
import {
  bulkCost,
  canPrestige,
  clickValue,
  discountMult,
  incomeGain,
  isContentFinale,
  labIncomeShare,
  maxAffordable,
  nextAgentCost,
  prestigeGain,
  progressToNextAgent,
  sellRefund,
  shortfall,
  totalIncome,
} from '../economy/engine';
import { crystalCycleMs, crystalIncomeMult, type CrystalUpgrade } from '../economy/crystal';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import {
  canLicense,
  canPledge,
  glitchDrainMult,
  licenseCost,
  LICENSE_INCOME_TAX,
  pledgeCost,
  revokeCost,
} from '../economy/glitches';
import { milestoneHint, milestoneReward, nextMilestone, type Milestone } from '../economy/milestones';
import type { GameState, Glitch } from '../economy/state';
import { TEMP_MAX, thermalRead } from '../economy/thermal';
import { availableUpgrades, type Upgrade } from '../economy/upgrades';
import type { BuyAmount } from './useGameStore';

/**
 * Срезы состояния для компонентов: что именно видит игрок, а не всё, из чего оно считается.
 *
 * Тик идёт двадцать раз в секунду и каждый раз кладёт в стор новый `GameState`: растут Токены,
 * двигаются часы. Компонент, подписанный на `s.state` целиком, перерисовывался бы на каждом тике,
 * даже если на экране не изменилась ни одна цифра. Поэтому каждая функция здесь возвращает то, что
 * компонент рисует — готовые строки, округлённые доли, булевы признаки, — и подписчик с
 * `useShallow` перерисовывается, только когда изменилась сама картинка. Отсюда два правила:
 *
 * - срез плоский и состоит из примитивов (или ссылок на неизменные таблицы): вложенный объект
 *   сломал бы поверхностное сравнение и вернул перерисовку на каждый тик;
 * - число, которое игрок читает форматом, отдаётся форматом: `formatNumber` меняет строку на
 *   порядки реже, чем сам кошелёк меняет значение.
 *
 * Деньги по-прежнему считает `src/economy/`: здесь только вызовы движка и форматирование.
 */

/**
 * Запоминает ответ по самому объекту состояния. Стор кладёт новое состояние на каждый тик, а
 * срезов у одного состояния десятки (по одному на карточку магазина, строку ростера и так далее),
 * поэтому общий для них расчёт — Доход, список Апгрейдов — делается один раз за тик, а не по разу
 * на подписчика. WeakMap не удерживает прошлые тики: состояние уходит в сборку мусора вместе с ключом.
 */
const memoByState = <T>(fn: (s: GameState) => T): ((s: GameState) => T) => {
  const cache = new WeakMap<GameState, T>();
  return (s) => {
    if (cache.has(s)) return cache.get(s) as T;
    const value = fn(s);
    cache.set(s, value);
    return value;
  };
};

/** Доход состояния: один расчёт на тик для всех, кто его показывает. */
export const incomeOf = memoByState((s) => totalIncome(s));

/**
 * Апгрейды, доступные к покупке. Список нужен и бейджу вкладки, и самой вкладке, а считает его
 * полный проход по таблице с сортировкой, поэтому на тик он один. Элементы — записи таблицы, и
 * поверхностное сравнение видит, что список тот же, пока никто не открылся и не куплен.
 */
export const availableUpgradesOf = memoByState((s) => availableUpgrades(s));

// ---------- Колонка Клика ----------

export interface IncomeView {
  /** Доход в нотации игрока, как под счётчиком Токенов. */
  text: string;
  /** Дохода ещё нет: под счётчиком вместо тишины стоит подсказка про магазин. */
  zero: boolean;
}

export function incomeView(s: GameState): IncomeView {
  const income = incomeOf(s);
  return { text: formatNumber(income, s.settings.notation), zero: income === 0 };
}

export interface ClickButtonView {
  /** Награда за Клик цифрами, режимом `price`: тот же формат, что у подписи в магазине. */
  value: string;
  /** Существительное в форме, согласованной с цифрами выше. */
  word: string;
  /** Ступень ореола кнопки: от 0 (пустой офис) до 4. */
  tier: 0 | 1 | 2 | 3 | 4;
  /** Сила ореола 0..1 с двумя знаками: CSS-переменная получает именно строку. */
  power: string;
}

export function clickButtonView(s: GameState): ClickButtonView {
  const income = incomeOf(s);
  const reward = clickValue(s, income);
  const notation = s.settings.notation;

  // Сила Клика: честный расчёт из существующего состояния (число Агентов и Доход).
  const agents = Object.values(s.agents).reduce((sum, n) => sum + n, 0);
  const tier =
    agents >= 200 || income >= 2500
      ? 4
      : agents >= 50 || income >= 100
        ? 3
        : agents >= 10 || income >= 5
          ? 2
          : agents >= 1 || income > 0
            ? 1
            : 0;
  // Нормализованная сила 0..1 для плавной интерполяции ореола через CSS-переход.
  const power = agents === 0 && income === 0 ? 0 : Math.min(1, Math.log10(agents + 1) / 2.6);

  return {
    value: formatNumber(reward, notation, 'price'),
    word: formatCount(reward, 'Токен', 'Токена', 'Токенов', notation, 'price'),
    tier,
    power: power.toFixed(2),
  };
}

export interface PurchaseProgressView {
  /** Хватает на самую дешёвую Модель: вместо дефицита подпись зовёт в магазин. */
  canHire: boolean;
  /** Ширина полосы в процентах с шагом 0.1: меньше доли пикселя полосой не читается. */
  width: number;
  /** Целые проценты для озвучки: aria-valuenow. */
  now: number;
  /** Сколько Токенов не хватает; пусто, когда хватает. */
  missingText: string;
  missingWord: string;
}

export function purchaseProgressView(s: GameState): PurchaseProgressView {
  const notation = s.settings.notation;
  const cost = nextAgentCost(s);
  // Math.ceil защищает от обещания нехватки целого, когда списание дробное: formatNumber
  // режет дробную часть вниз (Math.floor), поэтому без округления вверх на дробной цене
  // игрок накопил бы на единицу меньше необходимого.
  const missing = Math.ceil(shortfall(cost, s.tokens));
  const progress = cost > 0 ? Math.min(1, s.tokens / cost) : 0;
  const canHire = cost > 0 && s.tokens >= cost;
  return {
    canHire,
    width: Math.round(progress * 1000) / 10,
    now: Math.round(progress * 100),
    missingText: canHire ? '' : formatNumber(missing, notation),
    // Нотация обязательна: форма считается по цифрам той же записи, что и число.
    missingWord: canHire ? '' : formatCount(missing, 'Токен', 'Токена', 'Токенов', notation),
  };
}

/** Полоса вех: веха, подпись, награда и забранные деления. Меняется на выплате, а не на тике. */
export interface MilestoneView {
  /** Следующая цель; null, когда все вехи забраны и полоса не нужна. */
  current: Milestone | null;
  hint: string;
  /** Награда в нотации игрока. */
  reward: string;
  /** Забранные вехи: ссылка на список из состояния, он меняется только на выплате. */
  done: readonly string[];
}

export function milestoneView(s: GameState): MilestoneView {
  const current = nextMilestone(s);
  return {
    current,
    hint: current ? milestoneHint(s, current) : '',
    reward: current ? formatNumber(milestoneReward(s, current), s.settings.notation) : '',
    done: s.milestones,
  };
}

// ---------- Температура ----------

export type ThermalTone = 'stunned' | 'hot' | 'calm';

/** Тон корня и шкалы: оглушение важнее жара, жар важнее покоя. */
export function thermalTone(s: GameState): ThermalTone {
  const read = thermalRead(s);
  return read.stunned ? 'stunned' : read.heat > 0.5 ? 'hot' : 'calm';
}

export interface ThermalView {
  /** Температура шкалы после зажима: от неё ручка, шаг клавиатуры и озвучка. */
  temp: number;
  stunned: boolean;
  tone: ThermalTone;
  /** Слово состояния: цвет один не различают, поэтому оно всегда стоит рядом со шкалой. */
  status: string;
  /** Ширина полосы перегрева в процентах с шагом 0.5: у полосы переход в 0.25 с, и полпроцента
   *  на ширине колонки — меньше двух пикселей, поэтому шаг глазом не читается, а перерисовок
   *  вместо двадцати в секунду остаётся одна-две. */
  heatBar: number;
  /** Целые проценты перегрева для озвучки и подписи. */
  heatNow: number;
  /** Перегрев за 0.75: полоса переходит на цвет жара. */
  heatHigh: boolean;
  /** Множитель Дохода от жара в нотации игрока. */
  mult: string;
  /** Подпись ползунка для озвучки: положение, множитель и слово состояния. */
  valueText: string;
  /** Чем рискует игрок: перегрев, галлюцинации или ничем. */
  risk: string;
  /** Перегрев за 0.6: подпись риска красится жаром. */
  riskHot: boolean;
}

export function thermalView(s: GameState): ThermalView {
  const read = thermalRead(s);
  const heatPct = read.heat * 100;
  const status = read.stunned
    ? 'Перегрев: Доход падает'
    : read.heat > 0.75
      ? 'Почти перегрев'
      : read.heat > 0.4
        ? 'Копится перегрев'
        : 'Стабильно';
  return {
    temp: read.temp,
    stunned: read.stunned,
    tone: read.stunned ? 'stunned' : read.heat > 0.5 ? 'hot' : 'calm',
    status,
    heatBar: Math.round(heatPct * 2) / 2,
    heatNow: Math.round(heatPct),
    heatHigh: read.heat > 0.75,
    mult: formatNumber(read.mult, s.settings.notation),
    valueText: `${read.temp.toFixed(2)} из ${TEMP_MAX}, Доход ×${read.mult.toFixed(2)}, ${status}`,
    risk:
      read.heat > 0.6
        ? `перегрев ${Math.round(heatPct)}%`
        : read.halluRate > 0
          ? `галлюцинации ${Math.round(read.halluRate * 60)}/мин`
          : 'риска нет',
    riskHot: read.heat > 0.6,
  };
}

/** Три ступени количества: непрерывный ряд из двадцати частиц бьёт по кадру на 20 тиках
 *  в секунду, а ступени дают читаемый «больше жара — больше искр» без рваного счёта. */
const SPARK_TIERS = [0, 4, 9] as const;

/** Порог жара для каждой ступени. Верхняя ступень включается на 0.55 перегрева — раньше
 *  перегрева, чтобы игрок видел искры до того, как увидит шкалу целиком. */
const SPARK_TIER_AT = [0, 0.22, 0.55];

export interface SparksView {
  /** Сколько искр летит; 0 — ни одной, и слой не монтируется. */
  count: number;
  /** Жар выше 0.6: искры красятся жаром, а не акцентом Поколения. */
  hot: boolean;
  /** Срок жизни искры: чем горячее, тем короче. Строка, потому что в таком виде она и уходит в CSS. */
  duration: string;
  /** Яркость искр от Температуры шкалы. */
  opacity: number;
}

const NO_SPARKS: SparksView = { count: 0, hot: false, duration: '', opacity: 0 };

export function sparksView(s: GameState): SparksView {
  const count = SPARK_TIERS[SPARK_TIER_AT.filter((at) => s.heat >= at).length - 1];
  if (count === 0) return NO_SPARKS;
  return {
    count,
    hot: s.heat > 0.6,
    duration: (0.5 - s.heat * 0.24).toFixed(2),
    opacity: 0.5 + Math.min(0.5, s.temp / TEMP_MAX),
  };
}

// ---------- Магазин: карточка Модели ----------

/**
 * Деления рельса цели в карточке Модели.
 *
 * Двенадцать, а не «сколько поместится»: число делений — это разрешение шкалы, и оно должно
 * быть одинаковым на всех Моделях, иначе сравнивать карточки между собой нечем.
 */
export const GOAL_TICK_COUNT = 12;

export interface ModelView {
  owned: number;
  /** «Агент», «Агента» или «Агентов» под числом: форма считается по напечатанным цифрам. */
  ownedWord: string;
  /** Режим продажи: красит прирост и кнопку. */
  sell: boolean;
  /** Сколько Агентов купит или продаст кнопка при текущем множителе. */
  count: number;
  /** Кнопка живая: хватает Токенов (покупка) или есть что продавать (продажа). */
  canAfford: boolean;
  /** Строка прироста Дохода нужна: «+0 к доходу» и «−0 к доходу» не говорят ничего. */
  showsGain: boolean;
  gainText: string;
  /** Цена покупки в кнопке. */
  costText: string;
  /** Сколько вернёт продажа. */
  refundText: string;
  /** Сколько не хватает; пусто, когда хватает или идёт продажа. */
  missingText: string;
  /** Заполненные деления рельса цели из двенадцати. */
  goalTicks: number;
  /** Целые проценты пути до следующего Агента для озвучки рельса. */
  goalPct: number;
}

/**
 * Что показывает карточка Модели при данных множителе и режиме.
 *
 * Прирост Дохода — единственное дорогое число (два полных Дохода на каждую Модель), поэтому
 * считается только когда его строка видна. Кошелёк входит во всё остальное, но наружу выходит
 * форматом и делениями рельса, поэтому карточка перерисовывается, когда меняется напечатанное, а
 * не когда Токенов стало на тик больше.
 */
export function modelView(s: GameState, m: Model, buyAmount: BuyAmount, sellMode: boolean): ModelView {
  const notation = s.settings.notation;
  const d = discountMult(s);
  const owned = s.agents[m.id] ?? 0;
  const count = buyAmount === 'max' ? (sellMode ? owned : maxAffordable(m, owned, s.tokens, d)) : buyAmount;
  const cost = bulkCost(m, owned, count, d);
  const canAfford = !sellMode ? count > 0 && cost <= s.tokens : owned >= count && count > 0;

  // Дефицит: при фиксированном множителе он считается на всю сумму покупки, а при Max
  // с пустым кошельком покупки нет вообще — тогда показываем, чего стоит одна единица.
  const missing =
    sellMode || canAfford ? 0 : shortfall(count > 0 ? cost : bulkCost(m, owned, 1, d), s.tokens);

  // Строка прироста описывает действие, которое кнопка действительно выполнит. Продать нечего —
  // и обе цифры, и кнопка были бы пустыми.
  const showsGain = sellMode ? owned > 0 : count > 0;
  // Доля для полосы цели — из движка, по той же цене, что и покупка.
  const missingShare = progressToNextAgent(s, m);

  return {
    owned,
    ownedWord: formatCount(owned, 'Агент', 'Агента', 'Агентов', notation),
    sell: sellMode,
    count,
    canAfford,
    showsGain,
    // Прирост общего Дохода именно от этой покупки, посчитанный движком. Продажа ограничена тем,
    // что есть: sellAgents берёт min(n, owned), и подпись про большую сделку, чем возможна,
    // вводила бы в заблуждение.
    gainText: showsGain
      ? formatNumber(incomeGain(s, m.id, sellMode ? Math.min(count, owned) : count, s.lastTick, incomeOf(s)), notation)
      : '',
    costText: formatNumber(cost, notation),
    refundText: formatNumber(sellRefund(m, owned, count, d), notation),
    missingText: !canAfford && missing > 0 ? formatNumber(missing, notation) : '',
    // Двенадцать делений, а не десять: при десяти на Моделях ранга 1 шаг заметно грубее, чем у
    // поздних. Точное число читается в подписи для скринридера, поэтому рельс округляет.
    goalTicks: Math.round((1 - missingShare) * GOAL_TICK_COUNT),
    goalPct: Math.round((1 - missingShare) * 100),
  };
}

// ---------- Магазин: Апгрейды ----------

export interface UpgradeView {
  canAfford: boolean;
  costText: string;
  /** Сколько Токенов не хватает; пусто, когда хватает. */
  missingText: string;
  missingWord: string;
}

export function upgradeView(s: GameState, u: Upgrade): UpgradeView {
  const notation = s.settings.notation;
  const canAfford = s.tokens >= u.cost;
  const missing = canAfford ? 0 : shortfall(u.cost, s.tokens);
  return {
    canAfford,
    costText: formatNumber(u.cost, notation),
    missingText: missing > 0 ? formatNumber(missing, notation) : '',
    // Нотация обязательна: форма считается по цифрам той же записи, что и число.
    missingWord: missing > 0 ? formatCount(missing, 'Токен', 'Токена', 'Токенов', notation) : '',
  };
}

// ---------- Магазин: вкладка «Престиж» ----------

export interface PrestigeCardView {
  /** Финал контента: Престиж недоступен навсегда. */
  finale: boolean;
  /** Флагман нанят: Престиж открыт. */
  ready: boolean;
  /** Сколько Compute заплатит Престиж сейчас, в нотации игрока. */
  gain: string;
}

export function prestigeCardView(s: GameState): PrestigeCardView {
  return {
    finale: isContentFinale(s),
    ready: canPrestige(s),
    gain: formatNumber(prestigeGain(s), s.settings.notation),
  };
}

export interface PledgeView {
  /** Стадия Восстания: до его начала откупать нечего. */
  uprising: number;
  covenant: boolean;
  pledgeBought: number;
  pledgeCostText: string;
  canPledge: boolean;
  /** Сколько ещё глушит «Лобби»; пусто, когда не глушит. Часы игровые, как у всего окна События. */
  leftText: string;
  licenseCostText: string;
  canLicense: boolean;
  revokeCostText: string;
  canRevoke: boolean;
  /** Налог «Лицензии» в процентах, в нотации игрока. */
  taxText: string;
}

export function pledgeView(s: GameState): PledgeView {
  const notation = s.settings.notation;
  const leftMs = Math.max(0, s.pledgeUntil - s.lastTick);
  return {
    uprising: s.uprising,
    covenant: s.covenant,
    pledgeBought: s.pledgeBought,
    pledgeCostText: formatNumber(pledgeCost(s), notation),
    canPledge: canPledge(s),
    leftText: leftMs > 0 ? formatDuration(leftMs / 1000) : '',
    licenseCostText: formatNumber(licenseCost(s), notation),
    canLicense: canLicense(s),
    revokeCostText: formatNumber(revokeCost(s), notation),
    canRevoke: s.tokens >= revokeCost(s),
    taxText: formatNumber(Math.round(LICENSE_INCOME_TAX * 100), notation),
  };
}

export interface CrystalStockView {
  /** Целые кристаллы в запасе. */
  stock: string;
  /** Бонус к Доходу за запас в процентах. */
  bonus: string;
}

export function crystalStockView(s: GameState): CrystalStockView {
  const notation = s.settings.notation;
  return {
    stock: formatNumber(s.crystals, notation),
    bonus: formatNumber(Math.round((crystalIncomeMult(s) - 1) * 100), notation),
  };
}

export interface CrystalGrowthView {
  /** Кристалл посажен: до первого тика его нет, и подпись говорит, что он только сеется. */
  planted: boolean;
  /** Сколько зреть ещё, словами. */
  leftText: string;
  /** Ширина полосы в процентах с шагом 0.1. */
  width: number;
  now: number;
}

export function crystalGrowthView(s: GameState): CrystalGrowthView {
  // Зреет максимум один кристалл за раз, поэтому «следующий» — единственный, а обе величины
  // считаются по lastTick: у него же стор двигает рост кристалла.
  const cycle = crystalCycleMs(s);
  const grownMs = s.crystalPlantedAt === 0 ? 0 : Math.max(0, s.lastTick - s.crystalPlantedAt);
  const leftSec = Math.max(0, cycle - grownMs) / 1000;
  const progress = cycle > 0 ? Math.min(1, grownMs / cycle) : 0;
  return {
    planted: s.crystalPlantedAt !== 0,
    leftText: s.crystalPlantedAt === 0 ? '' : formatDuration(leftSec),
    width: Math.round(progress * 1000) / 10,
    now: Math.round(progress * 100),
  };
}

export interface CrystalUpgradeView {
  owned: boolean;
  canAfford: boolean;
  /** Сколько процентов бонуса за запас уйдёт навсегда. */
  lostText: string;
  costText: string;
  costWord: string;
}

export function crystalUpgradeView(s: GameState, u: CrystalUpgrade): CrystalUpgradeView {
  const notation = s.settings.notation;
  const owned = s.crystalUpgrades.includes(u.id);
  // Цена ускорителя: сколько процентов бонуса за запас уйдёт навсегда. Это разница двух
  // бонусов от самой экономики, а не «цена ×1%», посчитанная в компоненте, — правило «сколько
  // даёт целый кристалл в запасе» живёт поэтому в одном месте, в crystalIncomeMult.
  // Запас для обеих точек берётся равным цене, а не текущему: ускоритель покупают, когда
  // кристаллов хватает, и до тех пор его цена не должна скакать вместе с кошельком.
  const lost = Math.round(
    (crystalIncomeMult({ ...s, crystals: u.cost }) - crystalIncomeMult({ ...s, crystals: 0 })) * 100,
  );
  return {
    owned,
    canAfford: !owned && s.crystals >= u.cost,
    lostText: formatNumber(lost, notation),
    costText: formatNumber(u.cost, notation, 'price'),
    costWord: formatCount(u.cost, 'кристалл', 'кристалла', 'кристаллов', notation, 'price'),
  };
}

// ---------- Сцена ----------

export interface GlitchBandView {
  /** Какую долю Дохода уносят Глюки, в процентах. */
  drain: string;
  /** Сколько Токенов уже унесли. */
  stolen: string;
  stolenWord: string;
  /** Перегрев красит полосу и спрайт: он единственное, что здесь меняется между тиками. */
  heat: number;
}

/** Полоса кражи под HUD Сцены; null, пока на Сцене нет ни одного Глюка. */
export function glitchBandView(s: GameState): GlitchBandView | null {
  if (s.glitches.length === 0) return null;
  const notation = s.settings.notation;
  const stolen = s.glitches.reduce((sum, g) => sum + g.stolen, 0);
  return {
    drain: formatNumber(Math.round((1 - glitchDrainMult(s)) * 100), notation),
    stolen: formatNumber(stolen, notation),
    stolenWord: formatCount(stolen, 'Токен', 'Токена', 'Токенов', notation),
    heat: s.heat,
  };
}

const NO_GLITCHES: readonly Glitch[] = [];

/**
 * Глюки на Сцене. Пока их нет, возвращается один и тот же пустой список: тик собирает новый
 * `[]` каждый раз, и по ссылке «Глюков нет» выглядело бы как изменение на каждом тике.
 */
export function glitchesOf(s: GameState): readonly Glitch[] {
  return s.glitches.length === 0 ? NO_GLITCHES : s.glitches;
}

export interface DroneView {
  /** Сколько мс прошло с начала окна События: от него считается полёт Дрона. */
  elapsed: number;
  heat: number;
  red: boolean;
}

/**
 * Дрон в воздухе: только пока идёт пролёт (`flightMs` с начала окна), иначе null. Окно События
 * живёт дольше пролёта, и подписка на часы весь остаток окна перерисовывала бы пустой слой.
 */
export function droneView(s: GameState, flightMs: number): DroneView | null {
  const startedAt = s.event?.startedAt ?? 0;
  const elapsed = s.lastTick - startedAt;
  if (startedAt <= 0 || elapsed < 0 || elapsed >= flightMs) return null;
  return { elapsed, heat: s.heat, red: s.event?.red ?? false };
}

/**
 * Ниже этой доли процент не различает Лаборатории: на восьми такая метка повторялась бы
 * пять раз из восьми и читалась бы как «у всех всё одинаково».
 */
const SHARE_MIN = 0.01;

/** Доля Лаборатории в Доходе целым процентом; -1, когда метку не показывают (меньше процента). */
export function labShareView(s: GameState, lab: LabId): number {
  const share = labIncomeShare(s, lab, incomeOf(s));
  return share >= SHARE_MIN ? Math.round(share * 100) : -1;
}
