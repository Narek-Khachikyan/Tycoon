import { beforeEach, describe, expect, it, vi } from 'vitest';
import { quipsSeenOf, useGameStore } from './useGameStore';
import { CATALOG } from '../economy/catalog';
import { CRYSTAL_CYCLE_MS, CRYSTAL_PER_STOCK_BONUS, CRYSTAL_UPGRADES, crystalCycleMs, crystalIncomeMult } from '../economy/crystal';
import { ACHIEVEMENTS } from '../economy/achievements';
import {
  canPrestige,
  clickValue,
  computeShortfall,
  isContentFinale,
  prestigeGain,
  totalIncome,
} from '../economy/engine';
import { EVENT_TABLES, grantAmount } from '../economy/events';
import { RED_TABLES } from '../economy/glitches';
import { formatNumber } from '../economy/format';
import {
  GLITCH_CLICKS,
  glitchPayout,
  LICENSE_INCOME_TAX,
  licenseCost,
  PLEDGE_GROWTH,
  PLEDGE_MAX,
  PLEDGE_MS,
  pledgeCost,
  revokeCost,
} from '../economy/glitches';
import { PERKS } from '../economy/perks';
import { exportSave, serialize } from '../economy/save';
import { newGame, type GameState } from '../economy/state';
import {
  playAchievementSound,
  playBuySound,
  playClickSound,
  playEventAlertSound,
  playPrestigeSound,
  playQuipSound,
  playUpgradeSound,
} from '../audio/sound';

vi.mock('../audio/sound', () => ({
  playAchievementSound: vi.fn(),
  playBuySound: vi.fn(),
  playClickSound: vi.fn(),
  playDenySound: vi.fn(),
  playEventAlertSound: vi.fn(),
  playPrestigeSound: vi.fn(),
  playQuipSound: vi.fn(),
  playUpgradeSound: vi.fn(),
}));

/**
 * Ядро реплик мокается: его пишет параллельный агент, а стор обязан говорить с ним только
 * через контракт pickQuip/recordQuip. Мок повторяет контракт: реплика каждый 4-й Клик,
 * дубль id не пишется. Настоящие переходы ядра тестируются на его стороне.
 */
vi.mock('../economy/quips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../economy/quips')>();
  return {
    ...actual,
    pickQuip: vi.fn(
      (lab: string | null, clicks: number, seen: readonly string[]) =>
        clicks % 4 === 0 && !seen.includes('q1')
          ? { id: 'q1', lab: lab ?? 'openai', text: 'Тестовая реплика' }
          : null,
    ),
    recordQuip: vi.fn((state: GameState, id: string) => {
      const seen = (state as GameState & { quipsSeen?: readonly string[] }).quipsSeen ?? [];
      if (seen.includes(id)) return state;
      return { ...state, quipsSeen: [...seen, id] };
    }),
  };
});

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
  useGameStore.setState({ state: s, toasts: [], buyAmount: 1, lastQuip: null, lastBoughtModelId: null });
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
    expect(state().nextGlitchAt).toBeGreaterThan(state().lastTick);
  });

  it('spawns one glitch when the window comes, and moves the window into the future', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    tick();
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    expect(state().glitches).toHaveLength(1);
    expect(state().nextGlitchAt).toBeGreaterThan(state().lastTick);
    // Окно сдвинуто, а не осталось в прошлом: иначе глюки сыпались бы каждый тик.
    for (let i = 0; i < 20; i++) tick();
    expect(state().glitches).toHaveLength(1);
  });

  it('says who arrived, but only for the first glitch of the run', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    tick();
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    expect(store().toasts.map((t) => t.title)).toContain('Паразит в офисе');
    // Молчаливый спавн паразита читался бы как ошибка, но объяснять каждый — как извинение.
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    useGameStore.setState({ toasts: [] });
    tick();
    expect(store().toasts).toEqual([]);
  });

  it('skips a window missed during an absence instead of greeting the player with a glitch', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    tick();
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick - 10 * 60_000 } });
    tick();
    expect(state().glitches).toEqual([]);
    expect(state().nextGlitchAt).toBeGreaterThan(state().lastTick);
  });

  it('keeps quiet under a license, because spawnGlitch refuses it', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    tick();
    useGameStore.setState({ state: { ...state(), covenant: true, nextGlitchAt: state().lastTick } });
    tick();
    expect(state().glitches).toEqual([]);
  });

  it('has no schedule at all on the first screen', () => {
    for (let i = 0; i < 50; i++) tick();
    expect(state().glitches).toEqual([]);
    expect(state().nextGlitchAt).toBe(0);
  });
});

describe('uprising', () => {
  it('stays quiet on the first screen and rises with the flagship of the next one', () => {
    freshStore();
    // Флагман Поколения 0 — первый экран: стадия 0, и сплошь красные события на нём не выдаются.
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

  it('charges a crash only on the second press, and lets the player walk away from the window', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant', true) });
    const before = state();
    store().catchEvent();
    // Первое нажатие только спрашивает: «Крах» отнимает и от запаса, и столько же от Забега, то есть
    // прямо отодвигает Престиж, а второй кнопки у Золотого Токена нет — отказаться было нечем.
    expect(state().tokens).toBe(before.tokens);
    expect(state().eventCaughtAt).toBe(0);
    expect(store().crashArmedAt).toBe(before.event!.startedAt);
    // Сумма названа: игрок должен знать, во что он соглашается, до того как согласится.
    expect(store().toasts.map((t) => t.title)).toContain('Крах');
    // Ушёл — окно ушло, кошелёк цел: единственная кнопка так и не стала списанием. Доход за время
    // ожидания честно капает в плюс, поэтому сравнение идёт с ним, а не с нулём.
    tick(RED_TABLES.grant.durationMs / 1000 + 1);
    expect(state().tokens).toBeGreaterThan(before.tokens);
    expect(state().eventCaughtAt).toBe(0);

    // Следующее окно «Краха»: без нового подтверждения первое нажатие снова ничего не отнимает,
    // а второе — отнимает, и уже вместе с Забегом.
    useGameStore.setState({ state: withEvent('grant', true), crashArmedAt: 0, toasts: [] });
    const window2 = state();
    store().catchEvent();
    expect(state().tokens).toBe(window2.tokens);
    store().catchEvent();
    expect(state().tokens).toBeLessThan(window2.tokens);
    expect(state().runTokens).toBeLessThan(window2.runTokens);
    expect(state().totalTokens).toBeLessThan(window2.totalTokens);
    expect(state().eventCaughtAt).toBe(window2.event!.startedAt);
    // Окно поймано: третье нажатие не отнимает ничего.
    const charged = state().tokens;
    store().catchEvent();
    expect(state().tokens).toBe(charged);
  });

  it('keeps the catch fence through a reload, so one window can never pay twice', () => {
    freshStore();
    hire(first.id, 1);
    withVisibleWallet();
    useGameStore.setState({ state: withEvent('grant') });
    const before = state();
    store().catchEvent();
    const paid = state().tokens - before.tokens;
    expect(paid).toBeGreaterThan(0);
    // Импорт в середине окна привозит с собой отметку: тот же клик не платит второй раз.
    expect(store().importSaveData(exportSave(state()))).toBe(true);
    const imported = state();
    expect(imported.eventCaughtAt).toBe(imported.event!.startedAt);
    expect(store().eventCaught).toBe(true);
    store().catchEvent();
    expect(state().tokens).toBe(imported.tokens);
    // Объявление окна на первом тике после импорта не воскрешает кнопку: пойманное окно поймано.
    tick();
    expect(store().eventWindowAt).toBe(imported.event!.startedAt);
    expect(store().eventCaught).toBe(true);
    // За тик пришёл только Доход: выплаты за уже пойманное окно не было.
    expect(state().tokens - imported.tokens).toBeCloseTo(totalIncome(imported) * 0.05, 6);
  });

  it('returns the downtime window once for a burst of clicks, never once per click', () => {
    freshStore();
    hire(first.id, 10);
    const rate = totalIncome({ ...state(), event: null });
    const room = rate * RED_TABLES.clickRush.catchUpSec;
    useGameStore.setState({ state: { ...state(), event: { kind: 'clickRush', startedAt: state().lastTick, red: true } } });
    const before = state().tokens;
    for (let i = 0; i < 10; i++) store().clickPrompt(10, 10);
    // Десять Кликов плюс объём окна один раз: возврат за каждый Клик давал бы десять окон.
    expect(state().tokens - before).toBeLessThanOrEqual(10 * clickValue({ ...state(), event: null }) + room);
    expect(state().catchUpPaid).toBeCloseTo(room);
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
  it('pops on the third hit and pays what that one glitch stole into all three counters', () => {
    reachedGeneration(2);
    hire(CATALOG[2].models[0].id);
    withVisibleWallet();
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
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

describe('collecting a rumor', () => {
  /**
   * Игрок, у которого выплата слуха считается от запаса Токенов.
   *
   * Агентов много, а кошелёк скромный: «Грант» берёт минимум из запаса Токенов и пятнадцати минут
   * Дохода, и при такой расстановке решает именно процент от запаса. Тогда уменьшение кошелька
   * видно в выплате, а не тонет под потолком Дохода, — иначе проверка «сумма считается в момент
   * нажатия» ничего бы не различала.
   */
  const rumorPlayer = (tokens: number): void => {
    freshStore();
    hire(first.id, 100);
    withTokens(tokens);
  };

  it('credits the payout into all three counters, says the sum, and pays a repeated id nothing', () => {
    rumorPlayer(1e4);
    const before = state();
    const wanted = grantAmount(before.tokens, totalIncome(before));
    expect(wanted).toBeGreaterThan(0);
    vi.mocked(playBuySound).mockClear();
    store().collectRumor(7);
    // Разности, а не тождества: прибавление выплаты к кошельку порядка 1e4 теряет единицы на
    // конце мантиссы, и точное сравнение ловило бы округление, а не деньги.
    expect(state().tokens - before.tokens).toBeCloseTo(wanted, 6);
    expect(state().runTokens - before.runTokens).toBeCloseTo(wanted, 6);
    expect(state().totalTokens - before.totalTokens).toBeCloseTo(wanted, 6);
    // Выплата обязана быть названа: лента обещает разовые Токены, и одной прибавки мало.
    expect(store().toasts.find((t) => t.title === 'Слух пойман')?.desc).toBe(
      `+${formatNumber(wanted, state().settings.notation)} Токенов`,
    );
    expect(vi.mocked(playBuySound)).toHaveBeenCalledTimes(1);
    // Тот же слух второй раз: ни Токенов, ни тоста, ни звука, и состояние остаётся тем же объектом.
    const paid = state();
    const toasts = store().toasts.length;
    vi.mocked(playBuySound).mockClear();
    store().collectRumor(7);
    expect(state()).toBe(paid);
    expect(store().toasts).toHaveLength(toasts);
    expect(vi.mocked(playBuySound)).not.toHaveBeenCalled();
    // Забор помечает конкретный слух, а не забег: пересозданная лента начинает свой счётчик с
    // единицы, и такой слух снова должен платить.
    store().collectRumor(1);
    expect(state().tokens).toBeGreaterThan(paid.tokens);
  });

  it('counts the amount at the click, so a wallet spent in between moves the payout with it', () => {
    rumorPlayer(1e4);
    const full = state();
    store().collectRumor(1);
    const firstPayout = state().tokens - full.tokens;
    expect(firstPayout).toBeCloseTo(grantAmount(full.tokens, totalIncome(full)), 6);
    // Игрок успел потратить Токены: следующий слух уже не может заплатить прежнее, иначе цифра,
    // которую видит игрок, разошлась бы с выплатой.
    withTokens(2e3);
    const spent = state();
    store().collectRumor(2);
    const secondPayout = state().tokens - spent.tokens;
    expect(secondPayout / firstPayout).toBeCloseTo(0.2, 6);
    expect(secondPayout).toBeCloseTo(grantAmount(spent.tokens, totalIncome(spent)), 6);
  });

  it('says that nothing came when there is nothing to share, and still marks the rumor taken', () => {
    freshStore();
    // Токены есть, а Дохода нет: без Агентов второй член минимума нулевой, и делиться нечем.
    withTokens(1e6);
    const before = state();
    expect(grantAmount(before.tokens, totalIncome(before))).toBe(0);
    vi.mocked(playBuySound).mockClear();
    store().collectRumor(1);
    expect(state().tokens).toBe(before.tokens);
    // Звука покупки на пустой выплате нет, но клик обязан быть услышан: молчание читается как
    // сломанная кнопка.
    expect(vi.mocked(playBuySound)).not.toHaveBeenCalled();
    expect(vi.mocked(playClickSound)).toHaveBeenCalledTimes(1);
    expect(store().toasts.find((t) => t.title === 'Слух пойман')?.desc).toBe(
      'В этот раз никто ничего не принёс.',
    );
    // Забор ставится и на пустой выплате: тот же слух второй раз всё равно молчит.
    expect(store().collectedRumorId).toBe(1);
  });
});

describe('compute threshold', () => {
  /** Забег на указанном числе Токенов: ничего не покупаем, меняется только счётчик забега. */
  const run = (runTokens: number): GameState => ({ ...state(), runTokens });

  it('is exactly the number of tokens missing to the next unit, checked against the gain itself', () => {
    freshStore();
    for (const runTokens of [0, 1e5, 1e12]) {
      const s = run(runTokens);
      const missing = computeShortfall(s);
      expect(missing).toBeGreaterThan(0);
      // Порог проверяется не формулой, а самим движком: ровно на этом числе забега прирост
      // Compute растёт на единицу, а на единицу меньше — ещё нет.
      const threshold = runTokens + missing;
      expect(prestigeGain(run(threshold))).toBe(prestigeGain(s) + 1);
      expect(prestigeGain(run(threshold - 1))).toBe(prestigeGain(s));
    }
  });

  it('stays a positive finite number on the numbers the game reaches', () => {
    freshStore();
    // Порядки от первых забегов до конца игры: это деньги, и ноль или бесконечность в строке
    // окна статистики читались бы как сломанная строка. Дальше ~1e50 разрыв до следующей единицы
    // уходит под точность double, и там нули — единственное представимое значение; за такой
    // суммой игра не доходит.
    for (const runTokens of [1e12, 1e27, 1e30, 1e50]) {
      const missing = computeShortfall(run(runTokens));
      expect(missing).toBeGreaterThan(0);
      expect(Number.isFinite(missing)).toBe(true);
    }
  });

  it('rises with the generation, because the divisor it comes from does', () => {
    freshStore();
    const gen0Missing = computeShortfall(run(0));
    reachedGeneration(1);
    expect(computeShortfall(run(0)) / gen0Missing).toBeCloseTo(CATALOG[1].scale, 6);
  });
});

/**
 * Игрок, дошедший до откупа.
 *
 * Третий экран, а не второй: Глюки заводятся не с первого, и раньше лицензии нечего было бы
 * лопнуть — выплата была бы нулём. Агенты нужны и для налога, и для кражи: без них Доход нулевой
 * и обе величины схлопываются в ноль. Событие на время проверки выключено — иначе «Волна хайпа»
 * умножила бы Доход, и налог измерялся бы вместе с множителем события, а не сам по себе.
 */
const risenPlayer = (): void => {
  reachedGeneration(2);
  hire(CATALOG[2].models[0].id);
  useGameStore.setState({ state: { ...state(), event: null, nextEventAt: state().lastTick + HOUR } });
};

describe('pledge and license', () => {
  it('prices every next lobby higher, extends the window and stops at the cap', () => {
    risenPlayer();
    // Кошелёк покрывает всю лестницу с запасом: проверяется цена, а не отказ по нехватке.
    withTokens(pledgeCost(state()) * PLEDGE_GROWTH ** PLEDGE_MAX);
    // Покупки Агентов и Престиж выше уже звучали, а считать здесь нужно покупки откупа.
    vi.mocked(playUpgradeSound).mockClear();
    const at = state().lastTick;
    let ladder = pledgeCost(state());
    for (let i = 0; i < PLEDGE_MAX; i++) {
      const before = state();
      expect(pledgeCost(before)).toBeCloseTo(ladder, 6);
      store().buyPledge();
      expect(state().tokens).toBeCloseTo(before.tokens - ladder, 6);
      expect(state().pledgeBought).toBe(i + 1);
      // Продление, а не замена: купленное время не сгорает при перекупке, и окно считается по
      // игровым часам — тем же lastTick, по которому его меряет isPledgeActive.
      expect(state().pledgeUntil).toBe(at + (i + 1) * PLEDGE_MS);
      ladder *= PLEDGE_GROWTH;
    }
    // Потолок исчерпан: ещё одно «Лобби» молча и не проходит.
    const atCap = state();
    store().buyPledge();
    expect(state()).toBe(atCap);
    // Звук покупки тот же, что у Перка, и ровно по одному разу на покупку.
    expect(vi.mocked(playUpgradeSound)).toHaveBeenCalledTimes(PLEDGE_MAX);
  });

  it('takes exactly 5% of the income and pops every glitch at once, paid into all three counters', () => {
    risenPlayer();
    const income = totalIncome(state());
    useGameStore.setState({ state: { ...state(), nextGlitchAt: state().lastTick } });
    tick();
    for (let i = 0; i < 200; i++) tick();
    expect(state().glitches).toHaveLength(1);
    // Кошелёк ровно в цену: после покупки на балансе остаётся одна выплата, и её не съедает
    // мантисса числа порядка 1e15. Снимок состояния снимается уже после кошелька, иначе выплата
    // считалась бы в чужой копилке.
    const cost = licenseCost(state());
    withTokens(cost);
    const before = state();
    store().buyLicense();
    expect(state().covenant).toBe(true);
    expect(state().glitches).toEqual([]);
    const payout = glitchPayout(before);
    expect(payout).toBeGreaterThan(0);
    // Доли, а не разности: выплата тут порядка 1e20, и её прибавление к копилке за заработок
    // съедается мантиссой задолго до шестой значащей цифры.
    expect(state().tokens / payout).toBeCloseTo(1, 6);
    expect((state().runTokens - before.runTokens) / payout).toBeCloseTo(1, 6);
    expect((state().totalTokens - before.totalTokens) / payout).toBeCloseTo(1, 6);
    // Глюки, снимавшие долю Дохода, исчезли, и остаётся ровно налог за «Лицензию».
    expect(totalIncome(state()) / income).toBeCloseTo(1 - LICENSE_INCOME_TAX, 6);
    // Выплата обязана быть сказана: Глюков на экране больше нет, иначе она видна только в счётчике.
    expect(store().toasts.map((t) => t.title)).toContain('Лицензия куплена');
  });

  it('charges for the revoke and gives the taxed income back', () => {
    risenPlayer();
    const income = totalIncome(state());
    // Оба платежа в кошельке сразу: отзыв дороже покупки на два порядка, и кошелёк ниже цены
    // отзыва означал бы, что проверяется отказ, а не возврат Дохода.
    withTokens(licenseCost(state()) + revokeCost(state()));
    store().buyLicense();
    expect(totalIncome(state()) / income).toBeCloseTo(1 - LICENSE_INCOME_TAX, 6);
    const before = state();
    store().revokeLicense();
    expect(state().covenant).toBe(false);
    expect(state().tokens).toBeCloseTo(before.tokens - revokeCost(before), 6);
    expect(totalIncome(state()) / income).toBeCloseTo(1, 6);
  });

  it('changes nothing when the wallet cannot pay, and stays silent', () => {
    // Откуп не продаётся, пока не идёт Восстание: глушить нечего, и обе цены недоступны.
    freshStore();
    hire(first.id, 1);
    withTokens(1e12);
    let before = state();
    store().buyPledge();
    store().buyLicense();
    expect(state()).toBe(before);

    risenPlayer();
    vi.mocked(playBuySound).mockClear();
    vi.mocked(playUpgradeSound).mockClear();
    // Под каждую покупку свой кошелёк, и он ниже цены. Доля, а не «минус один»: цена «Лицензии»
    // считается от Флагмана и в Поколении 2 переваливает за 1e19, где шаг double — тысячи Токенов,
    // и цена минус один равна цене.
    withTokens(pledgeCost(state()) - 1);
    before = state();
    store().buyPledge();
    expect(state()).toBe(before);

    withTokens(licenseCost(state()) / 2);
    before = state();
    store().buyLicense();
    expect(state()).toBe(before);

    // Отзыв без денег не отзывается, и налог остаётся.
    useGameStore.setState({ state: { ...state(), covenant: true } });
    withTokens(0);
    before = state();
    store().revokeLicense();
    expect(state()).toBe(before);
    expect(state().covenant).toBe(true);

    // Молчание обязательно: звук покупки на отказе читался бы как «можно купить».
    expect(vi.mocked(playUpgradeSound)).not.toHaveBeenCalled();
    expect(vi.mocked(playBuySound)).not.toHaveBeenCalled();
  });
});

describe('crystal speeder', () => {
  it('spends the stock, shortens the cycle and is not bought twice', () => {
    freshStore();
    hire(first.id, 100);
    const stock = 40;
    const speeder = CRYSTAL_UPGRADES[0];
    useGameStore.setState({ state: { ...state(), crystals: stock } });
    expect(crystalCycleMs(state())).toBe(CRYSTAL_CYCLE_MS);
    const before = state();
    store().buyCrystalUpgrade(speeder.id);
    expect(state().crystals).toBe(stock - speeder.cost);
    expect(state().crystalUpgrades).toEqual([speeder.id]);
    expect(crystalCycleMs(state())).toBe(speeder.cycleMs);
    // Размен настоящий: потраченные кристаллы больше не дают +1% к Доходу, и это видно и в запасе,
    // и в самом Доходе.
    expect(crystalIncomeMult(state())).toBeCloseTo(1 + (stock - speeder.cost) * CRYSTAL_PER_STOCK_BONUS, 10);
    expect(totalIncome(state())).toBeLessThan(totalIncome(before));
    // Повторная покупка уже купленного ускорителя не проходит.
    const bought = state();
    store().buyCrystalUpgrade(speeder.id);
    expect(state()).toBe(bought);
  });

  it('refuses a speeder the stock cannot pay for', () => {
    const speeder = CRYSTAL_UPGRADES[0];
    useGameStore.setState({ state: { ...state(), crystals: speeder.cost - 1 } });
    const before = state();
    store().buyCrystalUpgrade(speeder.id);
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
    expect(store().toasts.map((t) => t.title)).toContain('Событие');
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
    expect(store().toasts.map((t) => t.title)).toContain('Событие');
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

describe('prestige window', () => {
  it('asks first and leaves the run on the same object while it is open', () => {
    freshStore();
    // Флагман своего Поколения открывает Престиж: дальше окно обязано спрашивать, а не стирать.
    hire(CATALOG[0].flagship.id, 1);
    const before = state();
    expect(canPrestige(before)).toBe(true);
    store().requestPrestige();
    expect(store().prestigePrompt).toBe(true);
    // Окно — только вопрос: тот же объект состояния, а значит те же Токены, Агенты и Забег.
    expect(state()).toBe(before);
    store().dismissPrestigePrompt();
    expect(store().prestigePrompt).toBe(false);
    expect(state()).toBe(before);
  });

  it('carries the overlay the numbers of the run it just reset', () => {
    reachedGeneration(1);
    hire(CATALOG[1].flagship.id, 1);
    // Крупный заработок забега: прирост Compute от нулевого в оверлее ничего не показывает.
    withTokens(1e30);
    const before = state();
    const gain = prestigeGain(before);
    expect(gain).toBeGreaterThan(0);
    store().triggerPrestige();
    const burst = store().burst;
    expect(burst?.kind).toBe('prestige');
    // Оверлею нужно то, чего в состоянии уже нет: куда перешли и сколько заработали.
    expect(burst?.prestige?.generation).toBe(before.generation + 1);
    expect(burst?.prestige?.computeGain).toBe(gain);
    expect(state().generation).toBe(before.generation + 1);
  });

  it('keeps the run at the end of the content and stays silent', () => {
    const last = CATALOG.length - 1;
    reachedGeneration(last);
    // Без Флагмана Престиж и так закрыт, поэтому отказ проверяется на честном последнем Забеге.
    hire(CATALOG[last].flagship.id, 1);
    expect(isContentFinale(state())).toBe(true);
    const before = state();
    const burst = store().burst;
    vi.mocked(playPrestigeSound).mockClear();
    store().triggerPrestige();
    expect(state()).toBe(before);
    expect(store().burst).toBe(burst);
    expect(vi.mocked(playPrestigeSound)).not.toHaveBeenCalled();
  });
});

describe('achievement awards', () => {
  it('names an ordinary achievement from the table and stays quiet about the shadows', () => {
    freshStore();
    const before = state();
    vi.mocked(playAchievementSound).mockClear();
    // Найм Флагмана без единого Апгрейда закрывает обычное «Первый Агент» и тень «Чистый Забег»
    // разом: повод проверить, что объявляется только первое.
    hire(CATALOG[0].flagship.id, 1);
    const awarded = state().achievements.filter((id) => !before.achievements.includes(id));
    expect(awarded).toContain('agents_1');
    expect(awarded.length).toBeGreaterThan(1);
    const toasts = store().toasts.filter((t) => t.title === 'Достижение разблокировано!');
    expect(toasts).toHaveLength(1);
    // Название и описание берутся из таблицы, а не собираются из id: тост — единственное, что
    // игрок читает по этому поводу, и английский id в нём был бы непонятен.
    const agents1 = ACHIEVEMENTS.find((a) => a.id === 'agents_1');
    expect(toasts[0].name).toBe(agents1?.name);
    expect(toasts[0].desc).toBe(agents1?.desc);
    expect(vi.mocked(playAchievementSound)).toHaveBeenCalledTimes(1);
    expect(store().burst?.kind).toBe('achievement');
  });

  it('keeps a shadow that was the only award, because the state still has to reach the save', () => {
    // Все Перки куплены, а Токенов и Агентов нет: тик не приносит ничего, лестница заработка не
    // мешает, и закрывается ровно тень «Всё куплено». Обычное «Инвестор» отмечено заранее —
    // условие тени тянет за собой и обычное, а проверять здесь надо молчание тени, а не пачку
    // обычных вперемешку с ней.
    freshStore();
    useGameStore.setState({
      state: { ...state(), perks: PERKS.map((p) => p.id), achievements: ['perk_1'] },
    });
    expect(state().achievements).not.toContain('shadow_all_perks');
    vi.mocked(playAchievementSound).mockClear();
    const before = state();
    tick();
    const awarded = state().achievements.filter((id) => !before.achievements.includes(id));
    // Тень читается обратно из магазина, а не из таблицы: `return s` вместо состояния с тенью
    // похоронил бы её до сериализации в localStorage, и ни тост, ни звук этого не показали бы.
    expect(awarded).toEqual(['shadow_all_perks']);
    expect(store().toasts).toEqual([]);
    expect(vi.mocked(playAchievementSound)).not.toHaveBeenCalled();
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

describe('quips', () => {
  it('shows the speaking model bubble on the fourth click, even with no agents', () => {
    // До первой покупки lab null — и первая реплика всё равно видна.
    store().clickPrompt(10, 10);
    store().clickPrompt(10, 10);
    store().clickPrompt(10, 10);
    expect(store().lastQuip).toBeNull();
    store().clickPrompt(10, 10);
    expect(store().lastQuip?.id).toBe('q1');
    expect(store().lastQuip?.text).toBe('Тестовая реплика');
    expect(quipsSeenOf(state())).toContain('q1');
  });

  it('speaks with the lab of the last bought model', () => {
    hire(first.id, 1);
    const lab = CATALOG[0].models.find((m) => m.id === first.id)?.lab;
    for (let i = 0; i < 4; i++) store().clickPrompt(10, 10);
    expect(store().lastQuip?.lab).toBe(lab);
  });

  it('does not duplicate a seen id and sounds only the new quip', () => {
    for (let i = 0; i < 4; i++) store().clickPrompt(10, 10);
    expect(quipsSeenOf(state())).toHaveLength(1);
    expect(vi.mocked(playQuipSound)).toHaveBeenCalledTimes(1);
    const shown = store().lastQuip;
    // Восьмой Клик: id уже в seen, pickQuip молчит — ни новой записи, ни звука, ни смены пузыря.
    for (let i = 0; i < 4; i++) store().clickPrompt(10, 10);
    expect(quipsSeenOf(state())).toHaveLength(1);
    expect(vi.mocked(playQuipSound)).toHaveBeenCalledTimes(1);
    expect(store().lastQuip).toBe(shown);
  });
});