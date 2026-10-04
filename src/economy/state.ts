export const SAVE_VERSION = 3;

export type Notation = 'short' | 'sci';

export type EventKind = 'hype' | 'grant' | 'clickRush' | 'surge';

/** Единственный список видов события: им пользуются и таблица событий, и migrate. */
export const EVENT_KINDS: readonly EventKind[] = ['hype', 'grant', 'clickRush', 'surge'];

export interface ActiveEvent {
  kind: EventKind;
  startedAt: number;
  /** Красное ли событие, то есть Восстание моделей: у красных другие числа и длительности. */
  red: boolean;
  /** Модель, выбранная для «Прорыва»: без неё бонус после перезагрузки достался бы другой. */
  modelId?: string;
}

export interface Glitch {
  /** Счётчик id, а не порядковый номер: пережить перезагрузку он может только вместе с ним. */
  id: number;
  bornAt: number;
  /** Доля уже украденного: Глюк растёт тем быстрее, чем больше успело украсть. */
  stolen: number;
  /** Удары игрока по этому Глюку: на третьем он лопается. */
  clicks: number;
}

export interface GameState {
  version: number;
  generation: number;
  maxGeneration: number;
  tokens: number;
  runTokens: number;
  totalTokens: number;
  clicks: number;
  runClicks: number;
  agents: Record<string, number>;
  upgrades: string[];
  compute: number;
  computeSpent: number;
  perks: string[];
  prestiges: number;
  achievements: string[];
  /** Целые Compute-кристаллы в запасе: копятся, а не тратятся автоматически. */
  crystals: number;
  /** Мс Unix, когда посажен текущий кристалл; 0 = ничего не растёт. */
  crystalPlantedAt: number;
  /** Перманентные ускорители роста за кристаллы; id принадлежат таблице в crystal.ts. */
  crystalUpgrades: string[];
  /** Сколько событий выпадало за игру: счётчик выпадений, а не список видов. */
  eventsSeen: number;
  /** Мс Unix, когда ждать следующего события; 0 = событие не запланировано. */
  nextEventAt: number;
  event: ActiveEvent | null;
  /** Счётчик id Глюков, чтобы их не переименовывать после перезагрузки. */
  glitchSeq: number;
  glitches: Glitch[];
  /** Стадия Восстания моделей; 0 = тихо. */
  uprising: 0 | 1 | 2 | 3;
  /** Мс Unix, до какого «Лобби» глушит красные события. */
  pledgeUntil: number;
  /** Сколько раз за забег куплено «Лобби»: без него цена ×8 сбрасывалась бы на перезагрузке. */
  pledgeBought: number;
  /** Бессрочный откуп ценой налога на Доход. */
  covenant: boolean;
  lastTick: number;
  startedAt: number;
  runStartedAt: number;
  settings: { notation: Notation; muted: boolean; reducedMotion: boolean };
}

export function newGame(now: number): GameState {
  return {
    version: SAVE_VERSION,
    generation: 0,
    maxGeneration: 0,
    tokens: 0,
    runTokens: 0,
    totalTokens: 0,
    clicks: 0,
    runClicks: 0,
    agents: {},
    upgrades: [],
    compute: 0,
    computeSpent: 0,
    perks: [],
    prestiges: 0,
    achievements: [],
    crystals: 0,
    crystalPlantedAt: 0,
    crystalUpgrades: [],
    eventsSeen: 0,
    nextEventAt: 0,
    event: null,
    glitchSeq: 0,
    glitches: [],
    uprising: 0,
    pledgeUntil: 0,
    pledgeBought: 0,
    covenant: false,
    lastTick: now,
    startedAt: now,
    runStartedAt: now,
    settings: { notation: 'short', muted: false, reducedMotion: false },
  };
}
