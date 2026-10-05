import { GENERATIONS, type GenerationSeed, type ModelSeed } from '../data/generations';
import type { LabId } from '../data/labs';
import snapshotJson from '../data/aa-snapshot.json';

export interface AASnapshotEntry {
  name?: string;
  iq?: number;
  speed?: number;
  price?: number;
}
export type AASnapshot = Record<string, AASnapshotEntry>;

/** Модель с выведенными игровыми характеристиками (ADR-0001). */
export interface Model {
  id: string;
  name: string;
  lab: LabId;
  generation: number; // индекс Поколения, 0-based
  rank: number;
  isFlagship: boolean;
  /** Справка AA */
  iq: number;
  speed: number;
  price: number;
  fromSnapshot: boolean;
  baseCost: number;
  baseIncome: number;
  costMod: number;
}

export interface Generation {
  index: number;
  id: number;
  name: string;
  period: string;
  theme: GenerationSeed['theme'];
  scale: number;
  models: Model[];
  flagship: Model;
}

export const GEN_SCALE = 1000;
export const COST_BASE = 15;
/**
 * Ступени ценовой и доходной лестниц Ранга.
 *
 * Отношение ступеней — и есть форма баланса, а не сами числа. При INCOME_STEP ≤ COST_STEP
 * доход за Токен падает с Рангом, и каждая следующая Модель оказывается строго худшей
 * покупкой, чем первая: за Поколение 1 отношение Доход/цена падало в 70 раз, до флагамана
 * доходили минуты, а игра вставала на ~47/сек. Инверсия не «медленный баланс», а перевёрнутая
 * лестница: у игрока не было цели, кроме самой дешёвой Модели, и Престиж становился
 * недостижимым.
 *
 * Теперь INCOME_STEP выше COST_STEP: каждая следующая Модель приносит больше Токенов на
 * вложенный Токен, поэтому лестница тянет вверх, а не отталкивает.
 */
export const COST_STEP = 9;
export const INCOME_BASE = 1;
export const INCOME_STEP = 10;
export const MOD_SPREAD = 0.3;

/**
 * Отношение базового Дохода первой Модели к базовой цене — «сколько Токенов в секунду
 * приносит самый дешёвый Агент за вложенные в него Токены».
 *
 * Это единственное число, которое решает, когда игра перестаёт быть кликером: пока Агент
 * приносит меньше, чем игрок успевает кликать, оптимальная стратегия — не покупать ничего и
 * кликать, и весь магазин становится декорацией. При INCOME_BASE = 0.1 первый Агент отдавал
 * 0,1/сек против 5 кликов в секунду — то есть был в 50 раз хуже клика, и переход «клики →
 * Агенты» не наступал никогда. Поднято до 1,0: Агент отдаёт 1/сек, окупается за 15 секунд
 * и перегорает клик где-то на пятом Агенте, то есть примерно через минуту игры.
 *
 * Держит инвариант против клика осмысленным на всём Поколении: верхняя ступень лестницы
 * (INCOME_BASE × INCOME_STEP^rank) обязана оставаться заметно выше базовой, иначе поздние
 * Ранги перестали бы что-то значить. Это проверяется тестом над каталогом.
 */
export const BASE_INCOME_PER_COST = INCOME_BASE / COST_BASE;

/**
 * Делитель прироста Compute в единицах масштаба Поколения.
 *
 * Живёт здесь, а не в движке: это единственное число, по которому формула Престижа совпадает в
 * самом Престиже и в Достижении «Счастливый Compute», а две копии константы разъезжаются
 * при первой же правке баланса.
 */
export const PRESTIGE_DIVISOR_UNITS = 1e5;

export const genScale = (index: number) => Math.pow(GEN_SCALE, index);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Модификатор в пределах [1 - spread, 1 + spread], плавно растущий с отношением value/median. */
export const softMod = (value: number, med: number, sharpness = 1) =>
  1 + MOD_SPREAD * Math.tanh(sharpness * Math.log(Math.max(value, 1e-9) / Math.max(med, 1e-9)));

function mergeSeed(seed: ModelSeed, snap: AASnapshot) {
  const s = snap[seed.aa];
  const pick = (k: 'iq' | 'speed' | 'price') =>
    s && s[k] != null && !seed.pin?.includes(k) ? (s[k] as number) : seed[k];
  return { iq: pick('iq'), speed: pick('speed'), price: pick('price'), fromSnapshot: !!s };
}

export function buildCatalog(seeds: GenerationSeed[], snap: AASnapshot): Generation[] {
  return seeds.map((g, index) => {
    const scale = genScale(index);
    const merged = g.models.map((seed) => ({ seed, ...mergeSeed(seed, snap) }));
    merged.sort((a, b) => a.iq - b.iq || a.price - b.price);
    const medPrice = median(merged.map((x) => x.price));
    const models: Model[] = merged.map((x, rank) => {
      const costMod = softMod(x.price, medPrice, 0.5);
      return {
        id: x.seed.id,
        name: x.seed.name,
        lab: x.seed.lab,
        generation: index,
        rank,
        isFlagship: rank === merged.length - 1,
        iq: x.iq,
        speed: x.speed,
        price: x.price,
        fromSnapshot: x.fromSnapshot,
        costMod,
        baseCost: COST_BASE * Math.pow(COST_STEP, rank) * scale * costMod,
        // Доход — чистая лестница Ранга. Скорость из AA сюда не входит: AA публикует t/s
        // для меньшинства моделей, поэтому медиана равна нулю и softMod отдавал бы 1.30 тем,
        // чью скорость измерили, и 1.00 всем остальным. Это артефакт разрежённости данных,
        // а не разница скоростей. Скорость остаётся в Модели как справка AA.
        baseIncome: INCOME_BASE * Math.pow(INCOME_STEP, rank) * scale,
      };
    });
    return {
      index,
      id: g.id,
      name: g.name,
      period: g.period,
      theme: g.theme,
      scale,
      models,
      flagship: models[models.length - 1],
    };
  });
}

export const CATALOG: Generation[] = buildCatalog(GENERATIONS, snapshotJson as AASnapshot);

export const MODEL_BY_ID: Record<string, Model> = Object.fromEntries(
  CATALOG.flatMap((g) => g.models.map((m) => [m.id, m])),
);

export const LAST_GENERATION = CATALOG.length - 1;

/** Делитель прироста Compute, приведённый к масштабу Поколения. */
export const prestigeDivisor = (generation: number): number =>
  PRESTIGE_DIVISOR_UNITS * CATALOG[generation].scale;

/**
 * Сколько Compute даёт Забег: кубический корень от заработка через делитель своего Поколения.
 *
 * Живёт здесь рядом с делителем и читается тремя местами — самим Престижем, порогом следующей
 * единицы Compute в интерфейсе и теневым Достижением «Счастливый Compute». Формула одна: три копии
 * разошлись бы при первой же правке баланса, а цикл импортов обойти нечем — модуль ничего не
 * импортирует, поэтому копия не была вынуждена.
 */
export const computeGain = (runTokens: number, generation: number): number =>
  Math.floor(Math.cbrt(runTokens / prestigeDivisor(generation)));
