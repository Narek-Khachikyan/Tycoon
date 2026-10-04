import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { CATALOG } from '../economy/catalog';
import { CRYSTAL_CYCLE_MS } from '../economy/crystal';
import { totalIncome } from '../economy/engine';
import { EVENT_TABLES, grantAmount } from '../economy/events';
import { GLITCH_CLICKS } from '../economy/glitches';
import { serialize } from '../economy/save';
import { newGame, type GameState } from '../economy/state';
import { playEventAlertSound } from '../audio/sound';

vi.mock('../audio/sound', () => ({
  playAchievementSound: vi.fn(),
  playBuySound: vi.fn(),
  playClickSound: vi.fn(),
  playDenySound: vi.fn(),
  playEventAlertSound: vi.fn(),
  playPrestigeSound: vi.fn(),
  playUpgradeSound: vi.fn(),
}));

/** Реальный час, а не T0 из экономики: Престиж ставит lastTick из Date.now(), и часы разошлись бы. */
const T0 = 1_700_000_000_000;
const HOUR = 3600_000;
const g0 = CATALOG[0];
const first = g0.models[0];

const store = () => useGameStore.getState();
const state = () => store().state;
const rich = (s: GameState, tokens: number): GameState => ({ ...s, tokens, runTokens: tokens });

/**
 * Чистый магазин перед каждым тестом.
 *
 * `resetGame` вместо ручной расстановки: он возвращает и UI-слой (окно события, расписание
 * Глюков) к значениям модуля, поэтому тест не знает ни про один из них. Обращения к
 * localStorage внутри него за `typeof window` не доходят: в node окна нет.
 */
const freshStore = (s: GameState = newGame(T0)): void => {
  store().resetGame();
  useGameStore.setState({ state: s, toasts: [], buyAmount: 1 });
};

/** Тик без стенного времени: он двигает только игровые часы, по 50 мс за шаг. */
const tick = (seconds = 0.05): void => {
  store().tick(seconds);
};

/** Кошелёк после Престижа пуст, а Агент или Флагман без Токенов не купить. */
const withTokens = (tokens = 1e50): void => {
  useGameStore.setState({ state: rich(state(), tokens) });
};

/** Агенты нужны не только ради Престижа: без них Доход нулевой и Глюку нечего красть. */
const hire = (modelId: string, n: 1 | 10 | 100 = 100): void => {
  withTokens();
  useGameStore.setState({ buyAmount: n });
  store().buyAgents(modelId);
};

/** Игрок, дошедший до Поколения index через честные покупки и Престиж. */
const reachedGeneration = (index: number): void => {
  freshStore();
  for (let g = 0; g < index; g++) {
    hire(CATALOG[g].flagship.id, 1);
    store().triggerPrestige();
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  freshStore();
});

describe('glitch schedule', () => {
  it('holds the first glitch back until the third screen', () => {
    reachedGeneration(2);
    expect(state().generation).toBe(2);
    // Первое окно планируется, а не открывается сразу: спавн на первом тике читался бы как ошибка.
    tick();
    expect(state().glitches).toEqual([]);
    expect(store().nextGlitchAt).toBeGreaterThan(state().lastTick);
  });

  it('spawns one glitch when the window comes, and moves the window into the future', () => {
    reachedGeneration(2);
    tick();
    useGameStore.setState({ nextGlitchAt: state().lastTick });
    tick();
    expect(state().glitches).toHaveLength(1);
    expect(store().nextGlitchAt).toBeGreaterThan(state().lastTick);
    // Окно сдвинуто, а не осталось в прошлом: иначе глюки сыпались бы каждый тик.
    for (let i = 0; i < 20; i++) tick();
    expect(state().glitches).toHaveLength(1);
  });

  it('skips a window missed during an absence instead of greeting the player with a glitch', () => {
    reachedGeneration(2);
    tick();
    useGameStore.setState({ nextGlitchAt: state().lastTick - 10 * 60_000 });
    tick();
    expect(state().glitches).toEqual([]);
    expect(store().nextGlitchAt).toBeGreaterThan(state().lastTick);
  });

  it('keeps quiet under a license, because spawnGlitch refuses it', () => {
    reachedGeneration(2);
    tick();
    useGameStore.setState({
      state: { ...state(), covenant: true },
      nextGlitchAt: state().lastTick,
    });
    tick();
    expect(state().glitches).toEqual([]);
  });

  it('has no schedule at all on the first screen', () => {
    for (let i = 0; i < 50; i++) tick();
    expect(state().glitches).toEqual([]);
    expect(store().nextGlitchAt).toBe(0);
  });
});

describe('uprising', () => {
  it('stays quiet on the first screen and rises with the flagship of the next one', () => {
    freshStore();
    // Флагман Поколения 0 — первый экран: стадия 0, и «Конец света» на нём не выдаётся.
    hire(CATALOG[0].flagship.id, 1);
    expect(state().uprising).toBe(0);
    expect(store().toasts.filter((t) => t.title === 'Восстание моделей')).toEqual([]);
    store().triggerPrestige();
    // Флагман Поколения 1 — порог стадии 1.
    hire(CATALOG[1].flagship.id, 1);
    expect(state().uprising).toBe(1);
    expect(store().toasts.map((t) => t.title)).toContain('Восстание моделей');
  });

  it('raises once per generation and never twice for the same flagship', () => {
    reachedGeneration(2);
    expect(state().uprising).toBe(1);
    hire(CATALOG[2].flagship.id, 1);
    expect(state().uprising).toBe(2);
    const raised = store().toasts.filter((t) => t.title === 'Восстание моделей').length;
    // Второй Агент того же Флагмана и обычная Модель того же Поколения стадию не двигают:
    // переход возвращает тот же объект, и ни тост, ни звук не срабатывают.
    hire(CATALOG[2].flagship.id, 1);
    hire(CATALOG[2].models[0].id);
    expect(state().uprising).toBe(2);
    expect(store().toasts.filter((t) => t.title === 'Восстание моделей')).toHaveLength(raised);
  });

  it('does not hand the end of the world to a player on the third screen', () => {
    reachedGeneration(2);
    hire(CATALOG[2].flagship.id, 1);
    expect(state().generation).toBe(2);
    expect(state().uprising).not.toBe(3);
  });
});

/**
 * Кошелёк, с которым видна разница.
 *
 * 1e50 нужен, чтобы дойти до поздних Поколений, но прибавление выплаты к нему тонет в мантиссе:
 * шаг числа на этом порядке больше выплаты целиком, и проверка «стало больше» ничего бы не значила.
 */
const withVisibleWallet = (): void => {
  withTokens(1e6);
};

describe('catching an event', () => {
  const withEvent = (kind: 'grant' | 'hype', red = false): GameState => ({
    ...state(),
    event: { kind, startedAt: state().lastTick, red },
  });

  it('credits a one-off grant into all three counters, and only once per window', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant') });
    const before = state();
    store().catchEvent();
    // Разность двух чисел порядка миллиона теряет единицы на конце мантиссы, поэтому суммы
    // сверяются с допуском, а не тождеством: иначе проверка ловила бы округление, а не деньги.
    const wanted = grantAmount(before.tokens, totalIncome(before));
    expect(wanted).toBeGreaterThan(0);
    expect(state().tokens - before.tokens).toBeCloseTo(wanted, 6);
    expect(state().runTokens - before.runTokens).toBeCloseTo(wanted, 6);
    expect(state().totalTokens - before.totalTokens).toBeCloseTo(wanted, 6);
    // Второе нажатие на тот же Золотой Токен не платит дважды.
    store().catchEvent();
    expect(state().tokens - before.tokens).toBeCloseTo(wanted, 6);
    expect(store().eventCaught).toBe(true);
  });

  it('charges a crash, because a red grant is the same one-off kind with a negative amount', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant', true) });
    const before = state();
    store().catchEvent();
    expect(state().tokens).toBeLessThan(before.tokens);
    expect(state().runTokens).toBeLessThan(before.runTokens);
    expect(state().totalTokens).toBeLessThan(before.totalTokens);
  });

  it('counts a temporary event without paying it, because its multiplier is already ticking', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('hype') });
    const before = state();
    store().catchEvent();
    expect(state().tokens).toBe(before.tokens);
    expect(state().event).toEqual(before.event);
    expect(store().toasts.map((t) => t.title)).toContain('Событие поймано');
  });

  it('does nothing without a live event', () => {
    const before = state();
    store().catchEvent();
    expect(state()).toBe(before);
    expect(store().eventCaught).toBe(false);
  });

  it('does nothing after the window closed', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant') });
    tick(EVENT_TABLES.grant.durationMs / 1000 + 1);
    const before = state();
    store().catchEvent();
    expect(state().tokens).toBe(before.tokens);
    expect(store().eventCaught).toBe(false);
  });
});

describe('hitting a glitch', () => {
  it('pops on the third hit and pays the shared pot into all three counters', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    withVisibleWallet();
    useGameStore.setState({ nextGlitchAt: state().lastTick });
    tick();
    const id = state().glitches[0].id;
    for (let i = 1; i < GLITCH_CLICKS; i++) {
      store().hitGlitch(id);
      expect(state().glitches[0].clicks).toBe(i);
    }
    // Глюк должен что-то украсть, иначе выплата была бы нулевой и проверка ничего не значила.
    for (let i = 0; i < 200; i++) tick();
    const before = state();
    expect(before.glitches).toHaveLength(1);
    store().hitGlitch(id);
    const gained = state().tokens - before.tokens;
    expect(gained).toBeGreaterThan(0);
    expect(state().runTokens - before.runTokens).toBeCloseTo(gained, 6);
    expect(state().totalTokens - before.totalTokens).toBeCloseTo(gained, 6);
    expect(state().glitches).toEqual([]);
  });

  it('ignores a hit on a glitch that is not there', () => {
    reachedGeneration(2);
    const before = state();
    store().hitGlitch(999);
    expect(state()).toBe(before);
  });
});

describe('event window', () => {
  const liveEvent = (kind: 'grant' | 'hype' = 'grant', startedAt = state().lastTick): GameState => ({
    ...state(),
    event: { kind, startedAt, red: false },
  });

  it('announces a window the player has not seen, and does not announce it twice', () => {
    reachedGeneration(2);
    useGameStore.setState({ state: liveEvent(), toasts: [] });
    tick();
    expect(store().eventWindowAt).toBe(state().event?.startedAt);
    expect(store().toasts.map((t) => t.title)).toContain('Случайное событие');
    useGameStore.setState({ toasts: [] });
    tick();
    expect(store().toasts).toEqual([]);
  });

  it('reports a window that expired uncaught, once', () => {
    reachedGeneration(2);
    useGameStore.setState({ state: liveEvent(), toasts: [] });
    tick();
    useGameStore.setState({ toasts: [] });
    // Активными шагами, а не одним длинным тиком: короткий тик идёт через обычный Доход, и
    // проверка не зависит от оффлайн-ветки.
    for (let i = 0; i < 5; i++) tick(5);
    expect(store().toasts.map((t) => t.title)).toContain('Событие ушло');
    useGameStore.setState({ toasts: [] });
    tick();
    expect(store().toasts).toEqual([]);
  });

  it('keeps the alert a perk instead of a base feature', () => {
    reachedGeneration(2);
    useGameStore.setState({ state: liveEvent(), toasts: [] });
    tick();
    expect(store().toasts.map((t) => t.title)).toContain('Случайное событие');
    expect(vi.mocked(playEventAlertSound)).not.toHaveBeenCalled();

    // Следующее окно: стор о нём ещё не говорил, а Перк уже куплен — сигнал обязан прозвучать.
    const started = state().lastTick;
    useGameStore.setState({
      state: { ...state(), perks: ['event_alert'], event: { kind: 'hype', startedAt: started, red: false } },
      eventWindowAt: started - 1,
      toasts: [],
    });
    tick();
    expect(store().eventWindowAt).toBe(started);
    expect(vi.mocked(playEventAlertSound)).toHaveBeenCalledTimes(1);
  });
});

describe('return report', () => {
  /** Загрузка читает localStorage и Date.now(), поэтому окно и хранилище подставляются. */
  const reloadWith = async (save: string) => {
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
    vi.stubGlobal('localStorage', { getItem: () => save, setItem: () => {}, removeItem: () => {} });
    vi.resetModules();
    const reloaded = await import('./useGameStore');
    const snapshot = reloaded.useGameStore.getState();
    vi.unstubAllGlobals();
    return snapshot;
  };

  it('mentions a crystal that ripened during the absence, even with no income', async () => {
    const now = Date.now();
    const snapshot = await reloadWith(
      serialize({
        ...newGame(now - HOUR),
        tokens: 0,
        totalTokens: 1e9,
        lastTick: now - HOUR,
        crystalPlantedAt: now - CRYSTAL_CYCLE_MS - 1,
      }),
    );
    // Отчёт нужен из-за одного кристалла: дохода за простой не было (Агентов нет), а +1% Дохода
    // навсегда игрок всё равно получил.
    expect(snapshot.offlineReport?.crystals).toBe(1);
    expect(snapshot.offlineReport?.earned).toBe(0);
    expect(snapshot.offlineReport?.seconds).toBeCloseTo(HOUR / 1000, 1);
    expect(snapshot.state.crystals).toBe(1);
  });

  it('says nothing when the absence brought nothing', async () => {
    const now = Date.now();
    const snapshot = await reloadWith(
      serialize({ ...newGame(now - HOUR), tokens: 0, totalTokens: 1e9, lastTick: now - HOUR }),
    );
    expect(snapshot.offlineReport).toBeNull();
  });
});