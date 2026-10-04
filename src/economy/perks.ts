import { CATALOG } from './catalog';
import { LAB_IDS, LABS, type LabId } from '../data/labs';

export type PerkEffect =
  | { kind: 'startTokens' }
  | { kind: 'offlineCap'; hours: number }
  | { kind: 'labBoost'; lab: LabId; mult: number }
  | { kind: 'discount'; pct: number }
  | { kind: 'clickMult'; mult: number }
  | { kind: 'autoclick'; perSecond: number }
  | { kind: 'generationBoost'; generation: number; pct: number };

export interface Perk {
  id: string;
  name: string;
  desc: string;
  cost: number;
  effect: PerkEffect;
}

/** Стартовые Токены за Перк, в единицах масштаба Поколения. */
export const START_TOKENS_UNITS = 1000;

/** Бонус особого Перка: +10% к доходу Моделей только своего Поколения. */
export const GEN_PERK_PCT = 0.1;
/** Хард-кап суммарного бонуса особых Перков: не больше +100% (×2) к доходу. */
export const GEN_PERK_MAX_TOTAL = 1;
/** Цена особых Перков: 10 Compute за первый и +5 за каждый следующий купленный особый. */
export const GEN_PERK_BASE_COST = 10;
export const GEN_PERK_STEP_COST = 5;

export const GEN_PERK_PREFIX = 'gen_';

/** id особого Перка Поколения `generation` (0-based). */
export const genPerkId = (generation: number) => `${GEN_PERK_PREFIX}${generation}`;

/** true, если id принадлежит особому Перку Поколения. */
export function isGenPerkId(id: string): boolean {
  return genPerkGeneration(id) !== null;
}

/** Поколение особого Перка или null, если id не его формата или вне каталога. */
export function genPerkGeneration(id: string): number | null {
  if (!id.startsWith(GEN_PERK_PREFIX)) return null;
  const n = Number(id.slice(GEN_PERK_PREFIX.length));
  return Number.isInteger(n) && n >= 0 && n < CATALOG.length ? n : null;
}

/** Сколько особых Перков уже куплено: от этого зависит цена следующего. */
export function countGenPerks(owned: string[]): number {
  return owned.filter(isGenPerkId).length;
}

/** Цена следующего особого Перка: растёт с числом уже купленных, а не с Поколением. */
export function genPerkCost(owned: string[]): number {
  return GEN_PERK_BASE_COST + GEN_PERK_STEP_COST * countGenPerks(owned);
}

export const PERKS: Perk[] = [
  { id: 'click_x2', name: 'Промпт-инженер', desc: 'клик ×2 навсегда', cost: 3, effect: { kind: 'clickMult', mult: 2 } },
  { id: 'start_tokens', name: 'Посевной раунд', desc: 'Начинай каждый забег с 1 000 токенов (× масштаб поколения)', cost: 5, effect: { kind: 'startTokens' } },
  { id: 'offline_24h', name: 'Ночная смена', desc: 'Лимит оффлайн-дохода 8ч → 24ч', cost: 10, effect: { kind: 'offlineCap', hours: 24 } },
  { id: 'discount', name: 'Оптовые GPU', desc: 'агенты дешевле на 5%', cost: 20, effect: { kind: 'discount', pct: 0.05 } },
  { id: 'autoclick', name: 'Скрипт-автокликер', desc: '1 клик в секунду автоматически', cost: 25, effect: { kind: 'autoclick', perSecond: 1 } },
  ...LAB_IDS.map<Perk>((lab) => ({
    id: `lab_${lab}`,
    name: `Партнёрство с ${LABS[lab].name}`,
    desc: `+10% к доходу всех моделей ${LABS[lab].name}`,
    cost: 15,
    effect: { kind: 'labBoost', lab, mult: 1.1 },
  })),
  // Особые Перки переживают Престиж как обычные: список хранится в том же `perks`,
  // поэтому SAVE_VERSION не растёт, а migrate отбрасывает неизвестные id как раньше.
  ...CATALOG.map<Perk>((g) => ({
    id: genPerkId(g.index),
    name: `Наследие: ${g.name}`,
    desc: `+10% к доходу моделей поколения «${g.name}» навсегда`,
    cost: GEN_PERK_BASE_COST,
    effect: { kind: 'generationBoost', generation: g.index, pct: GEN_PERK_PCT },
  })),
];

export const PERK_BY_ID: Record<string, Perk> = Object.fromEntries(PERKS.map((p) => [p.id, p]));

export function perkEffects(owned: string[]): PerkEffect[] {
  return owned.map((id) => PERK_BY_ID[id]?.effect).filter((e): e is PerkEffect => !!e);
}
