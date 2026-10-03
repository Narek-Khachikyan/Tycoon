import { create } from 'zustand';
import {
  advance,
  applyOffline,
  buyAgents as engineBuyAgents,
  buyPerk as engineBuyPerk,
  buyUpgrade as engineBuyUpgrade,
  canPrestige,
  click as engineClick,
  clickValue,
  prestige as enginePrestige,
  sellAgents as engineSellAgents,
} from '../economy/engine';
import { newlyEarned } from '../economy/achievements';
import { pickNews } from '../economy/news';
import { migrate, SAVE_KEY, serialize } from '../economy/save';
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
  // Offline check if game was closed for more than 10 seconds
  const elapsedSec = (now - base.lastTick) / 1000;
  if (elapsedSec >= 10 && base.totalTokens > 0) {
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

export const useGameStore = create<GameStore>((set, get) => {
  const initial = loadInitialState();

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

    tick: (dt: number) => {
      const { state, toasts } = get();
      if (dt <= 0) return;
      const advanced = advance(state, dt);
      const now = Date.now();
      const updated = { ...advanced, lastTick: now };

      // Проверка достижений
      const newAchIds = newlyEarned(updated);
      let newToasts = toasts;
      if (newAchIds.length > 0) {
        playAchievementSound(state.settings.muted);
        newToasts = [
          ...toasts,
          ...newAchIds.map((id) => ({
            id: `${id}-${now}`,
            title: '🏆 Достижение разблокировано!',
            desc: id,
          })),
        ];
        updated.achievements = [...updated.achievements, ...newAchIds];
      }

      set({ state: updated, toasts: newToasts });

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
        text: `+${Math.floor(earned)}`,
      }];

      // Обновление чата раз в несколько кликов
      let newChat = chatHistory;
      if (clicked.clicks % 5 === 1) {
        const pair = PROMPT_TEMPLATES[Math.floor(Math.random() * PROMPT_TEMPLATES.length)];
        chatCounter++;
        newChat = [
          { id: chatCounter, userPrompt: pair[0], aiResponse: pair[1] },
          ...chatHistory.slice(0, 4),
        ];
      }

      // Проверка достижений
      const newAchIds = newlyEarned(clicked);
      let newToasts = get().toasts;
      if (newAchIds.length > 0) {
        playAchievementSound(state.settings.muted);
        newToasts = [
          ...newToasts,
          ...newAchIds.map((id) => ({
            id: `${id}-${Date.now()}`,
            title: '🏆 Достижение разблокировано!',
            desc: id,
          })),
        ];
        clicked.achievements = [...clicked.achievements, ...newAchIds];
      }

      set({ state: clicked, floaters: newFloaters, chatHistory: newChat, toasts: newToasts });

      setTimeout(() => {
        set((s) => ({ floaters: s.floaters.filter((f) => f.id !== floaterId) }));
      }, 900);
    },

    buyAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const next = engineBuyAgents(state, modelId, buyAmount);
      if (next !== state) {
        playBuySound(state.settings.muted);
        set({ state: next });
      }
    },

    sellAgents: (modelId: string) => {
      const { state, buyAmount } = get();
      const count = buyAmount === 'max' ? (state.agents[modelId] ?? 0) : buyAmount;
      const next = engineSellAgents(state, modelId, count);
      if (next !== state) {
        playBuySound(state.settings.muted);
        set({ state: next });
      }
    },

    buyUpgrade: (upgradeId: string) => {
      const { state } = get();
      const next = engineBuyUpgrade(state, upgradeId);
      if (next !== state) {
        playUpgradeSound(state.settings.muted);
        set({ state: next });
      }
    },

    buyPerk: (perkId: string) => {
      const { state } = get();
      const next = engineBuyPerk(state, perkId);
      if (next !== state) {
        playUpgradeSound(state.settings.muted);
        set({ state: next });
      }
    },

    triggerPrestige: () => {
      const { state } = get();
      if (!canPrestige(state)) return;
      playPrestigeSound(state.settings.muted);
      const next = enginePrestige(state, Date.now());
      set({ state: next, news: pickNews(next) });
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

    dismissOfflineReport: () => set({ offlineReport: null }),

    removeToast: (id: string) =>
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    importSaveData: (str: string) => {
      try {
        const bin = atob(str.trim());
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        const imported = migrate(parsed, Date.now());
        set({ state: imported, news: pickNews(imported) });
        return true;
      } catch {
        return false;
      }
    },

    resetGame: () => {
      const fresh = newGame(Date.now());
      if (typeof window !== 'undefined') {
        localStorage.removeItem(SAVE_KEY);
      }
      set({ state: fresh, news: pickNews(fresh) });
    },

    refreshNews: () => {
      const { state } = get();
      set({ news: pickNews(state) });
    },
  };
});
