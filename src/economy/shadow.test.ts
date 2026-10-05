import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  awardAchievements,
  awardShadowAchievements,
  newlyEarned,
  newlyEarnedShadows,
  nonShadowCount,
  ordinaryEarned,
  shadowEarned,
} from './achievements';
import { CATALOG, LAST_GENERATION, prestigeDivisor, type Model } from './catalog';
import {
  advance,
  applyOffline,
  bulkCost,
  buyAgents,
  buyPerk,
  buyUpgrade,
  click,
  prestige,
  totalIncome,
} from './engine';
import { GEN_PERK_BASE_COST, GEN_PERK_STEP_COST, isGenPerkId, PERKS } from './perks';
import { migrate } from './save';
import { newGame, SAVE_VERSION, type GameState } from './state';
import { QUIPS } from '../data/quips';
import { SHADOW_ACHIEVEMENTS } from './shadow';
import { CLICK_UPGRADES, clickUpgradeId } from './upgrades';

const T0 = 1_000_000;
const HOUR = 3_600_000;
const g0 = CATALOG[0];
const g2 = CATALOG[2];
const last = CATALOG[LAST_GENERATION];

/** Токены в кармане: тесты строят конец игры, а не играют до него. */
const rich = (s: GameState, tokens: number): GameState => ({ ...s, tokens, runTokens: tokens });

/** Сколько стоит `n` Агентов Модели с нуля: цена берётся из движка, а не выдумывается. */
const priceOf = (m: Model, n: number): number => bulkCost(m, 0, n);

/** Сколько Кликов подряд: клик — самый дешёвый переход, поэтому набирается циклом. */
const clickN = (s: GameState, n: number): GameState => {
  let out = s;
  for (let i = 0; i < n; i++) out = click(out);
  return out;
};

/**
 * Дождаться, пока Доход наберёт `tokens`: время считается из настоящего Дохода.
 * Запас вчетверо нужен потому, что иначе округление double решает, закрыт ли рубеж,
 * и тест зависит от погрешности деления вместо условия Достижения.
 */
const idle = (s: GameState, tokens: number): GameState => advance(s, (tokens * 4) / totalIncome(s));

/** Перк «Скрипт-автокликер» куплен и Клики идут со скоростью 1/сек. */
const autoClicking = (s: GameState): GameState => buyPerk({ ...s, compute: 25 }, 'autoclick');

/**
 * Compute на весь список Перков.
 *
 * У особых Перков Поколения цена в таблице — только базовая: настоящая растёт с числом уже
 * купленных, поэтому сумма берётся из тех же констант, что и движок, а не складывается из
 * `p.cost`. Иначе сумма была бы меньше нужной, и последний особый Перк просто не купился бы.
 */
const ALL_PERKS_COMPUTE =
  PERKS.filter((p) => !isGenPerkId(p.id)).reduce((n, p) => n + p.cost, 0) +
  CATALOG.reduce(
    (n, _g, i) => n + GEN_PERK_BASE_COST + GEN_PERK_STEP_COST * i,
    0
  );

/**
 * Все Поколения пройдены Престижами, Флагман каждого куплен по-настоящему.
 * `stepMs` — игровое время между Престижами: спринт отличается от прогулки только им.
 */
const prestigeToFrontier = (stepMs = 0): GameState => {
  let s = newGame(T0);
  for (let g = 0; g < CATALOG.length - 1; g++) {
    s = prestige(buyAgents(rich(s, 1e50), CATALOG[g].flagship.id, 1), T0 + g * stepMs);
  }
  return s;
};

/** Купить по `n` Агентов каждой Модели, ровно на сумму их цен. */
const hireAll = (s: GameState, models: Model[], n: number): GameState =>
  models.reduce((st, m) => buyAgents(st, m.id, n), rich(s, models.reduce((sum, m) => sum + priceOf(m, n), 0)));

/**
 * Конец игры: последнее Поколение и по 2000 Агентов каждой Модели — 10 000 Агентов.
 * Объёмы взяты из цен движка и остаются конечными числами: 1e650 в double — это Infinity,
 * и такой «богатый» игрок не смог бы даже купить первого Агента.
 */
const lateGame = (): GameState => hireAll(prestigeToFrontier(1_000), last.models, 2_000);

/** Поколение 1 закрыто целиком: 100 Агентов одной Модели, все Модели, Апгрейд, 10 000 Кликов. */
const firstGenerationCleared = (): GameState => {
  let s = buyAgents(rich(newGame(T0), 1e30), g0.models[0].id, 100);
  for (const m of g0.models) s = buyAgents(s, m.id, 1);
  s = buyUpgrade(s, clickUpgradeId(0, 0));
  return idle(clickN(s, 10_000), 1e10);
};

/** Состояние, в котором выполнено условие каждой тени. Шутка недостижима by design. */
const REACH: Record<string, () => GameState> = {
  // Перк даёт Клик в секунду: 100 000 Кликов — это 27 суток непрерывной игры.
  shadow_click_100k: () => advance(autoClicking(newGame(T0)), 100_000),
  shadow_early_roster: () => awardAchievements(firstGenerationCleared()).state,
  shadow_final_no_upgrade: () => hireAll(prestigeToFrontier(), [last.flagship], 1),
  shadow_final_no_perk: () => prestigeToFrontier(),
  // 25 000 Кликов в Поколении 1: заработок идёт в Клики, ни одного Агента так и не нанято.
  shadow_purist_25k: () => clickN(newGame(T0), 25_000),
  // Три Модели Поколения 3 по одному Агенту, Флагман включён — Забег уже можно закрыть.
  shadow_minimal_roster: () =>
    [g2.models[0], g2.models[1], g2.flagship].reduce(
      (s, m) => buyAgents(rich(s, 1e30), m.id, 1),
      { ...newGame(T0), generation: 2, maxGeneration: 2 },
    ),
  // Простой длиннее лимита Оффлайн-дохода: 100 часов при lastTick, приведённом к now.
  shadow_100_hours: () => applyOffline(newGame(T0), T0 + 100 * HOUR).state,
  shadow_all_click_upgrades: () =>
    CLICK_UPGRADES.reduce((s, _, i) => buyUpgrade(s, clickUpgradeId(0, i)), rich(newGame(T0), 1e12)),
  shadow_click_worth_1e24: () => lateGame(),
  shadow_one_model_1000: () => hireAll(prestigeToFrontier(), [last.models[0]], 1_000),
  shadow_flagship_500: () => hireAll(prestigeToFrontier(), [last.flagship], 500),
  shadow_swarm_10k: () => hireAll(prestigeToFrontier(), last.models, 2_000),
  // Купить весь список: состояние берётся с последнего Поколения и с Флагманом, потому что
  // особый Перк своего Поколения без canPrestige недоступен, а прошедшие Поколения открыты.
  shadow_all_perks: () =>
    PERKS.reduce(
      (s, p) => buyPerk(s, p.id),
      { ...hireAll(prestigeToFrontier(), [last.flagship], 1), compute: ALL_PERKS_COMPUTE }
    ),
  shadow_run_clicks_100k: () => advance(autoClicking(newGame(T0)), 100_000),
  shadow_compute_hoarder: () => prestige(buyAgents(rich(newGame(T0), 1e30), g0.flagship.id, 1), T0),
  // Четыре тени из ранней ветки: id те же, условия переписаны под контракт таблицы теней —
  // одно состояние, ноль Date.now. Миллион без единого Клика: Агент-флагман Поколения 1 зарабатывает
  // его за десяток секунд, поэтому «быстрее 15 минут» выполняется целиком, а не впритык.
  sh_no_click: () => idle(buyAgents(rich(newGame(T0), 1e30), g0.flagship.id, 1), 1e6),
  // «Быстрее 15 минут» требует Дохода, при котором миллион набегает за минуты: одного
  // флагмана Поколения 1 мало (12 Токенов в секунду — это сутки), нужен состав. Состав
  // собран напрямую в состоянии, а не покупками: тест проверяет условие тени, а не
  // достижимость рубежа в игре — её проверяют симулятор и тесты экономики.
  sh_speed: () => {
    const stocked: GameState = {
      ...newGame(T0),
      agents: Object.fromEntries(g0.models.map((m) => [m.id, 50])),
      tokens: 0,
    };
    return idle(stocked, 1e6);
  },
  sh_hardcore: () => buyAgents(rich(newGame(T0), 1e30), g0.flagship.id, 1),
  // 778³ × делитель — минимальный заработок, дающий прирост 777, и минус единица, чтобы
  // кубический корень не перевалил через 778.
  sh_777: () => ({ ...newGame(T0), runTokens: Math.pow(778, 3) * prestigeDivisor(0) - 1 }),
  // Числовая лестница: Доход последнего Поколения доводит общий счёт до любого рубежа.
  shadow_tok_33: () => idle(lateGame(), 1e33),
  shadow_tok_45: () => idle(lateGame(), 1e45),
  shadow_tok_60: () => idle(lateGame(), 1e60),
  shadow_tok_80: () => idle(lateGame(), 1e80),
  shadow_tok_110: () => idle(lateGame(), 1e110),
  shadow_tok_150: () => idle(lateGame(), 1e150),
  shadow_tok_200: () => idle(lateGame(), 1e200),
  shadow_tok_260: () => idle(lateGame(), 1e260),
  shadow_tok_300: () => idle(lateGame(), 1e300),
  shadow_run_1e300: () => idle(lateGame(), 1e300),
  // Спринт: все Престижи за шесть секунд игровых часов. Счётчик Престижей упирается в
  // число Поколений (Престиж запрещён на последнем), поэтому ускоряется здесь только время.
  shadow_all_prestiges_15m: () => prestigeToFrontier(1_000),
  // Три тени «Говорящих Моделей»: состояния собираются из той же таблицы реплик,
  // что и игра, а не из захардкоженных id, иначе правка таблицы тихо роняла бы тест.
  shadow_quips_5: () => ({ ...newGame(T0), quipsSeen: QUIPS.slice(0, 5).map((q) => q.id) }),
  shadow_quips_50: () => ({ ...newGame(T0), quipsSeen: QUIPS.slice(0, 50).map((q) => q.id) }),
  shadow_quips_lab: () => ({
    ...newGame(T0),
    quipsSeen: QUIPS.filter((q) => q.lab === 'openai').map((q) => q.id),
  }),
};

/** Тень, условие которой нельзя выполнить ни в какой момент игры. */
const UNREACHABLE = 'shadow_blind_modal';

/** Состояния для проверок чистоты: пустое, начало Поколения 1 и конец игры. */
const probes = (): GameState[] => [
  newGame(T0),
  clickN(newGame(T0), 10_000),
  applyOffline(newGame(T0), T0 + 100 * HOUR).state,
  lateGame(),
  idle(lateGame(), 1e45),
];

const deepFreeze = (v: unknown): void => {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
};

describe('теневая лестница не трогает обычные достижения', () => {
  it('держит знаменатель обычных Достижений на 21', () => {
    expect(ACHIEVEMENTS.length).toBe(21);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(21);
    expect(SHADOW_ACHIEVEMENTS.length).toBeGreaterThanOrEqual(24);
    // Потолок поднят под три тени реплик (31 + 3 = 34): лестница растёт, а знаменатель
    // обычных Достижений обязан стоять — иначе тени снова слились бы с обычными.
    expect(SHADOW_ACHIEVEMENTS.length).toBeLessThanOrEqual(35);
  });

  it('не смешивает id двух лестниц', () => {
    const ordinary = new Set(ACHIEVEMENTS.map((a) => a.id));
    const shadows = new Set(SHADOW_ACHIEVEMENTS.map((a) => a.id));
    expect(shadows.size).toBe(SHADOW_ACHIEVEMENTS.length);
    for (const id of shadows) expect(ordinary.has(id)).toBe(false);
  });

  it('считает обычные по id, а не по длине списка', () => {
    const earned = [...ACHIEVEMENTS, ...SHADOW_ACHIEVEMENTS].reduce(
      (s, a) => ({ ...s, achievements: [...s.achievements, a.id] }),
      newGame(T0),
    );
    // Длина списка после теней перестала быть числителем — иначе счётчик ушёл бы за 21.
    expect(earned.achievements.length).toBeGreaterThan(ACHIEVEMENTS.length);
    expect(ordinaryEarned(earned)).toBe(ACHIEVEMENTS.length);
    expect(ordinaryEarned(earned) / ACHIEVEMENTS.length).toBe(1);
    expect(shadowEarned(earned)).toBe(SHADOW_ACHIEVEMENTS.length);
  });

  it('не выдаёт тени при awardAchievements и не выдаёт обычные при awardShadowAchievements', () => {
    const state = idle(lateGame(), 1e45);
    const isShadow = (id: string) => SHADOW_ACHIEVEMENTS.some((a) => a.id === id);

    const ordinary = awardAchievements(state);
    expect(ordinary.awarded.some(isShadow)).toBe(false);
    expect(ordinary.state.achievements.some((id) => id.startsWith('shadow_'))).toBe(false);
    expect(newlyEarnedShadows(state).length).toBeGreaterThan(0);

    const shadows = awardShadowAchievements(state);
    expect(shadows.awarded.length).toBeGreaterThan(0);
    expect(shadows.awarded.every(isShadow)).toBe(true);
    // Обычный числитель от выдачи теней не сдвигается ни на единицу.
    expect(ordinaryEarned(shadows.state)).toBe(ordinaryEarned(state));
  });

  it('переживает загрузку без миграции: migrate отбрасывает только Модели, Апгрейды и Перки', () => {
    const raw = { ...newGame(T0), version: SAVE_VERSION, achievements: [UNREACHABLE, 'click_1', 'неизвестный-id'] };
    const loaded = migrate(raw, T0);
    expect(loaded.achievements).toEqual([UNREACHABLE, 'click_1', 'неизвестный-id']);
    expect(ordinaryEarned(loaded)).toBe(1);
    // Тени не заводят новую версию сохранения: форма GameState не менялась, а запись id теней
    // пережила загрузку на той же версии, на которой была записана.
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(shadowEarned(loaded)).toBe(1);
  });

  it('держит id теней из ранней ветки: переименование осиротило бы запись в сохранении', () => {
    // Эти четыре id уже могут лежать у живого игрока в `state.achievements`. migrate отбрасывает
    // только Модели, Апгрейды и Перки, а теневой id не проверяется ничем — то есть переименованная
    // тень не была бы отброшена как положено, а просто исчезла бы из своего счётчика навсегда.
    const ids = SHADOW_ACHIEVEMENTS.map((a) => a.id);
    for (const id of ['sh_no_click', 'sh_speed', 'sh_hardcore', 'sh_777']) expect(ids).toContain(id);
    const written = ids.reduce((acc, id) => ({ ...acc, achievements: [...acc.achievements, id] }), newGame(T0));
    expect(shadowEarned(migrate(written, T0))).toBe(SHADOW_ACHIEVEMENTS.length);
    expect(nonShadowCount(migrate(written, T0))).toBe(0);
  });
});

describe('каждое теневое достижение достижимо', () => {
  it('имеет состояние, в котором условие истинно', () => {
    const missing = SHADOW_ACHIEVEMENTS.filter((a) => a.id !== UNREACHABLE && !REACH[a.id]).map((a) => a.id);
    expect(missing).toEqual([]);
    const unmet = SHADOW_ACHIEVEMENTS.filter((a) => a.id !== UNREACHABLE && !a.check(REACH[a.id]())).map((a) => a.id);
    expect(unmet).toEqual([]);
  });

  it('не выдаётся в пустом новом игре', () => {
    expect(SHADOW_ACHIEVEMENTS.filter((a) => a.check(newGame(T0))).map((a) => a.id)).toEqual([]);
    expect(newlyEarnedShadows(newGame(T0))).toEqual([]);
  });

  it('остаётся недостижимой шуткой даже в максимальном состоянии', () => {
    const joke = SHADOW_ACHIEVEMENTS.find((a) => a.id === UNREACHABLE)!;
    expect(joke.check(lateGame())).toBe(false);
    expect(joke.check(idle(lateGame(), 1e300))).toBe(false);
    expect(newlyEarnedShadows(idle(lateGame(), 1e300))).not.toContain(UNREACHABLE);
  });

  it('идёт по возрастанию: числовая лестница и её рубежи', () => {
    const prefix = 'shadow_tok_';
    const rungs = SHADOW_ACHIEVEMENTS.filter((a) => a.id.startsWith(prefix)).map((a) => Number(a.id.slice(prefix.length)));
    expect(rungs).toEqual([33, 45, 60, 80, 110, 150, 200, 260, 300]);
    for (let i = 1; i < rungs.length; i++) expect(rungs[i]).toBeGreaterThan(rungs[i - 1]);
    // Обычные Достижения кончаются на 1e27 — лестница начинается строго выше.
    expect(rungs[0]).toBeGreaterThan(27);
  });

  it('числовая лестница закрывается ровно на своём рубеже', () => {
    const prefix = 'shadow_tok_';
    for (const a of SHADOW_ACHIEVEMENTS.filter((x) => x.id.startsWith(prefix))) {
      const rung = Math.pow(10, Number(a.id.slice(prefix.length)));
      expect(a.check({ ...newGame(T0), totalTokens: rung })).toBe(true);
      // Ниже рубежа — минус процент, а не единица: на 1e300 шаг float64 шире единицы,
      // и `rung - 1` сравнялось бы с самим рубежом.
      expect(a.check({ ...newGame(T0), totalTokens: (rung * 9) / 10 })).toBe(false);
    }
  });

  it('награждает тень один раз и не выдаёт её повторно', () => {
    const state = idle(lateGame(), 1e45);
    const first = awardShadowAchievements(state);
    expect(first.awarded.length).toBeGreaterThan(0);
    const second = awardShadowAchievements(first.state);
    expect(second.awarded).toEqual([]);
    // Контракт стор-а: пустой список — это тот же объект состояния, а не копия.
    expect(second.state).toBe(first.state);
    expect(newlyEarned(first.state).every((id) => !id.startsWith('shadow_'))).toBe(true);
  });

  it('остаётся закрытой после потери условия, поэтому тень и лежит в сохранении', () => {
    const earned = awardShadowAchievements(clickN(newGame(T0), 25_000)).state;
    expect(earned.achievements).toContain('shadow_purist_25k');
    // Престиж обнуляет runClicks — условие перестаёт быть истинным.
    const afterPrestige = { ...earned, runClicks: 0 };
    const shadow = SHADOW_ACHIEVEMENTS.find((a) => a.id === 'shadow_purist_25k')!;
    expect(shadow.check(afterPrestige)).toBe(false);
    // Записанная тень не отнимается и не выдаётся заново.
    expect(shadowEarned(afterPrestige)).toBe(shadowEarned(earned));
    expect(awardShadowAchievements(afterPrestige).awarded).not.toContain('shadow_purist_25k');
  });
});

describe('тени, пришедшие из ранней ветки', () => {
  const check = (id: string) => SHADOW_ACHIEVEMENTS.find((a) => a.id === id)!.check;

  it('sh_no_click: миллион за Забег не более чем за 15 Кликов', () => {
    const ok: GameState = { ...newGame(T0), runTokens: 1e6, runClicks: 15 };
    expect(check('sh_no_click')(ok)).toBe(true);
    expect(check('sh_no_click')({ ...ok, runClicks: 16 })).toBe(false);
    // Порог по заработку тот же: без миллиона тень не выдаётся ни при каких Кликах.
    expect(check('sh_no_click')({ ...newGame(T0), runClicks: 0 })).toBe(false);
  });
  it('sh_speed: тот же миллион, но уложиться в 15 минут Забега', () => {
    const ok: GameState = { ...newGame(T0), runTokens: 1e6, lastTick: T0 + 900_000, runStartedAt: T0 };
    expect(check('sh_speed')(ok)).toBe(true);
    expect(check('sh_speed')({ ...ok, lastTick: T0 + 900_001 })).toBe(false);
    // Часы идут от lastTick, а не от Date.now: простой приводит lastTick к текущему времени,
    // и после двух часов в закрытом окне спринт засчитывать уже нечего.
    const away = applyOffline({ ...newGame(T0), agents: { [g0.flagship.id]: 1 } }, T0 + HOUR).state;
    expect(away.lastTick).toBe(T0 + HOUR);
    expect(check('sh_speed')({ ...away, runTokens: 1e6 })).toBe(false);
  });
  it('sh_hardcore: Флагман текущего Поколения и ни одного Апгрейда', () => {
    const s = buyAgents(rich(newGame(T0), 1e30), g0.flagship.id, 1);
    expect(check('sh_hardcore')(s)).toBe(true);
    // Любой купленный Апгрейд убивает чистый Забег, а не только флагманский.
    expect(check('sh_hardcore')(buyUpgrade(s, clickUpgradeId(0, 0)))).toBe(false);
    // Переход в следующее Поколение оставляет Флагмана позади: флагман Поколения 1 — не флагман
    // Поколения 2, и условие без найма нового не выполняется.
    expect(check('sh_hardcore')({ ...s, generation: 1, maxGeneration: 1 })).toBe(false);
  });
  it('sh_777: прирост Престижа с цифрами 777, и выдаётся только теньми', () => {
    const gain = { ...newGame(T0), runTokens: Math.pow(778, 3) * prestigeDivisor(0) - 1 };
    expect(check('sh_777')(gain)).toBe(true);
    expect(newlyEarnedShadows(gain)).toContain('sh_777');
    // Обычная выдача про это условие молчит: тень не смешивается с обычной лестницей.
    expect(newlyEarned(gain)).not.toContain('sh_777');
    // Соседний заработок даёт прирост 778 — условие проверяет число, а не форму записи.
    expect(check('sh_777')({ ...gain, runTokens: Math.pow(779, 3) * prestigeDivisor(0) })).toBe(false);
    expect(check('sh_777')({ ...newGame(T0), runTokens: 1e6 })).toBe(false);
  });
});

describe('детерминированность', () => {
  it('одинаковое состояние даёт одинаковый ответ', () => {
    for (const s of probes()) {
      const clone = JSON.parse(JSON.stringify(s)) as GameState;
      const once = SHADOW_ACHIEVEMENTS.map((a) => a.check(s));
      expect(SHADOW_ACHIEVEMENTS.map((a) => a.check(s))).toEqual(once);
      expect(SHADOW_ACHIEVEMENTS.map((a) => a.check(clone))).toEqual(once);
    }
  });

  it('не меняет состояние: на замороженном снимке все check возвращают boolean', () => {
    for (const s of probes()) {
      const before = JSON.stringify(s);
      const frozen = JSON.parse(before) as GameState;
      deepFreeze(frozen);
      for (const a of SHADOW_ACHIEVEMENTS) expect(typeof a.check(frozen)).toBe('boolean');
      expect(JSON.stringify(s)).toBe(before);
    }
  });

  it('не читает Date.now и Math.random', () => {
    const clock = Date.now;
    const dice = Math.random;
    const states = probes();
    Date.now = () => {
      throw new Error('check теней читает Date.now');
    };
    Math.random = () => {
      throw new Error('check теней читает Math.random');
    };
    try {
      for (const s of states) for (const a of SHADOW_ACHIEVEMENTS) a.check(s);
    } finally {
      Date.now = clock;
      Math.random = dice;
    }
  });
});
