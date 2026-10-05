import { CATALOG, MODEL_BY_ID } from './catalog';
import { CRYSTAL_UPGRADE_BY_ID } from './crystal';
import { uprisingStage } from './glitches';
import { PERK_BY_ID } from './perks';
import { EVENT_KINDS, newGame, SAVE_VERSION, type ActiveEvent, type EventKind, type GameState, type Glitch } from './state';
import { UPGRADE_BY_ID } from './upgrades';

export const SAVE_KEY = 'ai-tycoon-save'; // Имя ключа — наследие AI Tycoon: переименование сотрёт живые прохождения, поэтому ключ не меняется вместе с названием игры.

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** migrations[v] переводит сохранение из версии v в v+1. */
const MIGRATIONS: Record<number, Migration> = {
  // Запись нужна, чтобы bump SAVE_VERSION не остался без миграции; новое поле получает
  // здесь значение по умолчанию, как и каждое следующее, добавленное в settings.
  1: (raw) => ({
    ...raw,
    version: 2,
    settings: { ...((raw.settings as object) ?? {}), reducedMotion: false },
  }),
  // Кристаллы, события, Глюки и откуп появились в v3. У живого сохранения их нет, поэтому каждое
  // поле получает здесь то же значение, что и newGame (кроме стадии Восстания — она выводится из
  // Поколения): миграция обязана оставить игроку игру, а не половину игры. Ни одно из них не
  // восстанавливается — это чистые добавления.
  // Поля внутри записей (red и modelId события, clicks Глюка) дополняет не миграция, а разбор
  // ниже: у v2 их не бывает, а довести до ума любую запись события или Глюка обязан migrate —
  // в том числе пришедшую из v3.
  2: (raw) => ({
    ...raw,
    version: 3,
    crystals: 0,
    crystalPlantedAt: 0,
    crystalUpgrades: [],
    eventsSeen: 0,
    nextEventAt: 0,
    event: null,
    glitchSeq: 0,
    glitches: [],
    // Стадия Восстания выводится из своего Поколения, а не ставится нулём: у сохранения с
    // Поколением 5 ноль означал бы мир без красных событий и без откупов навсегда — при живых
    // Глюках, которых откуп больше нечем купить.
    uprising: uprisingStage(num(raw.generation, 0)),
    pledgeUntil: 0,
    pledgeBought: 0,
    covenant: false,
  }),
  // Отметка «окно поймано», котёл возврата за Клик и окно расписания Глюков переехали в GameState:
  // все три решают, заплатит ли клик, а вне состояния обнулялись перезагрузкой. Чистые добавления —
  // у живого сохранения v3 их не было, и ноль означает «окно не поймано / ничего не возвращали /
  // окно Глюка не назначено», то есть ровно то, чем было состояние до их появления.
  3: (raw) => ({
    ...raw,
    version: 4,
    eventCaughtAt: 0,
    catchUpPaid: 0,
    nextGlitchAt: 0,
  }),
};

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Неотрицательное целое: счётчики и id не могут быть дробными или отрицательными. */
const count = (v: unknown) => Math.max(0, Math.floor(num(v, 0)));

/** Мс Unix: отрицательное время не значит ничего, поэтому оно читается как «не задано». */
const stamp = (v: unknown) => Math.max(0, num(v, 0));

/**
 * Неотрицательное число без округления — для доли, а не для счётчика.
 *
 * Масштаб `stolen` принадлежит таблице Глюков, поэтому миграция не решает за неё, что это за
 * доля, и только гарантирует конечное неотрицательное число: округление здесь стёрло бы
 * половину украденного у живого игрока.
 */
const share = (v: unknown) => Math.max(0, num(v, 0));

const strList = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);

const isEventKind = (v: unknown): v is EventKind => typeof v === 'string' && (EVENT_KINDS as readonly string[]).includes(v);

/**
 * Активное событие: только известный вид и нормальное время старта, иначе его нет.
 *
 * `red` и `modelId` дополняются здесь, а не миграцией: без них событие всё равно осталось бы
 * событием, но потеряло бы вид эффекта и Модель «Прорыва» — и после перезагрузки игрок получил бы
 * бонус другой Модели. Отсутствие `red` читается как обычное событие, потому что красные виды
 * появились вместе с флагом.
 */
function activeEvent(v: unknown): ActiveEvent | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as { kind?: unknown; startedAt?: unknown; red?: unknown; modelId?: unknown };
  if (!isEventKind(e.kind)) return null;
  const modelId = typeof e.modelId === 'string' ? e.modelId : undefined;
  return { kind: e.kind, startedAt: stamp(e.startedAt), red: !!e.red, modelId };
}

/**
 * Живые Глюки: запись без целого id не Глюк, а мусор — она молча выпала бы.
 *
 * Повторяющийся id отбрасывается: два Глюка с одним id лопнули бы от одного клика, а выплата за
 * лопнувшего досталась бы обоим. Вместе со списком отдаётся наибольший встреченный id — по нему
 * поднимается `glitchSeq`, иначе сохранение с `glitchSeq: 0` и живым Глюком `id: 1` выдало бы
 * следующему спавну тот же номер, и один клик убрал бы двоих с одной выплатой.
 */
function glitchList(x: unknown): { glitches: Glitch[]; topId: number } {
  if (!Array.isArray(x)) return { glitches: [], topId: 0 };
  const glitches: Glitch[] = [];
  const seen = new Set<number>();
  let topId = 0;
  for (const g of x) {
    if (!g || typeof g !== 'object') continue;
    const o = g as { id?: unknown; stolen?: unknown; clicks?: unknown };
    const id = num(o.id, NaN);
    if (!Number.isFinite(id)) continue;
    const key = Math.floor(id);
    if (seen.has(key)) continue;
    seen.add(key);
    topId = Math.max(topId, key);
    glitches.push({ id: key, stolen: share(o.stolen), clicks: count(o.clicks) });
  }
  return { glitches, topId };
}

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
 * неизвестные Модели/Апгрейды/Перки/ускорители кристаллов отбрасываются, Поколение зажимается
 * в доступный диапазон, событие и Глюки чинятся до проверяемой формы.
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
  const glitched = glitchList(raw.glitches);

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
    // Кристаллы целые и неотрицательные: запас — это счётчик, а не Доли, дробный остаток в нём
    // означал бы, что игрок заплатил частью кристалла, чего сделать нельзя.
    crystals: count(raw.crystals),
    crystalPlantedAt: stamp(raw.crystalPlantedAt),
    // Дубликат ускорителя укоротил бы цикл дважды (16ч → 12ч без второй покупки), поэтому
    // список дедуплицируется, а неизвестный id отбрасывается, как и у Перков.
    crystalUpgrades: idList(raw.crystalUpgrades, CRYSTAL_UPGRADE_BY_ID),
    eventsSeen: count(raw.eventsSeen),
    eventCaughtAt: stamp(raw.eventCaughtAt),
    catchUpPaid: Math.max(0, num(raw.catchUpPaid, 0)),
    nextEventAt: stamp(raw.nextEventAt),
    event: activeEvent(raw.event),
    glitchSeq: Math.max(count(raw.glitchSeq), glitched.topId),
    nextGlitchAt: stamp(raw.nextGlitchAt),
    glitches: glitched.glitches,
    uprising: Math.min(count(raw.uprising), 3) as GameState['uprising'],
    pledgeUntil: stamp(raw.pledgeUntil),
    pledgeBought: count(raw.pledgeBought),
    covenant: !!raw.covenant,
    lastTick: num(raw.lastTick, now),
    startedAt: num(raw.startedAt, now),
    runStartedAt: num(raw.runStartedAt, now),
    settings: {
      notation: settings.notation === 'sci' ? 'sci' : 'short',
      muted: !!settings.muted,
      reducedMotion: !!settings.reducedMotion,
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
