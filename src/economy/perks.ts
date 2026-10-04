import { LAB_IDS, LABS, type LabId } from '../data/labs';

export type PerkEffect =
  | { kind: 'startTokens' }
  /** `rate` — доля Дохода, начисляемая в оффлайне (1 = полный Доход), `hours` — окно простоя. */
  | { kind: 'offlineRate'; rate: number; hours: number }
  | { kind: 'labBoost'; lab: LabId; mult: number }
  | { kind: 'discount'; pct: number }
  | { kind: 'clickMult'; mult: number }
  | { kind: 'autoclick'; perSecond: number }
  /** Звук при появлении События: сам по себе он ничего не множит и читается в UI. */
  | { kind: 'eventAlert' };

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
  {
    id: 'offline_rate_1', name: 'Ночной конвейер', desc: 'Оффлайн-доход 75% Дохода, но не дольше 24 ч',
    cost: 4,
    effect: { kind: 'offlineRate', rate: 0.75, hours: 24 },
  },
  { id: 'start_tokens', name: 'Посевной раунд', desc: 'Начинай каждый забег с 1 000 токенов (× масштаб поколения)', cost: 5, effect: { kind: 'startTokens' } },
  {
    // id остаётся прежним, хотя Перк теперь про долю Дохода, а не про лимит часов: он уже
    // может лежать в сохранении игрока, а migrate отбрасывает неизвестные id — с новым именем
    // Перк бы тихо исчез вместе со своей покупкой.
    id: 'offline_24h', name: 'Три смены', desc: 'Оффлайн-доход 90% Дохода, но не дольше 72 ч',
    cost: 10,
    effect: { kind: 'offlineRate', rate: 0.9, hours: 72 },
  },
  { id: 'discount', name: 'Оптовые GPU', desc: 'агенты дешевле на 5%', cost: 20, effect: { kind: 'discount', pct: 0.05 } },
  { id: 'autoclick', name: 'Скрипт-автокликер', desc: '1 клик в секунду автоматически', cost: 25, effect: { kind: 'autoclick', perSecond: 1 } },
  // Дороже автокликера и всех Партнёрств: сигнал покупают после Престижа, когда события уже идут
  // минутами и мимо экрана проходят.
  { id: 'event_alert', name: 'Сигналка на события', desc: 'звук, когда появляется Событие', cost: 30, effect: { kind: 'eventAlert' } },
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
