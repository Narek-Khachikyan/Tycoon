import type { GameState } from './state';

const HOUR_MS = 3600 * 1000;

/** Полный цикл выращивания кристалла без ускорителей. */
export const CRYSTAL_CYCLE_MS = 20 * HOUR_MS;

/** Кристаллы в запасе, дальше которых прирост Дохода уже не растёт. */
export const CRYSTAL_STOCK_CAP = 100;
export const CRYSTAL_PER_STOCK_BONUS = 0.01;

export interface CrystalUpgrade {
  id: string;
  name: string;
  desc: string;
  /** Цена в кристаллах из запаса: это единственное, что ускоритель тратит. */
  cost: number;
  cycleMs: number;
}

export const CRYSTAL_UPGRADES: CrystalUpgrade[] = [
  { id: 'cu:speed1', name: 'Кварцевый затвор', desc: 'кристалл зреет 16 ч вместо 20', cost: 3, cycleMs: 16 * HOUR_MS },
  { id: 'cu:speed2', name: 'Гелиевое охлаждение', desc: 'кристалл зреет 12 ч', cost: 10, cycleMs: 12 * HOUR_MS },
  { id: 'cu:speed3', name: 'Криогенный разгон', desc: 'кристалл зреет 8 ч', cost: 25, cycleMs: 8 * HOUR_MS },
];

export const CRYSTAL_UPGRADE_BY_ID: Record<string, CrystalUpgrade> = Object.fromEntries(
  CRYSTAL_UPGRADES.map((u) => [u.id, u]),
);

/**
 * Цикл выращивания из купленных ускорителей: самый короткий из купленных, а без них базовый.
 *
 * Минимум, а не «последний купленный» и не цепочка «третий требует второго»: правило тогда
 * работает при любом порядке покупок, и ускоритель не может стать мёртвым из-за того, что игрок
 * купил сначала третий. Порог по предыдущему тиру стоил бы правила, которое магазин обязан
 * был бы продублировать на экране.
 */
export function crystalCycleMs(state: GameState): number {
  let cycle = CRYSTAL_CYCLE_MS;
  for (const id of state.crystalUpgrades) {
    const u = CRYSTAL_UPGRADE_BY_ID[id];
    if (u) cycle = Math.min(cycle, u.cycleMs);
  }
  return cycle;
}

/**
 * «Копить или тратить»: каждый целый кристалл В ЗАПАСЕ даёт +1% к общему Доходу, до 100 штук.
 * Поэтому ускоритель, купленный за три кристалла, отнимает у игрока +3% навсегда: конфликт
 * здесь настоящий, и сглаживать его нельзя — иначе копить перестало бы чего-то значить.
 *
 * Множитель постоянный, как Compute, поэтому попадает и в оффлайн-доход.
 */
export function crystalIncomeMult(state: GameState): number {
  const stock = Math.min(Math.max(0, Math.floor(state.crystals)), CRYSTAL_STOCK_CAP);
  return 1 + stock * CRYSTAL_PER_STOCK_BONUS;
}

/**
 * Ленивый сбор: зреет максимум один кристалл, и каждый сбор сразу сеет следующий.
 *
 * Отсюда и «за 40 ч всё равно один»: второй кристалл не зреет сам по себе, он ждёт сбора.
 * Кристалл — медленная валюта, а не Доход, поэтому догоняющего сбора за весь простой здесь
 * намеренно нет: иначе 72 часа оффлайна превращались бы в пачку кристаллов.
 *
 * Время приходит аргументом, а не читается само: тик движется по lastTick, который в простое
 * уехал вперёд на applyOffline, и `Date.now()` здесь означал бы второй источник игрового времени.
 */
export function collectCrystals(state: GameState, now: number): { state: GameState; grown: number } {
  if (state.crystalPlantedAt === 0) return { state: { ...state, crystalPlantedAt: now }, grown: 0 };
  if (now - state.crystalPlantedAt < crystalCycleMs(state)) return { state, grown: 0 };
  return { state: { ...state, crystals: state.crystals + 1, crystalPlantedAt: now }, grown: 1 };
}

export function buyCrystalUpgrade(state: GameState, id: string): GameState {
  const u = CRYSTAL_UPGRADE_BY_ID[id];
  if (!u || state.crystalUpgrades.includes(id) || u.cost > state.crystals) return state;
  return { ...state, crystals: state.crystals - u.cost, crystalUpgrades: [...state.crystalUpgrades, id] };
}

/**
 * Разбивание кристалла живёт в engine.ts, а не здесь: выплата считается от Дохода, а
 * offlineIncome пришлось бы импортировать оттуда — и модули замыкли бы друг на друга.
 */
