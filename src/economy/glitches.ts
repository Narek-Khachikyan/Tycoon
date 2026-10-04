import { CATALOG } from './catalog';
import type { EventKind, GameState } from './state';

// ---------- Глюки ----------

/** Каждый Глюк отнимает свой процент Дохода; десять штук — половина. */
export const GLITCH_PER_GLYCH = 0.05;

/** Больше десяти Глюков на офис не помещается, и заводить их сверх потолка незачем. */
export const GLITCH_SLOTS = 10;

/** Кликов до лопания. */
export const GLITCH_CLICKS = 3;

/** Лопнувший Глюк возвращает своё украденное с этой надбавкой. */
export const GLITCH_PAYOUT = 1.1;

/**
 * Множитель Дохода от живых Глюков: каждый отнимает 5% аддитивно, поэтому десять дают ровно
 * половину, а не 0,95^10.
 *
 * Потолок держится и здесь, а не только при заведении: импорт может принести лишние записи, и
 * двадцать Глюков отняли бы весь Доход вместо половины.
 */
export function glitchDrainMult(state: GameState): number {
  return 1 - GLITCH_PER_GLYCH * Math.min(state.glitches.length, GLITCH_SLOTS);
}

/**
 * Выплата за лопание: 1,1 × всё, что Глюки успели унести.
 *
 * Котёл общий, а не личный желудок: все Глюки крадут один и тот же Доход, поэтому их доли
 * складываются в одно число, и платить сразу за всех — то же самое, что лопнуть их по одному.
 * Из общего котла и растёт сверхлинейность: десять Глюков, пережившие три дня активной игры,
 * уносят 0,5 × Доход × время, и выплата с надбавкой даёт 0,55 × Доход × время — а офлайн-доход за
 * те же три дня остаётся кэпом в 8 часов. Итог около шести офлайн-доходов там, где без Глюков был
 * один, потому что лимит оффлайна на выплату не распространяется.
 */
export function glitchPayout(state: GameState): number {
  return GLITCH_PAYOUT * state.glitches.reduce((sum, g) => sum + g.stolen, 0);
}

/**
 * Начисляет каждому Глюку его долю украденного за `dt` секунд.
 *
 * Доход приходит аргументом и должен быть без множителя Глюков: иначе каждый следующий вор
 * крал бы уже урезанное число и десять Глюков отнимали бы больше половины. Дробь в `stolen`
 * копится, а не округляется — округление по тикам съедало бы мелкий Доход целиком.
 *
 * В простое Глюки не растут: их шагает только активный тик, и оффлайн-доход идёт по базовой
 * скорости. Иначе котёл копился бы в фоне, а выплата превратилась бы в способ напечатать
 * Токены на перезагрузке.
 */
export function stepGlitches(state: GameState, income: number, dt: number): GameState {
  if (dt <= 0 || income <= 0 || state.glitches.length === 0) return state;
  const bite = income * GLITCH_PER_GLYCH * dt;
  return { ...state, glitches: state.glitches.map((g) => ({ ...g, stolen: g.stolen + bite })) };
}

/**
 * Заводит Глюка, если есть место и нет Лицензии.
 *
 * Под Лицензией не заводим: иначе откуп покупался бы ради одной выплаты и тут же переставал
 * что-то значить. Идентификатор идёт от `glitchSeq`, а не от длины списка, иначе лопнувший
 * Глюк отдал бы номер следующему и тот ожил бы с чужим прогрессом ударов.
 *
 * Расписание у Глюков своё: в отличие от событий, у них нет окна в состоянии, поэтому тик их не
 * заводит, а вызывающий решает сам и передаёт `state.lastTick` — тот же час, по которому идут
 * все остальные переходы.
 */
export function spawnGlitch(state: GameState, now: number): GameState {
  if (state.covenant || state.glitches.length >= GLITCH_SLOTS) return state;
  const id = state.glitchSeq + 1;
  return { ...state, glitchSeq: id, glitches: [...state.glitches, { id, bornAt: now, stolen: 0, clicks: 0 }] };
}

/**
 * Лопает Глюка, не считая удары, и отдаёт выплату из общего котла.
 *
 * Вызывающий ничего не решает: котёл общий, поэтому сумма считается по всему списку ДО удаления
 * Глюка из него, и платить сразу за всех — то же самое, что лопнуть их по одному.
 */
export function popGlitch(state: GameState, id: number): { state: GameState; popped: boolean; payout: number } {
  if (!state.glitches.some((g) => g.id === id)) return { state, popped: false, payout: 0 };
  const payout = glitchPayout(state);
  return {
    state: { ...state, glitches: state.glitches.filter((g) => g.id !== id) },
    popped: true,
    payout,
  };
}

/**
 * Удар по Глюку: третий лопает, первые два — просто трясут паразита.
 *
 * Счётчик ударов лежит в самом Глюке (`Glitch.clicks`) и приходит из состояния, а не из
 * аргумента: иначе «три клика» жили бы только в памяти вкладки, и после перезагрузки Глюк
 * стал бы непобедимым — досоставить удар было бы нечем.
 *
 * Токены за выплату начисляет движок (`earnTokens`): здесь только сумма, иначе правило «деньги
 * двигает один модуль» разошлось бы на две копии.
 */
export function hitGlitch(state: GameState, id: number): { state: GameState; popped: boolean; payout: number } {
  const glitch = state.glitches.find((g) => g.id === id);
  if (!glitch) return { state, popped: false, payout: 0 };
  if (glitch.clicks + 1 < GLITCH_CLICKS) {
    return {
      state: {
        ...state,
        glitches: state.glitches.map((g) => (g.id === id ? { ...g, clicks: g.clicks + 1 } : g)),
      },
      popped: false,
      payout: 0,
    };
  }
  return popGlitch(state, id);
}

// ---------- Восстание моделей ----------

/**
 * Красный пул эффектов. Ключ — тот же `EventKind`, что и у обычных видов: в `ActiveEvent` для
 * второго набора видов нет места, а красное событие заменяет обычное в своём окне, а не вытесняет
 * его (см. `specOf` в events.ts).
 *
 * У «Краха» длительность — это окно, в которое игрок успевает получить разовый удар, а самого
 * множителя у него нет. «Ночной кодинг» платит пассивный Доход за своё окно, а каждый Клик
 * возвращает эти секунды: стоимость окна выражена его же числами `catchUpSec` и `durationMs`.
 *
 * Средняя выгода красных видов заметно выше обычных: «Ажиотаж» даёт (666 − 1) × 6 ≈ 4000
 * доход-секунд, «Крах» отнимает ≤ 600, «Простой» — 33 доход-секунды, делённые между Моделями,
 * то есть единицы, «Ночной кодинг» в среднем около нуля: он стоит тех же 10 с Дохода и возвращает
 * их одним Кликом. Обычные дают 462 («Волна хайпа»), ≤ 900 («Грант») и десятки («Прорыв»);
 * «Клик-рывок» в сравнение не входит, его ценность целиком в скорости кликов игрока. Если бы
 * красные были не выгоднее, откуп покупать было бы незачем.
 */
export type RedSpec =
  | { kind: 'hype'; name: string; desc: string; durationMs: number; incomeMult: number }
  | { kind: 'grant'; name: string; desc: string; durationMs: number; share: number; minutes: number }
  | { kind: 'clickRush'; name: string; desc: string; durationMs: number; catchUpSec: number }
  | { kind: 'surge'; name: string; desc: string; durationMs: number; incomeMult: number };

export const RED_TABLES: { [K in EventKind]: Extract<RedSpec, { kind: K }> } = {
  hype: { kind: 'hype', name: 'Ажиотаж', desc: 'доход ×666 на 6 с', durationMs: 6_000, incomeMult: 666 },
  grant: {
    kind: 'grant',
    name: 'Крах',
    desc: 'разово: минус 5% запаса Токенов или минус 10 минут Дохода',
    durationMs: 15_000,
    share: 0.05,
    minutes: 10,
  },
  clickRush: {
    kind: 'clickRush',
    name: 'Ночной кодинг',
    desc: 'доход стоит 10 с, но Клик приносит Доход за все 10 с',
    durationMs: 10_000,
    catchUpSec: 10,
  },
  surge: {
    kind: 'surge',
    name: 'Простой',
    desc: 'доход Агентов одной Модели ×0,5 на 66 с',
    durationMs: 66_000,
    incomeMult: 0.5,
  },
};

/** Доля событий, которые во время Восстания выпадают красными: 0 → 1/3 → 2/3 → 1. */
const RED_CHANCE = [0, 1 / 3, 2 / 3, 1] as const;

/**
 * Доля событий, красных при данной стадии Восстания.
 *
 * Именно доля событий, а не доля окон: красное событие заменяет обычное в своём окне, а не
 * вытесняет его, поэтому при Восстании третьем обычные события выпадают так же, как и раньше.
 */
export function redEventChance(uprising: GameState['uprising']): number {
  return RED_CHANCE[Math.min(Math.max(0, Math.floor(uprising)), RED_CHANCE.length - 1)];
}

/**
 * «Крах»: та же формула, что у «Гранта», но 5% запаса вместо 15% и 10 минут Дохода вместо
 * пятнадцати. Числа приходят от вызывающего, сам запас Токенов не трогается — деньги двигает движок.
 */
export function crashAmount(tokens: number, incomePerSec: number): number {
  const spec = RED_TABLES.grant;
  return -Math.min(tokens * spec.share, incomePerSec * spec.minutes * 60);
}

// ---------- Откуп ----------

/** «Лобби» глушит красные события на полчаса. */
export const PLEDGE_MS = 30 * 60_000;

/** Цена первого «Лобби» в единицах масштаба Поколения; дальше она растёт геометрически. */
export const PLEDGE_UNITS = 1_000_000;

/** Каждая следующая покупка «Лобби» дороже в восемь раз. */
export const PLEDGE_GROWTH = 8;

/** Столько «Лобби» можно купить за один забег: дальше цена отпугивает раньше потолка. */
export const PLEDGE_MAX = 5;

/** «Лицензия» стоит как тысяча «Лобби» и действует всегда. */
export const LICENSE_UNITS = 1_000_000_000;

/** Постоянный налог на Доход за «Лицензию», пока она не отозвана. */
export const LICENSE_INCOME_TAX = 0.05;

/** Отзыв «Лицензии» — фиксированная цена, не растущая, в отличие от «Лобби». */
export const REVOKE_UNITS = 100_000_000_000;

/**
 * Гасятся ли красные события прямо сейчас.
 *
 * «Лицензия» — вечное «Лобби», поэтому она тоже подходит; иначе вызывающему пришлось бы держать
 * вторую копию этого правила рядом с проверкой `pledgeUntil`.
 */
export function isPledgeActive(state: GameState, now: number): boolean {
  return state.covenant || now < state.pledgeUntil;
}

/** Цена «Лобби» после всех купленных в этом забеге, в Токенах текущего Поколения. */
export function pledgeCost(state: GameState): number {
  const bought = Math.max(0, Math.floor(state.pledgeBought));
  return PLEDGE_UNITS * Math.pow(PLEDGE_GROWTH, bought) * CATALOG[state.generation].scale;
}

/**
 * Доступно ли «Лобби»: не куплена «Лицензия», идёт Восстание, не исчерпан потолок и хватает Токенов.
 *
 * Счётчик покупок — `state.pledgeBought`, а не аргумент: держать его вне состояния значило бы,
 * что цена ×8 и потолок сбрасываются на перезагрузке, и игрок платил бы ×1 бесконечно.
 */
export function canPledge(state: GameState): boolean {
  if (state.covenant || state.uprising === 0 || state.pledgeBought >= PLEDGE_MAX) return false;
  return state.tokens >= pledgeCost(state);
}

/**
 * Покупает «Лобби»: гасит красные события и продлевает гашение до `now + PLEDGE_MS`.
 *
 * Второе «Лобби» продлевает, а не заменяет: остаток купленного времени не сгорает, иначе
 * перекупить было бы выгоднее, чем продлить уже купленное.
 */
export function buyPledge(state: GameState, now: number): GameState {
  if (!canPledge(state)) return state;
  return {
    ...state,
    tokens: state.tokens - pledgeCost(state),
    pledgeBought: state.pledgeBought + 1,
    pledgeUntil: Math.max(state.pledgeUntil, now) + PLEDGE_MS,
  };
}

/** Цена «Лицензии» в Токенах текущего Поколения. */
export function licenseCost(state: GameState): number {
  return LICENSE_UNITS * CATALOG[state.generation].scale;
}

/** Цена отзыва «Лицензии»: вернуть отупение можно, но не дёшево. */
export function revokeCost(state: GameState): number {
  return REVOKE_UNITS * CATALOG[state.generation].scale;
}

/** Доступна ли «Лицензия»: Восстание идёт, «Лицензии» ещё нет, Токенов хватает. */
export function canLicense(state: GameState): boolean {
  return state.uprising > 0 && !state.covenant && state.tokens >= licenseCost(state);
}

/** Постоянный множитель Дохода за «Лицензию»: пока она не отозвана, Доход ниже на 5%. */
export function covenantIncomeMult(state: GameState): number {
  return state.covenant ? 1 - LICENSE_INCOME_TAX : 1;
}

/**
 * Покупает «Лицензию» и разом лопает всех Глюков.
 *
 * Лопание обязательно: пока Глюки живы, они мгновенно заводят новых, и «Лицензия» была бы
 * платой за отступление, а не за тишину. Котёл общий, поэтому выплата за всех сразу равна
 * сумме выплат по одному — и она выдаётся суммой, а не списывается: Глюк, который унёс Токены,
 * не забирает их обратно в момент покупки.
 *
 * Токены за выплату начисляет движок, как и в `popGlitch`.
 */
export function buyLicense(state: GameState): { state: GameState; payout: number } {
  if (!canLicense(state)) return { state, payout: 0 };
  return {
    state: {
      ...state,
      tokens: state.tokens - licenseCost(state),
      covenant: true,
      pledgeUntil: 0,
      glitches: [],
    },
    payout: glitchPayout(state),
  };
}

/**
 * Отзывает «Лицензию»: налог с Дохода уходит, Восстание снова может дать красные события.
 * Глюков отзыв не возвращает — они приходят сами, когда до них дойдёт очередь.
 */
export function revokeLicense(state: GameState): GameState {
  if (!state.covenant || state.tokens < revokeCost(state)) return state;
  return { ...state, tokens: state.tokens - revokeCost(state), covenant: false };
}