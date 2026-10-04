import { create } from 'zustand';
import { CATALOG } from '../economy/catalog';
import {
  advanceTime,
  applyOffline,
  buyAgents as engineBuyAgents,
  buyPerk as engineBuyPerk,
  buyUpgrade as engineBuyUpgrade,
  canPrestige,
  click as engineClick,
  clickValue,
  earnTokens,
  isContentFinale,
  OFFLINE_THRESHOLD_SEC,
  prestige as enginePrestige,
  sellAgents as engineSellAgents,
  totalIncome,
} from '../economy/engine';
import { awardAchievements } from '../economy/achievements';
import { activeSpec, grantAmount, isEventActive } from '../economy/events';
import { formatNumber } from '../economy/format';
import { crashAmount, hitGlitch as engineHitGlitch, spawnGlitch } from '../economy/glitches';
import { pickNews } from '../economy/news';
import { perkEffects } from '../economy/perks';
import { availableUpgrades } from '../economy/upgrades';
import { importSave, migrate, SAVE_KEY, serialize } from '../economy/save';
import { newGame, type GameState, type Notation } from '../economy/state';
import {
  playAchievementSound,
  playBuySound,
  playClickSound,
  playDenySound,
  playEventAlertSound,
  playPrestigeSound,
  playUpgradeSound,
} from '../audio/sound';

export type BuyAmount = 1 | 10 | 100 | 'max';
export type ActiveTab = 'click' | 'office' | 'shop' | 'upgrades' | 'perks' | 'stats' | 'achievements' | 'settings';

export interface ToastMessage {
  id: string;
  title: string;
  desc: string;
}

export interface ClickFloater {
  id: number;
  x: number;
  y: number;
  text: string;
}

/** Событие, на которое интерфейсу нужен собственный громкий отклик. */
export type BurstKind = 'achievement' | 'prestige';

export interface BurstEvent {
  kind: BurstKind;
  /** Растёт на каждое событие: потребитель смотрит на него, а не на сам факт события, поэтому
   *  два одинаковых подряд не схлопываются в один отклик. */
  nonce: number;
}

interface OfflineReport {
  seconds: number;
  earned: number;
  /** Сколько кристаллов дозрело за простой: их собирает applyOffline, и без этой строки игрок
   *  узнал бы о них только по прибавке к Доходу на экране. */
  crystals: number;
}

interface ChatMessage {
  id: number;
  userPrompt: string;
  aiResponse: string;
}

const PROMPT_TEMPLATES = [
  ['Привет! Напиши код на React', 'Конечно! Вот компонент на 400 строк с 15 хуками.'],
  ['Отрефактори ядро Линукса', 'Готово! Заменил все указатели на умные смайлики.'],
  ['Напиши стих про видеокарты', 'Шуршат кулеры в ночи, греется кристалл...\nЯ для датасета терабайт собрал.'],
  ['Сделай приложение за 5 секунд', 'Вайб-кодинг активирован! Приложение вышло в прод.'],
  ['Объясни квантовую гравитацию', 'Представьте струны, но они вибрируют как басовый дроп.'],
  ['Сколько будет 2 + 2?', 'После 40 секунд размышлений: 4. Степень уверенности 99.98%.'],
  ['Придумай новый мем про ИИ', '«Когда запустил локальную модель на ноутбуке и он улетел в стратосферу».'],
  ['Как достичь AGI?', 'Нужно ещё больше чипов, кофе и токенов!'],
];

/**
 * Шаблон, который нельзя повторить дважды подряд.
 *
 * Один `Math.random` давал две одинаковые реплики подряд примерно в одном случае из
 * восьми, и чат выглядел залипшим наглухо. Индекс живёт в UI-слое рядом со счётчиками и в
 * GameState не попадает: это не часть сохранения, и его добавление не должно стоить миграции.
 */
let lastTemplateIndex = -1;
const nextTemplateIndex = (): number => {
  const len = PROMPT_TEMPLATES.length;
  const i = Math.floor(Math.random() * len);
  if (i !== lastTemplateIndex) {
    lastTemplateIndex = i;
    return i;
  }
  // Выбор из остальных: сдвиг на единицу давал бы заметный перекос в пользу следующего шаблона.
  const j = (i + 1 + Math.floor(Math.random() * (len - 1))) % len;
  lastTemplateIndex = j;
  return j;
};

/**
 * Первый Глюк не раньше третьего экрана.
 *
 * На первых двух Поколениях игрок знакомится с Агентами, Престижем и откупом, а пригларённый
 * враг в этот момент читается как глюк в коде, а не как механика. Порог стоит здесь, а не в
 * экономике, потому что заводятся Глюки здесь же: у событий окно лежит в `GameState`
 * (`nextEventAt`), потому что тик их заводит сам, а у Глюков окна в состоянии нет.
 */
const GLITCH_FIRST_GENERATION = 2;

/** Пауза между Глюками: от минуты до трёх минут. */
const GLITCH_MIN_MS = 60_000;
const GLITCH_MAX_MS = 180_000;

/**
 * Окно между Глюками. Разброс обязателен: постоянная пауза читалась бы как счётчик, а не как
 * случайность, и толпа паразитов выходила бы предсказуемой.
 *
 * Потолок `GLITCH_SLOTS` и «Лицензию» проверяет сам `spawnGlitch` — стор эти правила не дублирует,
 * иначе они разошлись бы при первой правке в glitches.ts.
 */
const glitchWindow = (rnd: () => number): number =>
  GLITCH_MIN_MS + rnd() * (GLITCH_MAX_MS - GLITCH_MIN_MS);

/**
 * Заводит Глюка, если подошло окно, и переносит окно дальше в любом случае.
 *
 * Расписание живёт в UI-слое рядом с прочими счётчиками, а не в `GameState`: поле в состоянии
 * стоит миграции и версии сохранения, а потерять тут можно не больше пары минут очереди. Окно
 * события, наоборот, лежит в состоянии — потерянное оно меняет то, что игрок вообще получит.
 */
function stepGlitchSchedule(
  state: GameState,
  nextGlitchAt: number,
  rnd: () => number,
): { state: GameState; nextGlitchAt: number } {
  // До третьего экрана расписания нет вовсе.
  if (state.generation < GLITCH_FIRST_GENERATION) return { state, nextGlitchAt: 0 };
  const now = state.lastTick;
  if (nextGlitchAt > now) return { state, nextGlitchAt };
  const next = now + glitchWindow(rnd);
  // Просроченное окно — это простой, а не подвисание кадра: глюк не заводится, окно переносится,
  // иначе игрок возвращался бы из оффлайна к паразиту, которого никто не звал. Догонять упущенное
  // окно не нужно: за следующие три минуты придёт следующее.
  if (nextGlitchAt === 0 || now - nextGlitchAt > GLITCH_MIN_MS) return { state, nextGlitchAt: next };
  return { state: spawnGlitch(state, now), nextGlitchAt: next };
}

/**
 * Стадия Восстания, которую даёт Поколение: столько, сколько игрок дошёл, но не больше потолка.
 *
 * Стадия равна Поколению, поэтому третий экран (Поколение 2) даёт стадию 2, а «Конец света» —
 * сплошь красные события — приходит только с четвёртого. От времени стадия не зависит: игрок,
 * просидевший вкладку сутки, не должен получить то, до чего не дошёл играя.
 */
const uprisingStage = (generation: number): GameState['uprising'] =>
  Math.min(Math.max(0, Math.floor(generation)), 3) as GameState['uprising'];

/**
 * Поднимает стадию до уровня своего Поколения; ничего не меняет — возвращает тот же объект,
 * иначе стор решил бы по тождеству, что переход что-то сделал.
 *
 * Только вверх: понижение означало бы, что импорт старого забега отбирает у игрока уже
 * пережитое Восстание вместе с откупом, который на него куплен.
 */
function raiseUprising(state: GameState): GameState {
  const stage = uprisingStage(state.generation);
  if (state.uprising >= stage) return state;
  return { ...state, uprising: stage };
}

/** Что игроку говорят про каждую стадию: тихое число в состоянии он бы не заметил. */
const UPRISING_LINES: readonly string[] = [
  '',
  'Агенты начали выдавать красные ответы. Модераторы в шоке.',
  'Красных событий всё больше. Отдел качества пишет кодекс.',
  'Конец света: остались только красные события. Поддержка закрыта.',
];

/**
 * Окна события, о котором стор ещё не говорил. Минус, а ноль: у события из битого сохранения
 * `startedAt` равен нулю (его дописывает разбор), и ноль как «ничего не объявлялось» сделал бы
 * такое событие неотличимым от уже показанного — оно осталось бы без объявления и без отклика.
 */
const NO_EVENT_WINDOW = -1;

interface GameStore {
  state: GameState;
  news: string;
  offlineReport: OfflineReport | null;
  activeTab: ActiveTab;
  buyAmount: BuyAmount;
  sellMode: boolean;
  toasts: ToastMessage[];
  floaters: ClickFloater[];
  chatHistory: ChatMessage[];
  /** Канал громких событий. Намеренно вне GameState: это не часть сохранения, и его добавление
   *  не должно стоить миграции. Событие перезаписывается следующим, а тождество у него — nonce:
   *  потребитель смотрит на nonce, поэтому два одинаковых подряд не схлопываются в один отклик
   *  и гасить канал вручную не нужно — тот, кто показал отклик, и так его показал. */
  burst: BurstEvent | null;
  /** Окно события, о котором стор уже объявил игроку: момент старта, NO_EVENT_WINDOW = окна нет.
   *  Ключ окна — его старт, а не вид события: одно и то же событие переживает перезагрузку, и
   *  второй раз поймать его нельзя. Вне GameState по той же причине, что и остальной UI-слой:
   *  это «показывали ли мы», а не состояние игры. */
  eventWindowAt: number;
  /** Поймано ли текущее окно события. */
  eventCaught: boolean;
  /** Когда заводить следующего Глюка, 0 = окно ещё не назначено. UI-слой, см. stepGlitchSchedule. */
  nextGlitchAt: number;

  // Actions
  tick: (dt: number) => void;
  clickPrompt: (x?: number, y?: number) => void;
  buyAgents: (modelId: string) => void;
  sellAgents: (modelId: string) => void;
  buyUpgrade: (upgradeId: string) => void;
  buyPerk: (perkId: string) => void;
  /** Ловит живое событие кликом по Золотому Токену: разовый вид платит, временный засчитывается. */
  catchEvent: () => void;
  /** Удар по Глюку; на третьем он лопается и выплата идёт через earnTokens. */
  hitGlitch: (id: number) => void;
  triggerPrestige: () => void;

  setBuyAmount: (amt: BuyAmount) => void;
  setSellMode: (mode: boolean) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setNotation: (notation: Notation) => void;
  toggleMute: () => void;
  setReducedMotion: (on: boolean) => void;
  /** Пауза Новостной ленты: останавливает и движение строки, и смену новости. Живёт в UI-слое
   *  и не сохраняется — персистентность означала бы новое поле в `GameState.settings` и правку
   *  контракта сохранения ради одного переключателя. */
  newsPaused: boolean;
  setNewsPaused: (paused: boolean) => void;
  dismissOfflineReport: () => void;
  removeToast: (id: string) => void;
  importSaveData: (str: string) => boolean;
  resetGame: () => void;
  refreshNews: () => void;
}

function loadInitialState(): { state: GameState; offline: OfflineReport | null } {
  const now = Date.now();
  let raw: unknown = null;
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved) raw = JSON.parse(saved);
    } catch {
      // ignore
    }
  }

  const base = migrate(raw, now);
  // Оффлайн-начисление, если игра была закрыта дольше порога простоя
  if ((now - base.lastTick) / 1000 >= OFFLINE_THRESHOLD_SEC && base.totalTokens > 0) {
    const { state: updated, seconds, earned } = applyOffline(base, now);
    // Кристалл дозревает и собирается внутри applyOffline, а тот переставляет crystalPlantedAt на
    // `now` — поэтому первый тик после загрузки его не повторяет и потеряться ему негде. Чего
    // не хватало, так это упоминания: кристалл стоит +1% Дохода навсегда, и молчать о нём нельзя.
    const crystals = updated.crystals - base.crystals;
    return {
      state: updated,
      // Отчёт показывается и из-за одного кристалла: доход за простой бывает нулевым (например,
      // когда все Агенты проданы), а игрок всё равно что-то получил.
      offline: earned > 0 || crystals > 0 ? { seconds, earned, crystals } : null,
    };
  }

  return { state: base, offline: null };
}

let floaterCounter = 0;
let chatCounter = 0;
let toastCounter = 0;
let burstCounter = 0;

/** Системная настройка движения. Литерал живёт здесь один раз: тот же запрос читает
 *  CSS-гейт в index.css, а JS нужен ещё и сам список — для слушателя смены настройки. */
export const REDUCE_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Список системной настройки движения и единственное место, где он читается: предикат
 * motionAllowed() и слушатель в ClickColumn спрашивают его здесь, чтобы «прочитано или
 * нет» решалось единожды. null — читать нечем, и тогда движения нет.
 *
 * Здесь нужен fail closed, потому что читатели несимметричны: CSS-гейт в index.css спрашивает
 * no-preference и на движке без фичи просто не показывает анимацию, а этот список спрашивает
 * reduce, и такой движок на `reduce` отвечает «движение разрешено». Одноразовые частицы при
 * этом создаются с animation: none, а элемент без анимации не устанет никогда.
 */
export function reduceMotionMedia(): MediaQueryList | null {
  if (typeof window.matchMedia !== 'function') return null;
  const media = window.matchMedia(REDUCE_MOTION_QUERY);
  // `.media` сериализует разобранный запрос, поэтому `not all` — это ровно случай
  // «движок запрос не разобрал». По .matches он от «движения нет» не отличим, а значит
  // без этой проверки непрочитанная настройка выглядела бы как разрешённое движение.
  return media.media === 'not all' ? null : media;
}

/**
 * Разрешено ли движение прямо сейчас — по настройке игрока и по системе.
 * Одноразовые частицы создаются только здесь: CSS-гейт умеет сделать элемент неподвижным,
 * но не умеет его убрать, поэтому без этой проверки они остались бы в DOM навсегда.
 * Проверка ловит момент создания, и только его: гейт умеет ещё и отменить уже идущую
 * анимацию, а после отмены animationend не наступает — за снятие отвечает useOneShot
 * в Toasts.tsx, потому что магазин не знает, какие элементы уже на выходе.
 */
export function motionAllowed(): boolean {
  if (useGameStore.getState().state.settings.reducedMotion) return false;
  const media = reduceMotionMedia();
  // `reduce`, а не `no-preference` как в CSS-гейте, и это не опечатка: здесь важно само
  // решение — выбрал ли игрок движение, — а не то, как оно выражено в таблице стилей.
  // Менять строку на no-preference «для симметрии» нельзя, не тронув сравнение: на движке
  // без этой фичи она сама по себе ответит «движение разрешено».
  if (!media) return false;
  return !media.matches;
}

export const useGameStore = create<GameStore>((set, get) => {
  const initial = loadInitialState();

  /**
   * Начисляет выполненные Достижения и показывает тосты.
   * Вызывается из каждого перехода, который может выполнить условие Достижения.
   */
  const awardEarned = (s: GameState): GameState => {
    const { state: next, awarded } = awardAchievements(s);
    if (awarded.length === 0) return s;
    playAchievementSound(s.settings.muted);
    set((st) => ({
      toasts: [
        ...st.toasts,
        ...awarded.map((id) => ({
          id: `${id}-${++toastCounter}`,
          title: 'Достижение разблокировано!',
          desc: id,
        })),
      ],
      burst: { kind: 'achievement', nonce: ++burstCounter },
    }));
    return next;
  };

  /** Тост не о Достижении: заголовок и строка написаны руками, id Достижения в desc не ищется. */
  const pushToast = (title: string, desc: string): void =>
    set((st) => ({ toasts: [...st.toasts, { id: `t-${++toastCounter}`, title, desc }] }));

  /**
   * Держит UI-состояние окна события: объявляет новое окно и сообщает о просроченном.
   *
   * Оба сообщения нужны игроку, а не магазину: без объявления он не узнает, что окно открылось,
   * а без сообщения о просрочке исчезновение события выглядит как баг. Возвращается срез, который
   * вызывающий кладёт в стор одним set вместе с состоянием.
   */
  const watchEventWindow = (state: GameState): { eventWindowAt: number; eventCaught: boolean } => {
    const { eventWindowAt, eventCaught } = get();
    const event = state.event;
    if (!event) return { eventWindowAt, eventCaught };
    const now = state.lastTick;
    const live = isEventActive(event, now);
    if (event.startedAt !== eventWindowAt) {
      // Окно, о котором стор ещё не говорил. Истёкшее не объявляется: его эффекта уже нет, и
      // сигнал на возвращении из простоя врал бы.
      if (!live) return { eventWindowAt, eventCaught };
      const spec = activeSpec(state, now);
      // Звук — Перк за Compute, а не базовая фича: игрок возвращается к вкладке по сигналу, и
      // покупает такую возможность сам. Ищем по виду эффекта, а не по id, чтобы переименование
      // Перка не оставило здесь мёртвую проверку.
      if (perkEffects(state.perks).some((e) => e.kind === 'eventAlert')) {
        playEventAlertSound(state.settings.muted);
      }
      if (spec) pushToast('Случайное событие', `${spec.name} — ${spec.desc}`);
      return { eventWindowAt: event.startedAt, eventCaught: false };
    }
    if (!live && !eventCaught) {
      // Окно закрылось, а поймать его было некогда. Повторно об этом не сообщаем: закрытое окно
      // помечается как отсутствующее, и следующее придёт со своим моментом старта.
      pushToast('Событие ушло', 'Окно закрылось, а поймать его было некогда.');
      return { eventWindowAt: NO_EVENT_WINDOW, eventCaught: false };
    }
    return { eventWindowAt, eventCaught };
  };

  return {
    state: initial.state,
    news: pickNews(initial.state),
    offlineReport: initial.offline,
    activeTab: 'click',
    buyAmount: 1,
    sellMode: false,
    toasts: [],
    floaters: [],
    chatHistory: [
      {
        id: 0,
        userPrompt: 'Запуск системы AI Tycoon...',
        aiResponse: 'Добро пожаловать в эру искусственного интеллекта! Нажми «Отправить промпт».',
      },
    ],
    burst: null,
    eventWindowAt: NO_EVENT_WINDOW,
    eventCaught: false,
    nextGlitchAt: 0,

    tick: (dt: number) => {
      const { state, nextGlitchAt } = get();
      if (dt <= 0) return;
      // advanceTime сам различает активный тик и простой (фон/сон) по OFFLINE_THRESHOLD_SEC,
      // поэтому лимит оффлайн-дохода нельзя обойти просто долгим dt. Случайность приходит
      // аргументом из стора: движок проверяется тестами с детерминированным rnd, а игра —
      // обычной случайностью.
      const advanced = awardEarned(advanceTime(state, dt, Math.random));
      // Глюк заводится после дохода и по часам конца тика: только что появившийся вор ещё ничего
      // не успел украсть.
      const glitched = stepGlitchSchedule(advanced, nextGlitchAt, Math.random);
      if (advanced.glitchSeq === 0 && glitched.state.glitchSeq === 1) {
        // Первый Глюк в жизни игрока объясняет себя сам: молчаливый спавн паразита, крадущего
        // Доход, выглядел бы как ошибка. Следующие молчат — их видно на экране.
        pushToast('Паразит в офисе', 'Он сел на твой Доход. Кликай по нему, пока не лопнет.');
      }
      const eventWindow = watchEventWindow(glitched.state);
      set({ state: glitched.state, nextGlitchAt: glitched.nextGlitchAt, ...eventWindow });

      // Сохранение в localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(SAVE_KEY, serialize(glitched.state));
        } catch {
          // ignore
        }
      }
    },

    clickPrompt: (x?: number, y?: number) => {
      const { state, floaters, chatHistory } = get();
      const earned = clickValue(state);
      const clicked = engineClick(state);
      playClickSound(state.settings.muted);

      // Добавление всплывающего числа
      const floaterId = ++floaterCounter;
      const newFloaters = [...floaters.slice(-10), {
        id: floaterId,
        x: x ?? window.innerWidth / 2,
        y: y ?? window.innerHeight / 2,
        // Не через Math.floor: у Токенов до 1e300 сырое число растянулось бы на весь экран,
        // а формат обязан совпадать с подписью под кнопкой Клика.
        text: `+${formatNumber(earned, state.settings.notation)}`,
      }];

      // Обновление чата раз в несколько кликов
      let newChat = chatHistory;
      if (clicked.clicks % 5 === 1) {
        const pair = PROMPT_TEMPLATES[nextTemplateIndex()];
        chatCounter++;
        newChat = [
          { id: chatCounter, userPrompt: pair[0], aiResponse: pair[1] },
          ...chatHistory.slice(0, 4),
        ];
      }

      const awarded = awardEarned(clicked);
      set({ state: awarded, floaters: newFloaters, chatHistory: newChat });

      setTimeout(() => {
        set((s) => ({ floaters: s.floaters.filter((f) => f.id !== floaterId) }));
      }, 900);
    },

    buyAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const bought = engineBuyAgents(state, modelId, buyAmount);
      if (bought === state) return;
      playBuySound(state.settings.muted);
      // Покупка Агентов — единственный путь роста их числа: продажа и Престиж его только
      // уменьшают, а тиканье Апгрейды не открывает. Поэтому появление Апгрейда ловим только здесь,
      // сравнением до/после внутри экшена — без нового поля в GameState и без миграции.
      // Звук покупки остаётся, а следом идёт уже знакомый playUpgradeSound (ассоциация
      // «звук = Апгрейды» есть у покупки Апгрейда): два звука подряд — избыточное подтверждение
      // готовности Апгрейда двумя каналами сразу, новый тембр не вводим.
      if (availableUpgrades(bought).length > availableUpgrades(state).length) {
        playUpgradeSound(state.settings.muted);
      }
      // Стадия Восстания растёт ровно здесь и ровно один раз на Поколение: повод — первый
      // Агент Флагмана, который игрок покупает руками и который же открывает Престиж. По
      // времени она не растёт никогда, а второй Агент того же Флагмана не меняет ничего: переход
      // возвращает тот же объект, и ни тост, ни звук не срабатывают.
      const risen = modelId === CATALOG[state.generation].flagship.id ? raiseUprising(bought) : bought;
      if (risen !== bought) {
        playUpgradeSound(state.settings.muted);
        pushToast('Восстание моделей', UPRISING_LINES[risen.uprising]);
      }
      set({ state: awardEarned(risen) });
    },

    sellAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const count = buyAmount === 'max' ? (state.agents[modelId] ?? 0) : buyAmount;
      const next = engineSellAgents(state, modelId, count);
      if (next !== state) {
        playBuySound(state.settings.muted);
        set({ state: awardEarned(next) });
      }
    },

    buyUpgrade: (upgradeId: string) => {
      const { state } = get();
      const next = engineBuyUpgrade(state, upgradeId);
      if (next !== state) {
        playUpgradeSound(state.settings.muted);
        set({ state: awardEarned(next) });
      }
    },

    buyPerk: (perkId: string) => {
      const { state } = get();
      const next = engineBuyPerk(state, perkId);
      if (next !== state) {
        playUpgradeSound(state.settings.muted);
        set({ state: awardEarned(next) });
      }
    },

    catchEvent: () => {
      const { state, eventCaught } = get();
      const event = state.event;
      // Часы берутся из lastTick, а не из Date.now(): окно события считается по игровому часу,
      // и системное время отставало бы от него на тик — ровно на том тике, где ловля ещё должна
      // быть разрешена.
      const now = state.lastTick;
      if (!event || eventCaught || !isEventActive(event, now)) return;
      const spec = activeSpec(state, now);
      // Разовый вид платит сразу и только через earnTokens — так сумма попадает во все три
      // счётчика, как обычный доход. Временному виду платить нечего: его множитель уже тикает,
      // и он только засчитывается. Сумму для него стор не выдумывает — деньги двигает экономика.
      const income = totalIncome(state, now);
      const amount =
        spec?.kind === 'grant'
          ? event.red
            ? crashAmount(state.tokens, income)
            : grantAmount(state.tokens, income)
          : 0;
      const tokens = formatNumber(amount, state.settings.notation);
      if (amount > 0) {
        playBuySound(state.settings.muted);
        pushToast('Грант получен', `+${tokens} Токенов`);
      } else if (amount < 0) {
        playDenySound(state.settings.muted);
        pushToast('Крах', `${tokens} Токенов`);
      } else {
        playClickSound(state.settings.muted);
        // Подтверждение нужно и тут: клик без ответа читался бы как сломанная кнопка.
        if (spec) pushToast('Событие поймано', `${spec.name} — ${spec.desc}`);
      }
      set({
        state: awardEarned(earnTokens(state, amount)),
        eventCaught: true,
        // Ловля помечает окно и «увиденным»: пойманное окно больше не ждёт ни объявления,
        // ни сообщения о просрочке, даже если игрок поймал его раньше первого тика.
        eventWindowAt: event.startedAt,
      });
    },

    hitGlitch: (id: number) => {
      const { state } = get();
      const { state: hit, popped, payout } = engineHitGlitch(state, id);
      // Глюка с таким id нет: клик ушёл в пустоту, и ни звука, ни смены состояния.
      if (hit === state) return;
      if (!popped) {
        // Первые два удара только трясут паразита, поэтому берётся звук отказа.
        playDenySound(state.settings.muted);
        set({ state: hit });
        return;
      }
      // Выплата идёт через earnTokens, поэтому попадает во все три счётчика, как и доход; саму
      // сумму считает экономика, потому что котёл у всех Глюков общий.
      playBuySound(state.settings.muted);
      pushToast('Глюк лопнул', `+${formatNumber(payout, state.settings.notation)} Токенов`);
      set({ state: awardEarned(earnTokens(hit, payout)) });
    },

    triggerPrestige: () => {
      const { state } = get();
      // На финальном Поколении Престиж обнулил бы забег без перехода в новое Поколение.
      if (!canPrestige(state) || isContentFinale(state)) return;
      playPrestigeSound(state.settings.muted);
      const next = awardEarned(enginePrestige(state, Date.now()));
      set({ state: next, news: pickNews(next) });
      // Ставится после awardEarned намеренно: если тот же тик выполнил Достижение, тряска
      // перебивает его отклик. Тост Достижения всё равно живёт и озвучен — теряется только веер искр.
      set({ burst: { kind: 'prestige', nonce: ++burstCounter } });
    },

    setBuyAmount: (amt: BuyAmount) => set({ buyAmount: amt }),
    setSellMode: (mode: boolean) => set({ sellMode: mode }),
    setActiveTab: (tab: ActiveTab) => set({ activeTab: tab }),

    setNotation: (notation: Notation) =>
      set((s) => ({ state: { ...s.state, settings: { ...s.state.settings, notation } } })),

    toggleMute: () =>
      set((s) => ({
        state: { ...s.state, settings: { ...s.state.settings, muted: !s.state.settings.muted } },
      })),

    // Настройка только умеет уменьшать движение, поэтому принимает флаг, а не переключает его:
    // системное «уменьшить движение» игрок отменить не вправе.
    // Уходящие тосты и веер оно не трогает намеренно: магазин не знает, какие из них уже
    // на выходе, а снять все означало бы обрезать время показа. Гасит их тот, кто их создал,
    // в своём коммите — тем же действием, что переводит data-motion.
    setReducedMotion: (on: boolean) =>
      set((s) => ({
        state: { ...s.state, settings: { ...s.state.settings, reducedMotion: on } },
      })),

    newsPaused: false,
    setNewsPaused: (paused: boolean) => set({ newsPaused: paused }),

    dismissOfflineReport: () => set({ offlineReport: null }),

    removeToast: (id: string) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    importSaveData: (str: string) => {
      // `importSave` отклоняет повреждённый экспорт (например, дробное Поколение),
      // поэтому в состояние попадают только валидные индексы каталога.
      const imported = importSave(str, Date.now());
      if (!imported) return false;
      // Смена забега сбрасывает и то, что стор уже показывал: окно события и расписание Глюков
      // принадлежат прошлому забегу, и оставшиеся значения скрыли бы событие из чужого
      // сохранения или вызвали бы мгновенный спавн.
      set({
        state: imported,
        news: pickNews(imported),
        eventWindowAt: NO_EVENT_WINDOW,
        eventCaught: false,
        nextGlitchAt: 0,
      });
      return true;
    },

    resetGame: () => {
      const fresh = newGame(Date.now());
      if (typeof window !== 'undefined') {
        // localStorage может быть заблокирован (SecurityError) — сброс не должен падать.
        try {
          localStorage.removeItem(SAVE_KEY);
        } catch {
          // ignore
        }
      }
      set({
        state: fresh,
        news: pickNews(fresh),
        eventWindowAt: NO_EVENT_WINDOW,
        eventCaught: false,
        nextGlitchAt: 0,
      });
    },

    refreshNews: () => {
      const { state } = get();
      set({ news: pickNews(state) });
    },
  };
});
