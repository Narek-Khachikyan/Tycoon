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
export const COST_STEP = 6.5;
export const INCOME_BASE = 0.1;
export const INCOME_STEP = 6.5;
export const MOD_SPREAD = 0.3;

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
