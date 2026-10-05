import type { LabId } from '../data/labs';
import { QUIPS, type Quip } from '../data/quips';
import type { GameState } from './state';

/**
 * Репличный ли клик: каждый 4-й, то есть в окне любых 5 Кликов подряд лежит
 * ровно 1–2 реплики. Чистая функция номера Клика — без Date.now и Math.random,
 * иначе каденс плавал бы между тиками и между прогонами тестов.
 */
const isQuipClick = (clicks: number): boolean =>
  Number.isInteger(clicks) && clicks > 0 && clicks % 4 === 0;

/**
 * Реплика для Клика: null, когда клик не репличный.
 *
 * Из пула Лаборатории (lab null — из всех) предпочтение отдаётся неуслышанным
 * id: коллекция «Переписки» закрывается без повторов, а повторы начинаются,
 * только когда у Лаборатории не осталось новых. Выбор внутри пула — хэш номера
 * Клика, а не счётчик: порядок не зависит от того, что игрок уже слышал.
 */
export function pickQuip(lab: LabId | null, clicks: number, seen: readonly string[]): Quip | null {
  if (!isQuipClick(clicks)) return null;
  const pool = lab === null ? QUIPS : QUIPS.filter((q) => q.lab === lab);
  if (pool.length === 0) return null;
  const heard = new Set(seen);
  const fresh = pool.filter((q) => !heard.has(q.id));
  const candidates = fresh.length > 0 ? fresh : pool;
  // 32-битный хэш через Math.imul: обычное умножение ушло бы за точные целые
  // double задолго до конца игры, и выбор поплыл бы на больших счётчиках.
  let h = Math.imul(clicks, 0x9e3779b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  // Финализатор выше снова делает число знаковым (отрицателен каждый второй хэш),
  // а отрицательный остаток дал бы candidates[-i] = undefined вместо реплики.
  return candidates[(h >>> 0) % candidates.length];
}

/** Сколько услышанных реплик держит сохранение: больше — только шум повторов. */
export const QUIPS_SEEN_CAP = 300;

/**
 * Записать услышанную реплику: чистый transition.
 *
 * Дубль возвращает ТОТ ЖЕ объект — стор по identity пропускает звуки, тосты и
 * ре-рендеры, а повторная запись означала бы «услышано новое», которого нет.
 * Переполнение сдвигает голову: свежие реплики вытесняют самые старые id.
 */
export function recordQuip(state: GameState, id: string): GameState {
  if (state.quipsSeen.includes(id)) return state;
  const next = [...state.quipsSeen, id];
  return {
    ...state,
    quipsSeen: next.length > QUIPS_SEEN_CAP ? next.slice(next.length - QUIPS_SEEN_CAP) : next,
  };
}
