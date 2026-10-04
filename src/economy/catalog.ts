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

export type AAMetric = 'iq' | 'speed' | 'price';

/**
 * Откуда взято число Справки AA: `aa` — замер Artificial Analysis, `pinned` — значение,
 * закреплённое автором поверх замера AA, `estimated` — оценка автора, потому что AA этого
 * поля не измеряет. Три состояния, а не два: закреплённое и оценочное число выглядят
 * одинаково, но игру ведут по-разному — первое решает, кто Флагман, второе взято по соседям.
 */
export type AASource = 'aa' | 'pinned' | 'estimated';

/** Источник по каждому полю: три числа Модели приходят из трёх разных источников. */
export type AASources = Record<AAMetric, AASource>;

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
  aaSources: AASources;
  /** Есть ли вообще запись об этой Модели в снимке AA. Отдельно от источников: у Claude
   * Instant запись есть, и автор закрепил индекс, а у Claude 1.3 нет её вовсе. */
  inAASnapshot: boolean;
  baseCost: number;
  baseIncome: number;
  costMod: number;
  incomeMod: number;
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

/**
 * Значение и источник одного поля Справки AA по одному правилу: число пришло из снимка
 * тогда и только тогда, когда источник `aa`. Правило одно на поле, потому что источник
 * обязан совпадать с числом — иначе UI припишет AA то, что оценил автор.
 *
 * Снимок никогда не пишет не измеренное (`sync-aa.mjs` отбрасывает 0), поэтому
 * отсутствие поля — это «AA не меряет», а `pin` поверх замера — «автор решил иначе».
 */
function mergeMetric(
  seed: ModelSeed,
  entry: AASnapshotEntry | undefined,
  k: AAMetric,
): { value: number; source: AASource } {
  const measured = entry?.[k];
  if (measured == null) return { value: seed[k], source: 'estimated' };
  if (seed.pin?.includes(k)) return { value: seed[k], source: 'pinned' };
  return { value: measured, source: 'aa' };
}

function mergeSeed(seed: ModelSeed, snap: AASnapshot) {
  const s = snap[seed.aa];
  const iq = mergeMetric(seed, s, 'iq');
  const speed = mergeMetric(seed, s, 'speed');
  const price = mergeMetric(seed, s, 'price');
  return {
    iq: iq.value,
    speed: speed.value,
    price: price.value,
    aaSources: { iq: iq.source, speed: speed.source, price: price.source },
    inAASnapshot: !!s,
  };
}

export function buildCatalog(seeds: GenerationSeed[], snap: AASnapshot): Generation[] {
  return seeds.map((g, index) => {
    const scale = genScale(index);
    const merged = g.models.map((seed) => ({ seed, ...mergeSeed(seed, snap) }));
    merged.sort((a, b) => a.iq - b.iq || a.price - b.price);
    const medSpeed = median(merged.map((x) => x.speed));
    const medPrice = median(merged.map((x) => x.price));
    const models: Model[] = merged.map((x, rank) => {
      const costMod = softMod(x.price, medPrice, 0.5);
      const incomeMod = softMod(x.speed, medSpeed, 1);
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
        aaSources: x.aaSources,
        inAASnapshot: x.inAASnapshot,
        costMod,
        incomeMod,
        baseCost: COST_BASE * Math.pow(COST_STEP, rank) * scale * costMod,
        baseIncome: INCOME_BASE * Math.pow(INCOME_STEP, rank) * scale * incomeMod,
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

/**
 * Подпись под раскрытой Справкой AA — одна строка, и только когда без неё игрок поверил бы
 * не тому, что написано в блоке. Помечены сами числа, а строка объясняет только то, чего
 * игрок не выводит из подписи: почему автор вообще вмешался в замер AA.
 *
 * Живёт здесь, а не в компоненте, потому что и причина, и период Поколения — решение
 * мейнтейнера про числа; текст в UI держал бы вторую копию этого решения.
 */
export function aaNote(gen: Generation, model: Model): string {
  // Порядок проверок — по силе утверждения: сперва то, что AA не знает Модели вовсе, потом то,
  // что автор поправил замер. «AA не измеряет эту Модель» нельзя выводить из источников полей:
  // у Claude Instant индекс тоже не из AA, но запись в снимке у него есть.
  if (!model.inAASnapshot) return 'AA не измеряет эту Модель: все три числа — оценка автора.';
  if (model.aaSources.iq === 'pinned') {
    // Год берётся из периода Поколения, а не пишется здесь: «2023» уже записано в данных
    // и должно смениться вместе с ними.
    const year = gen.period.match(/\d{4}/)?.[0];
    return year
      ? `Индекс закреплён автором: AA сжимает модели ${year} года.`
      : 'Индекс закреплён автором: AA сжимает модели этого Поколения.';
  }
  return '';
}
