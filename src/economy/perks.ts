import { LAB_IDS, LABS, type LabId } from '../data/labs';

export type PerkEffect =
  | { kind: 'startTokens' }
  | { kind: 'offlineCap'; hours: number }
  | { kind: 'labBoost'; lab: LabId; mult: number }
  | { kind: 'discount'; pct: number }
  | { kind: 'clickMult'; mult: number }
  | { kind: 'autoclick'; perSecond: number };

export interface Perk {
  id: string;
  name: string;
  desc: string;
  cost: number;
  effect: PerkEffect;
}

/** Стартовые Токены за Перк, в единицах масштаба Поколения. */
export const START_TOKENS_UNITS = 1000;

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
];

export const PERK_BY_ID: Record<string, Perk> = Object.fromEntries(PERKS.map((p) => [p.id, p]));

export function perkEffects(owned: string[]): PerkEffect[] {
  return owned.map((id) => PERK_BY_ID[id]?.effect).filter((e): e is PerkEffect => !!e);
}
