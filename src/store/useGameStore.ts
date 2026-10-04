import { create } from 'zustand';
import {
  advanceTime,
  applyOffline,
  buyAgents as engineBuyAgents,
  buyPerk as engineBuyPerk,
  buyUpgrade as engineBuyUpgrade,
  canPrestige,
  click as engineClick,
  clickValue,
  isContentFinale,
  OFFLINE_THRESHOLD_SEC,
  prestige as enginePrestige,
  sellAgents as engineSellAgents,
} from '../economy/engine';
import { awardAchievements } from '../economy/achievements';
import { formatNumber } from '../economy/format';
import { pickNews } from '../economy/news';
import { importSave, migrate, SAVE_KEY, serialize } from '../economy/save';
import { newGame, type GameState, type Notation } from '../economy/state';
import {
  playAchievementSound,
  playBuySound,
  playClickSound,
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

  // Actions
  tick: (dt: number) => void;
  clickPrompt: (x?: number, y?: number) => void;
  buyAgents: (modelId: string) => void;
  sellAgents: (modelId: string) => void;
  buyUpgrade: (upgradeId: string) => void;
  buyPerk: (perkId: string) => void;
  triggerPrestige: () => void;

  setBuyAmount: (amt: BuyAmount) => void;
  setSellMode: (mode: boolean) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setNotation: (notation: Notation) => void;
  toggleMute: () => void;
  setReducedMotion: (on: boolean) => void;
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
    return {
      state: updated,
      offline: earned > 0 ? { seconds, earned } : null,
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
        aiResponse: 'Добро пожаловать в эру искусственного интеллекта! Нажмите «Отправить промпт».',
      },
    ],
    burst: null,

    tick: (dt: number) => {
      const { state } = get();
      if (dt <= 0) return;
      // advanceTime сам различает активный тик и простой (фон/сон) по OFFLINE_THRESHOLD_SEC,
      // поэтому лимит оффлайн-дохода нельзя обойти просто долгим dt.
      const updated = awardEarned(advanceTime(state, dt));
      set({ state: updated });

      // Сохранение в localStorage
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(SAVE_KEY, serialize(updated));
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
      const next = engineBuyAgents(state, modelId, buyAmount);
      if (next !== state) {
        playBuySound(state.settings.muted);
        set({ state: awardEarned(next) });
      }
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

    dismissOfflineReport: () => set({ offlineReport: null }),

    removeToast: (id: string) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    importSaveData: (str: string) => {
      // `importSave` отклоняет повреждённый экспорт (например, дробное Поколение),
      // поэтому в состояние попадают только валидные индексы каталога.
      const imported = importSave(str, Date.now());
      if (!imported) return false;
      set({ state: imported, news: pickNews(imported) });
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
      set({ state: fresh, news: pickNews(fresh) });
    },

    refreshNews: () => {
      const { state } = get();
      set({ news: pickNews(state) });
    },
  };
});
