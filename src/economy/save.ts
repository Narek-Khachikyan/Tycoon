import { CATALOG, MODEL_BY_ID } from './catalog';
import { CRYSTAL_UPGRADE_BY_ID } from './crystal';
import { uprisingStage } from './glitches';
import { MILESTONE_BY_ID } from './milestones';
import { PERK_BY_ID } from './perks';
import { DEFAULT_CHANNEL_VOLUME, DEFAULT_VOLUME, EVENT_KINDS, newGame, SAVE_VERSION, type ActiveEvent, type EventKind, type GameState, type Glitch } from './state';
import { QUIPS_SEEN_CAP } from './quips';
import { clampTemp, TEMP_START } from './thermal';
import { UPGRADE_BY_ID } from './upgrades';

export const SAVE_KEY = 'ai-tycoon-save'; // Имя ключа — наследие AI Tycoon: переименование сотрёт живые прохождения, поэтому ключ не меняется вместе с названием игры.

/**
 * Ключ карантина битого сохранения: исходные байты нечитаемого сейва переезжают сюда,
 * а основной ключ освобождается под новую игру. Первый же тик иначе затёр бы их свежим
 * состоянием, и восстановить забег было бы нечем.
 */
export const CORRUPT_SAVE_KEY = `${SAVE_KEY}:corrupt`;

/** Своё ли поле объекта, а не ключ прототипа: `in` пропускает toString/constructor/__proto__. */
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Plain-объект из разбора: массивы, строки и числа сохранением не являются. */
const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Блок настроек из сохранения: строка или массив из битого файла не должны расползтись
 *  индексами по новому блоку через spread. */
const rawSettings = (raw: Record<string, unknown>): Record<string, unknown> =>
  isPlainRecord(raw.settings) ? raw.settings : {};

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** migrations[v] переводит сохранение из версии v в v+1. */
export const MIGRATIONS: Record<number, Migration> = {
  // Запись нужна, чтобы bump SAVE_VERSION не остался без миграции; отсутствующее поле получает
  // здесь значение по умолчанию, а присутствующее — сохраняется как есть: миграция дополняет,
  // а не перезаписывает, иначе импорт с испорченной версией затёр бы живые значения.
  1: (raw) => {
    const settings = rawSettings(raw);
    return {
      ...raw,
      version: 2,
      settings: { ...settings, reducedMotion: settings.reducedMotion ?? false },
    };
  },
  // Кристаллы, события, Глюки и откуп появились в v3. У живого сохранения их нет, поэтому каждое
  // поле получает здесь то же значение, что и newGame (кроме стадии Восстания — она выводится из
  // Поколения): миграция обязана оставить игроку игру, а не половину игры.
  2: (raw) => ({
    ...raw,
    version: 3,
    crystals: raw.crystals ?? 0,
    crystalPlantedAt: raw.crystalPlantedAt ?? 0,
    crystalUpgrades: raw.crystalUpgrades ?? [],
    eventsSeen: raw.eventsSeen ?? 0,
    nextEventAt: raw.nextEventAt ?? 0,
    event: raw.event ?? null,
    glitchSeq: raw.glitchSeq ?? 0,
    glitches: raw.glitches ?? [],
    uprising: raw.uprising ?? uprisingStage(num(raw.generation, 0)),
    pledgeUntil: raw.pledgeUntil ?? 0,
    pledgeBought: raw.pledgeBought ?? 0,
    covenant: raw.covenant ?? false,
  }),
  // Отметка «окно поймано», котёл возврата за Клик и окно расписания Глюков переехали в GameState:
  // все три решают, заплатит ли клик, а вне состояния обнулялись перезагрузкой. Чистые добавления —
  // у живого сохранения v3 их не было, и ноль означает «окно не поймано / ничего не возвращали /
  // окно Глюка не назначено», то есть ровно то, чем было состояние до их появления.
  3: (raw) => ({
    ...raw,
    version: 4,
    eventCaughtAt: raw.eventCaughtAt ?? 0,
    catchUpPaid: raw.catchUpPaid ?? 0,
    nextGlitchAt: raw.nextGlitchAt ?? 0,
  }),
  // Переписка появилась в v5: у живого сохранения её не было, а пустой список означает
  // «ничего не слышал» — то же, чем состояние было до реплик. Чистое добавление.
  4: (raw) => ({
    ...raw,
    version: 5,
    quipsSeen: raw.quipsSeen ?? [],
  }),
  // Испытания Забега появились в v6: у живого сохранения их не было, а null и пустой список
  // означают «обычный забег без закрытых» — то же, чем состояние было до Испытаний.
  // Чистое добавление.
  5: (raw) => ({
    ...raw,
    version: 6,
    activeChallenge: raw.activeChallenge ?? null,
    challengesDone: raw.challengesDone ?? [],
  }),
  // Громкость появилась в v7. У живого сохранения её нет, а DEFAULT_VOLUME означает ровно то, чем
  // было состояние до ползунка: звук ненулевой, но не на всю шкалу. Чистое добавление — остальные
  // настройки (мут, нотация, reducedMotion) миграция обязана сохранить, поэтому settings
  // разворачивается, а не заменяется.
  6: (raw) => {
    const settings = rawSettings(raw);
    return {
      ...raw,
      version: 7,
      settings: { ...settings, volume: settings.volume ?? DEFAULT_VOLUME },
    };
  },
  // Температура, перегрев, отметка перегрева и вехи появились в v8.
  7: (raw) => ({
    ...raw,
    version: 8,
    temp: raw.temp ?? TEMP_START,
    heat: raw.heat ?? 0,
    overheatedAt: raw.overheatedAt ?? 0,
    milestones: raw.milestones ?? [],
  }),
  // Выключатели эффектов и громкости каналов появились в v9 одной записью на всю переделку
  // интерфейса: будущие тикеты читают те же поля и миграций не добавляют. У живого сохранения их
  // нет, а «всё включено, каналы на единице» — это ровно то, как игра звучала и выглядела до них.
  // Чистое добавление: громкость, мьют, нотация и reducedMotion переживают подъём, поэтому
  // settings разворачивается, а не заменяется.
  8: (raw) => {
    const settings = rawSettings(raw);
    return {
      ...raw,
      version: 9,
      settings: {
        ...settings,
        particles: settings.particles ?? true,
        floaters: settings.floaters ?? true,
        shake: settings.shake ?? true,
        ticker: settings.ticker ?? true,
        musicVolume: settings.musicVolume ?? DEFAULT_CHANNEL_VOLUME,
        sfxVolume: settings.sfxVolume ?? DEFAULT_CHANNEL_VOLUME,
      },
    };
  },
};

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Неотрицательное целое число для счётчиков прогресса.
 * Дробный хвост или NaN из чужого/битого сохранения сбрасывается в 0,
 * иначе цикл for по agents или glitches уйдёт в зависание или пропустит тело.
 */
const count = (v: unknown): number => {
  const n = num(v, 0);
  return n > 0 ? Math.floor(n) : 0;
};

/**
 * Неотрицательный штамп времени Unix в миллисекундах.
 * Отрицательное число или NaN из сохранения ломали бы вычитание с Date.now(),
 * порождая вечные окна Событий и Глюков.
 */
const stamp = (v: unknown): number => Math.max(0, num(v, 0));

/**
 * Доля [0, 1] для величин вроде украденной Глюком доли дохода.
 * За пределами отрезка она превращала бы один Глюк в уничтожение экономики
 * либо в отрицательную кражу (доход из воздуха).
 */
const share = (v: unknown): number => Math.min(1, Math.max(0, num(v, 0)));

/**
 * Уровень [0, 1] для настроек вроде громкости звука.
 * В отличие от share, принимает значение по умолчанию: если поле не число вовсе,
 * сохранение обязано получить DEFAULT_VOLUME, а не 0 (тишину).
 */
const level = (v: unknown, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
};

/**
 * Выключатель, у которого по умолчанию «включено»: не булево значение из сохранения читается как
 * умолчание. Для `!!` здесь нет места — оно превращало бы мусор в «выключено», а игрок, не
 * трогавший переключателя, остался бы без эффекта, который не выключал.
 */
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Белый список id против известной таблицы.
 * Идентификаторы из будущих версий, опечатки и мусор отбрасываются,
 * дубликаты схлопываются, порядок сохраняется. Проверка — hasOwn, а не `in`:
 * `in` идёт по цепочке прототипов, и constructor/toString/__proto__ проходили
 * белый список, а обращение к ним как к таблице возвращало не запись, а мусор.
 */
const idList = <T>(v: unknown, dict: Record<string, T>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of strList(v)) {
    if (hasOwn(dict, id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};

/**
 * Разбор активного события: отбрасывает повреждённые записи целиком,
 * чтобы битое сохранение не держало вечно открытую плашку.
 */
const activeEvent = (v: unknown): ActiveEvent | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as EventKind)) return null;
  const startedAt = stamp(o.startedAt);
  if (startedAt === 0) return null;
  const red = !!o.red;
  const modelId = typeof o.modelId === 'string' && hasOwn(MODEL_BY_ID, o.modelId) ? o.modelId : undefined;
  return { kind: kind as EventKind, startedAt, red, ...(modelId ? { modelId } : {}) };
};

/**
 * Разбор списка Глюков: id положительный цельный, stolen зажат в 0..1,
 * дубликаты по id схлопываются. Возвращает валидный список и максимальный
 * встреченный id, чтобы glitchSeq остался строго выше любого из них.
 */
const sanitizeGlitches = (v: unknown): { glitches: Glitch[]; topId: number } => {
  if (!Array.isArray(v)) return { glitches: [], topId: 0 };
  const seen = new Set<number>();
  const glitches: Glitch[] = [];
  let topId = 0;
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = count(o.id);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    topId = Math.max(topId, id);
    const stolen = share(o.stolen);
    const clicks = Math.min(count(o.clicks), 3);
    glitches.push({ id, stolen, clicks });
  }
  return { glitches, topId };
};

export function migrate(raw: unknown, now: number): GameState {
  if (!raw || typeof raw !== 'object') return newGame(now);
  let data = raw as Record<string, unknown>;
  let v = typeof data.version === 'number' ? data.version : 1;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    data = step(data);
    v = typeof data.version === 'number' ? data.version : v + 1;
  }

  const agents: Record<string, number> = {};
  if (data.agents && typeof data.agents === 'object') {
    for (const [k, val] of Object.entries(data.agents as Record<string, unknown>)) {
      if (hasOwn(MODEL_BY_ID, k)) {
        agents[k] = count(val);
      }
    }
  }

  const settings = rawSettings(data);
  const glitched = sanitizeGlitches(data.glitches);
  // Часы не уезжают в будущее: отметка из будущего (перевод часов, чужой сейв) притягивается
  // к now, иначе окна/события/кристалл жили бы впереди времени, а через сутки разница
  // выплачивалась бы оффлайном. Откат часов назад Токенов не создаёт — это чинит applyOffline.
  const clampFuture = (v: number): number => (v > now ? now : v);
  const rawEvent = activeEvent(data.event);
  const event =
    rawEvent && rawEvent.startedAt > now ? { ...rawEvent, startedAt: now } : rawEvent;
  const rawCaught = stamp(data.eventCaughtAt);
  const eventCaughtAt = clampFuture(rawCaught);

  return {
    version: SAVE_VERSION,
    generation: Math.min(CATALOG.length - 1, count(data.generation)),
    maxGeneration: Math.min(CATALOG.length - 1, Math.max(count(data.generation), count(data.maxGeneration))),
    tokens: Math.max(0, num(data.tokens, 0)),
    runTokens: Math.max(0, num(data.runTokens, 0)),
    totalTokens: Math.max(0, num(data.totalTokens, 0)),
    clicks: count(data.clicks),
    runClicks: count(data.runClicks),
    agents,
    upgrades: idList(data.upgrades, UPGRADE_BY_ID),
    compute: Math.max(0, num(data.compute, 0)),
    computeSpent: Math.max(0, num(data.computeSpent, 0)),
    perks: idList(data.perks, PERK_BY_ID),
    prestiges: num(data.prestiges, 0),
    achievements: [...new Set(strList(data.achievements))],
    // Кристаллы целые и неотрицательные: запас — это счётчик, а не Доли, дробный остаток в нём
    // означал бы, что игрок заплатил частью кристалла, чего сделать нельзя.
    crystals: count(data.crystals),
    crystalPlantedAt: clampFuture(stamp(data.crystalPlantedAt)),
    // Дубликат ускорителя укоротил бы цикл дважды (16ч → 12ч без второй покупки), поэтому
    // список дедуплицируется, а неизвестный id отбрасывается, как и у Перков.
    crystalUpgrades: idList(data.crystalUpgrades, CRYSTAL_UPGRADE_BY_ID),
    eventsSeen: count(data.eventsSeen),
    eventCaughtAt,
    catchUpPaid: Math.max(0, num(data.catchUpPaid, 0)),
    nextEventAt: num(data.lastTick, now) > now ? clampFuture(stamp(data.nextEventAt)) : stamp(data.nextEventAt),
    event,
    combo: 0,
    glitchSeq: Math.max(count(data.glitchSeq), glitched.topId),
    nextGlitchAt: stamp(data.nextGlitchAt),
    glitches: glitched.glitches,
    uprising: Math.min(count(data.uprising), 3) as GameState['uprising'],
    pledgeUntil: stamp(data.pledgeUntil),
    pledgeBought: count(data.pledgeBought),
    covenant: !!data.covenant,
    // Переписка — как Достижения, а не как Перки: id проверяются только на тип, а не на
    // известность каталогу, поэтому запись переживает правку таблицы реплик. Дубль
    // схлопывается, хвост длиннее капа обрезается спереди — это те же правила, что в
    // recordQuip, иначе загрузка вернула бы состояние, которое игра никогда не пишет.
    quipsSeen: [...new Set(strList(data.quipsSeen))].slice(-QUIPS_SEEN_CAP),
    // Испытания — как Достижения, а не как Перки: id проверяются только на тип, а не на
    // известность таблице, поэтому запись переживает правку таблицы Испытаний. Активное
    // Испытание — строка или ничего: нестрока из повреждённого сохранения читается как
    // «обычный забег», иначе мусор включал бы ограничение, которого игрок не выбирал.
    activeChallenge: typeof data.activeChallenge === 'string' ? data.activeChallenge : null,
    challengesDone: [...new Set(strList(data.challengesDone))],
    // clampTemp, а не `share`: испорченный или будущий сейв может принести любое число, а
    // шкала обязана остаться в своём диапазоне — иначе множитель Дохода стал бы произвольным.
    temp: clampTemp(num(data.temp, TEMP_START)),
    heat: share(data.heat),
    overheatedAt: clampFuture(stamp(data.overheatedAt)),
    // Вехи фильтруются по таблице: неизвестный id из битого сейва не должен занимать
    // номер, который потом получит настоящая веха, и не должен показываться в интерфейсе.
    milestones: idList(data.milestones, MILESTONE_BY_ID),
    lastTick: clampFuture(num(data.lastTick, now)),
    startedAt: clampFuture(num(data.startedAt, now)),
    runStartedAt: clampFuture(num(data.runStartedAt, now)),
    settings: {
      notation: settings.notation === 'sci' ? 'sci' : 'short',
      muted: !!settings.muted,
      volume: level(settings.volume, DEFAULT_VOLUME),
      reducedMotion: !!settings.reducedMotion,
      particles: flag(settings.particles, true),
      floaters: flag(settings.floaters, true),
      shake: flag(settings.shake, true),
      ticker: flag(settings.ticker, true),
      musicVolume: level(settings.musicVolume, DEFAULT_CHANNEL_VOLUME),
      sfxVolume: level(settings.sfxVolume, DEFAULT_CHANNEL_VOLUME),
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
    if (!isImportableRecord(parsed)) return null;
    // Отклоняем файл с нецелыми индексами Поколений, а не чиним его молча.
    if (!hasValidGeneration(parsed)) return null;
    if (!hasValidCounters(parsed)) return null;
    return migrate(parsed, now);
  } catch {
    return null;
  }
}

/**
 * Поля, по которым импорт опознаёт сохранение игры. Код без единого узнаваемого поля
 * прогресса — пустой объект, пустой массив, произвольный JSON — не сохранение, и импорт
 * обязан отвергнуть его, а не тихо заменить им живой забег.
 */
const PROGRESS_FIELDS = [
  'tokens',
  'runTokens',
  'totalTokens',
  'clicks',
  'runClicks',
  'agents',
  'generation',
  'maxGeneration',
  'upgrades',
  'perks',
  'compute',
  'computeSpent',
  'prestiges',
  'achievements',
  'crystals',
  'crystalUpgrades',
  'milestones',
  'quipsSeen',
  'challengesDone',
  'activeChallenge',
  'eventsSeen',
  'glitches',
] as const;

/**
 * Годится ли разбор под импорт: plain-объект с целым номером версии и хотя бы одним полем
 * прогресса. Испорченный номер версии ('oops', дробь, ноль) — отказ, а не «старая версия»:
 * чтение его как v1 гнало файл через всю цепочку миграций, и та затирала живые значения
 * дефолтами. Будущая числовая версия проходит: migrate дополняет неизвестное, а лишнее
 * отбрасывает разбор.
 */
function isImportableRecord(raw: unknown): raw is Record<string, unknown> {
  if (!isPlainRecord(raw)) return false;
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return false;
  return PROGRESS_FIELDS.some((k) => hasOwn(raw, k));
}

/** Счётчики прогресса, если они есть, — неотрицательные конечные числа, а не null или NaN. */
function hasValidCounters(o: Record<string, unknown>): boolean {
  const counters = ['tokens', 'runTokens', 'totalTokens', 'clicks', 'runClicks', 'compute', 'computeSpent'];
  return counters.every((k) => {
    const v = o[k];
    return !hasOwn(o, k) || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
  });
}

/** generation и maxGeneration, если они есть, — индексы каталога. */
function hasValidGeneration(o: Record<string, unknown>): boolean {
  return ['generation', 'maxGeneration'].every((k) => {
    const g = o[k];
    return !hasOwn(o, k) || (typeof g === 'number' && Number.isInteger(g) && g >= 0 && g < CATALOG.length);
  });
}

/**
 * Что лежит в хранилище: пусто (тихий старт), читаемое сохранение или мусор.
 * Мусор — это и непарсящийся JSON, и парсящийся, но не похожий на сохранение:
 * перезаписывать что угодно из этого свежей игрой значило бы стереть, не прочитав.
 */
export type StoredSave =
  | { status: 'empty' }
  | { status: 'ok'; text: string; value: unknown }
  | { status: 'corrupt'; text: string };

export function readStoredSave(): StoredSave {
  let raw: string | null = null;
  try {
    if (typeof localStorage === 'undefined') return { status: 'empty' };
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    // Хранилище недоступно (приватный режим, SecurityError) — тихий старт, как при пустом.
    return { status: 'empty' };
  }
  if (!raw) return { status: 'empty' };
  try {
    const value = JSON.parse(raw);
    if (!isPlainRecord(value)) throw new Error('not a save');
    return { status: 'ok', text: raw, value };
  } catch {
    return { status: 'corrupt', text: raw };
  }
}

/**
 * Увозит битые байты под отдельный ключ и освобождает основной под новую игру.
 * Копия — исходные байты один в один для ручного восстановления.
 */
export function quarantineStoredSave(text: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CORRUPT_SAVE_KEY, text);
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
