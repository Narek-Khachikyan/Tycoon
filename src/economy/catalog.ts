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
export const COST_STEP = 11.5;
export const INCOME_BASE = 0.1;
export const INCOME_STEP = 6.5;
export const MOD_SPREAD = 0.3;

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
