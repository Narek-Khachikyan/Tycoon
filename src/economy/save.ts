import { CATALOG, MODEL_BY_ID } from './catalog';
import { PERK_BY_ID } from './perks';
import { newGame, SAVE_VERSION, type GameState } from './state';
import { UPGRADE_BY_ID } from './upgrades';

export const SAVE_KEY = 'ai-tycoon-save';

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** migrations[v] переводит сохранение из версии v в v+1. */
const MIGRATIONS: Record<number, Migration> = {};

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const strList = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);

/** Индекс Поколения: только целое число в пределах каталога, иначе `fallback`. */
function clampGeneration(v: unknown, fallback = 0): number {
  const last = CATALOG.length - 1;
  return Math.min(Math.max(0, Math.floor(num(v, fallback))), last);
}

/**
 * Строгая проверка индекса Поколения для импорта.
 * Дробное значение (`0.5`) — признак повреждённого экспорта: такой индекс
 * не соответствует ни одной Модели каталога, поэтому файл отклоняется целиком.
 */
function isGenerationIndex(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < CATALOG.length;
}

/** `raw.generation` / `raw.maxGeneration` пригодны к импорту (отсутствие поля допустимо). */
function hasValidGeneration(raw: Record<string, unknown>): boolean {
  return [raw.generation, raw.maxGeneration].every((v) => v === undefined || isGenerationIndex(v));
}

/** Список id: только строки, только известные сущности, без дубликатов. */
const idList = (x: unknown, known: Record<string, unknown>): string[] => [
  ...new Set(strList(x).filter((id) => known[id])),
];

/**
 * Приводит сырое сохранение к текущей версии и каталогу:
 * неизвестные Модели/Апгрейды/Перки отбрасываются, Поколение зажимается в доступный диапазон.
 */
export function migrate(input: unknown, now: number): GameState {
  const base = newGame(now);
  if (!input || typeof input !== 'object') return base;
  let raw = { ...(input as Record<string, unknown>) };
  let v = num(raw.version, 1);
  while (v < SAVE_VERSION && MIGRATIONS[v]) raw = MIGRATIONS[v++](raw);

  const last = CATALOG.length - 1;
  const generation = clampGeneration(raw.generation);
  const agents: Record<string, number> = {};
  for (const [id, n] of Object.entries((raw.agents as Record<string, unknown>) ?? {})) {
    if (MODEL_BY_ID[id]?.generation === generation && num(n, 0) > 0) agents[id] = Math.floor(num(n, 0));
  }
  const settings = (raw.settings as GameState['settings']) ?? base.settings;

  return {
    ...base,
    version: SAVE_VERSION,
    generation,
    maxGeneration: Math.min(Math.max(generation, Math.floor(num(raw.maxGeneration, generation))), last),
    tokens: num(raw.tokens, 0),
    runTokens: num(raw.runTokens, 0),
    totalTokens: num(raw.totalTokens, 0),
    clicks: num(raw.clicks, 0),
    runClicks: num(raw.runClicks, 0),
    agents,
    upgrades: idList(raw.upgrades, UPGRADE_BY_ID),
    compute: num(raw.compute, 0),
    computeSpent: num(raw.computeSpent, 0),
    // Дубликаты Перка применялись бы дважды (×2 → ×4), поэтому список дедуплицируется.
    perks: idList(raw.perks, PERK_BY_ID),
    prestiges: num(raw.prestiges, 0),
    achievements: [...new Set(strList(raw.achievements))],
    lastTick: num(raw.lastTick, now),
    startedAt: num(raw.startedAt, now),
    runStartedAt: num(raw.runStartedAt, now),
    settings: {
      notation: settings.notation === 'sci' ? 'sci' : 'short',
      muted: !!settings.muted,
    },
  };
}

export const serialize = (s: GameState) => JSON.stringify(s);

export function exportSave(s: GameState): string {
  const bytes = new TextEncoder().encode(serialize(s));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function importSave(str: string, now: number): GameState | null {
  try {
    const bin = atob(str.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    // Отклоняем файл с нецелыми индексами Поколений, а не чиним его молча.
    if (!hasValidGeneration(parsed)) return null;
    return migrate(parsed, now);
  } catch {
    return null;
  }
}
