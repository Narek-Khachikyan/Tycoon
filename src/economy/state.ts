import { TEMP_START } from './thermal';

export const SAVE_VERSION = 8;

/**
 * Громкость по умолчанию: 0.6, а не 1.
 *
 * Одноразовые звуки не звучат поодиночке: на одном Клике вместе идут Клик (0.08), стрекот реплики
 * (0.05) и, если повезло, Достижение (0.08), а музыка подкладывает снизу ещё слой. На полной
 * шкале сумма уходит за 1.0, и усилитель клиппит: вместо чиптюна игрок получает хрип. 0.6 даёт
 * запас на сумму слоёв, остаётся отчётливо слышным на тихих ноутбуках, а кому тихо — тот поднимет
 * ползунок сам. Ноль означает тишину: это честное положение «звука нет», а не отдельный режим.
 */
export const DEFAULT_VOLUME = 0.6;

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
  /** Id забранных вех: список, потому что порядок забора задаёт сама таблица, а не игрок. */
  milestones: string[];
  /** Сколько событий выпадало за игру: счётчик выпадений, а не список видов. */
  eventsSeen: number;
  /** Мс Unix начала окна, которое игрок уже поймал; 0 = текущее окно ещё не поймано. Отметка в
   *  состоянии, а не в UI-слое: окно события переживает перезагрузку, и забор, живший только в
   *  памяти вкладки, обнулялся бы вместе с ней — тот же клик платил бы за то же окно второй раз. */
  eventCaughtAt: number;
  /** Сколько Токенов уже вернули Клики за текущее окно «Ночного кодинга»: возврат ограничен всем
   *  объёмом окна, а не числом кликов. Обнуляется вместе с новым событием. */
  catchUpPaid: number;
  /** Мс Unix, когда ждать следующего события; 0 = событие не запланировано. */
  nextEventAt: number;
  event: ActiveEvent | null;
  /**
   * Длина цепочки пойманных подряд Событий, считая текущее окно (0 = цепочки нет).
   * Растёт только на спавне: пойманное окно продолжает цепочку, пропущенное обнуляет.
   * Перезагрузка обнуляет цепочку вместе с состоянием (поле не читается из сохранения):
   * цепочка — награда за непрерывное внимание, а не за прошлое.
   */
  combo: number;
  /** Счётчик id Глюков, чтобы их не переименовывать после перезагрузки. */
  glitchSeq: number;
  /** Мс Unix, когда заводить следующего Глюка; 0 = окно ещё не назначено. */
  nextGlitchAt: number;
  glitches: Glitch[];
  /** Стадия Восстания моделей; 0 = тихо. */
  uprising: 0 | 1 | 2 | 3;
  /** Мс Unix, до какого «Лобби» глушит красные события. */
  pledgeUntil: number;
  /** Сколько раз за забег куплено «Лобби»: без него цена ×8 сбрасывалась бы на перезагрузке. */
  pledgeBought: number;
  /** Бессрочный откуп ценой налога на Доход. */
  covenant: boolean;
  /** Услышанные реплики Моделей для «Переписки»: id из таблицы в data/quips.ts.
   *  Переживает Престиж вместе с Достижениями — коллекция собирается всю игру, а не Забег. */
  quipsSeen: string[];
  /** Активное Испытание Забега: id из таблицы в challenges.ts; null = обычный забег. */
  activeChallenge: string | null;
  /** Закрытые Испытания: каждое даёт +10% к Доходу навсегда; переживает Престиж, как Достижения. */
  challengesDone: string[];
  /** Температура генерации, [0, TEMP_MAX]. Живой параметр: меняется каждый тик, покупкой не является. */
  temp: number;
  /** Накопленный перегрев, [0, 1]. До единицы копится от жара и гасит Доход. */
  heat: number;
  /** Мс Unix последнего перегрева. 0 = не было. По нему считается оглушение после сброса. */
  overheatedAt: number;
  lastTick: number;
  startedAt: number;
  runStartedAt: number;
  /**
   * Настройки игрока. Живут в состоянии, а не в UI-слое, потому что обязаны переживать
   * перезагрузку: мьют и громкость, выбранные вчера, сегодня игрок не должен выбирать заново.
   */
  settings: {
    notation: Notation;
    muted: boolean;
    /** Общая доля 0..1 для эффектов и музыки; 0 = тишина. Разбор сохранения зажимает её в эти
     *  границы: число вне диапазона означало бы или неслышимую игру, или удар по ушам. */
    volume: number;
    reducedMotion: boolean;
  };
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
    milestones: [],
    eventsSeen: 0,
    eventCaughtAt: 0,
    catchUpPaid: 0,
    nextEventAt: 0,
    event: null,
    combo: 0,
    glitchSeq: 0,
    nextGlitchAt: 0,
    glitches: [],
    uprising: 0,
    pledgeUntil: 0,
    pledgeBought: 0,
    covenant: false,
    // Переписка переживает Престиж, поэтому в newGame она пуста только для новой игры.
    quipsSeen: [],
    // Испытаний в новом забеге нет: активное выбирается на старте, закрытые копятся Престижами.
    activeChallenge: null,
    challengesDone: [],
    temp: TEMP_START,
    heat: 0,
    overheatedAt: 0,
    lastTick: now,
    startedAt: now,
    runStartedAt: now,
    settings: { notation: 'short', muted: false, volume: DEFAULT_VOLUME, reducedMotion: false },
  };
}
