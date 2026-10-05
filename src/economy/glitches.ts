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
 * Выплата за всех живых Глюков разом: 1,1 × всё, что они успели унести.
 *
 * Считается по всему списку, а не по одному Глюку, потому что зовёт ровно одно место — покупка
 * «Лицензии», которая глушит всех сразу. Лопнувший Глюк платит за себя (`popGlitch`), и сумма
 * выплат по одному равна этому котлу: сдача сдаётся покомпонентно, а не общая сумма, поэтому
 * лопнуть всех по очереди нельзя выгоднее, чем не лопнуть вовсе.
 *
 * Общий котёл и даёт сверхлинейность: десять Глюков, пережившие три дня активной игры, уносят
 * 0,5 × Доход × время, и выплата с надбавкой даёт 0,55 × Доход × время — а оффлайн-доход за те же
 * три дня остаётся кэпом в 8 часов. Итог около шести офлайн-доходов там, где без Глюков был один,
 * потому что лимит оффлайна на выплату не распространяется. Это и делает «Лицензию» откупом,
 * который стоит своих денег, а не мелким утешительным призом.
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
 */
export function spawnGlitch(state: GameState): GameState {
  if (state.covenant || state.glitches.length >= GLITCH_SLOTS) return state;
  const id = state.glitchSeq + 1;
  return { ...state, glitchSeq: id, glitches: [...state.glitches, { id, stolen: 0, clicks: 0 }] };
}

/** Первый Глюк не раньше третьего экрана: на двух первых игрок знакомится с откупом. */
export const GLITCH_FIRST_GENERATION = 2;

/** Пауза между Глюками: от минуты до трёх минут. */
export const GLITCH_MIN_MS = 60_000;
export const GLITCH_MAX_MS = 180_000;

/**
 * Окно между Глюками. Разброс обязателен: постоянная пауза читалась бы как счётчик, а не как
 * случайность, и толпа паразитов выходила бы предсказуемой.
 */
const glitchWindow = (rnd: () => number): number =>
  GLITCH_MIN_MS + rnd() * (GLITCH_MAX_MS - GLITCH_MIN_MS);

/**
 * Заводит Глюка, если подошло окно, и переносит окно дальше в любом случае.
 *
 * Расписание лежит здесь, а не в UI-слое стора: окно Глюка переживает перезагрузку так же, как
 * окно события, а паузы между спавнами — те же константы того же правила, что лежат рядом.
 *
 * Просроченное окно — это простой, а не подвисание кадра: Глюк не заводится, окно переносится,
 * иначе игрок возвращался бы из оффлайна к паразиту, которого никто не звал. Догонять упущенное
 * окно не нужно: за следующие три минуты придёт следующее.
 *
 * Вызывается после начисления дохода и по часам конца тика: только что появившийся вор ещё ничего
 * не успел украсть. Ничего не изменившееся окно возвращает тот же объект.
 */
export function advanceGlitches(state: GameState, now: number, rnd: () => number): GameState {
  // До третьего экрана расписания нет вовсе.
  if (state.generation < GLITCH_FIRST_GENERATION) {
    return state.nextGlitchAt === 0 ? state : { ...state, nextGlitchAt: 0 };
  }
  if (state.nextGlitchAt > now) return state;
  const next = now + glitchWindow(rnd);
  if (state.nextGlitchAt === 0 || now - state.nextGlitchAt > GLITCH_MIN_MS) return { ...state, nextGlitchAt: next };
  return { ...spawnGlitch(state), nextGlitchAt: next };
}

/**
 * Лопает Глюка, не считая удары, и отдаёт выплату за одного — этого.
 *
 * Платёж за одного, а не за весь список: у каждого Глюка своё `stolen`, и общий котёл при лопании
 * платил бы каждому за всех. На десяти Глюках один лопнувший забирал котёл целиком, а их было десять
 * — выплата выходила в 5,5 заявленной, и покупка «Лицензии», которая платит тот же котёл разом,
 * становилась бессмысленной: лопнуть всех по одному было и быстрее, и выгоднее.
 */
export function popGlitch(state: GameState, id: number): { state: GameState; popped: boolean; payout: number } {
  const glitch = state.glitches.find((g) => g.id === id);
  if (!glitch) return { state, popped: false, payout: 0 };
  const payout = GLITCH_PAYOUT * glitch.stolen;
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

/**
 * Стадия Восстания, которую даёт Поколение: столько, сколько игрок дошёл, но не больше потолка.
 *
 * Стадия равна Поколению, поэтому третий экран (Поколение 2) даёт стадию 2, а последняя даёт
 * сплошь красные события — только с четвёртого. От времени стадия не зависит: игрок, просидевший
 * вкладку сутки, не должен получить то, до чего не дошёл играя.
 *
 * Инвариант стадии, а не её прибавка: `uprising` в состоянии не ниже этого числа, поэтому и
 * миграция, и разбор сохранения берут его отсюда, а не ставят ноль.
 */
export function uprisingStage(generation: number): GameState['uprising'] {
  return Math.min(Math.max(0, Math.floor(generation)), 3) as GameState['uprising'];
}

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

/**
 * Цена «Лобби» — лесенка в Флагманах текущего Поколения, а не геометрическая прогрессия в единицах
 * масштаба: внутри Поколения Флагман дорожает вместе с Моделями (×11,5 за Ранг), поэтому цена в
 * единицах масштаба стоила от долей процента Флагмана в средних Поколениях до 3,66 Флагмана в
 * последнем. Временный откуп при этом всегда дешевле бессрочной «Лицензии» (3 Флагмана): лесенка
 * упирается в потолок раньше, чем догоняет её.
 */
export const PLEDGE_FLAGSHIP_MULT = [0.5, 1, 2, 4, 8] as const;

/** Столько «Лобби» можно купить за один забег: дальше цена отпугивает раньше потолка. */
export const PLEDGE_MAX = 5;

/**
 * «Лицензия» стоит столько Флагманов текущего Поколения и действует всегда.
 *
 * Кратно цене Флагмана, а не круглому числу в единицах масштаба: внутри Поколения Флагман дорожает
 * вместе с Моделями (×11,5 за Ранг), поэтому цена, растущая только ×1000 за Поколение, съезжала по
 * Поколениям с 2,4 Флагмана в первом до 3659 в последнем, где она уже ничего не стоит. Три
 * Флагмана — доля забега, которая от Поколения к Поколению не плывёт.
 */
export const LICENSE_FLAGSHIP_MULT = 3;

/** Постоянный налог на Доход за «Лицензию», пока она не отозвана. */
export const LICENSE_INCOME_TAX = 0.05;

/**
 * Отзыв «Лицензии» — цена в Флагманах, и она выше самой покупки: купить и сразу отозвать невыгодно,
 * иначе отзыв стал бы способом забрать выплату за Глюков и вернуть все деньги на место.
 */
export const REVOKE_FLAGSHIP_MULT = 2 * LICENSE_FLAGSHIP_MULT;

/**
 * Гасятся ли красные события прямо сейчас.
 *
 * «Лицензия» — вечное «Лобби», поэтому она тоже подходит; иначе вызывающему пришлось бы держать
 * вторую копию этого правила рядом с проверкой `pledgeUntil`.
 */
export function isPledgeActive(state: GameState, now: number): boolean {
  return state.covenant || now < state.pledgeUntil;
}

/** Цена «Лобби» после всех купленных в этом забеге: ступень лесенки × цена Флагмана. */
export function pledgeCost(state: GameState): number {
  const bought = Math.min(Math.max(0, Math.floor(state.pledgeBought)), PLEDGE_FLAGSHIP_MULT.length - 1);
  return PLEDGE_FLAGSHIP_MULT[bought] * CATALOG[state.generation].flagship.baseCost;
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

/** Цена «Лицензии» в Токенах текущего Поколения: столько Флагманов, сколько задано константой. */
export function licenseCost(state: GameState): number {
  return LICENSE_FLAGSHIP_MULT * CATALOG[state.generation].flagship.baseCost;
}

/** Цена отзыва «Лицензии»: вернуть отупение можно, но не дёшево. */
export function revokeCost(state: GameState): number {
  return REVOKE_FLAGSHIP_MULT * CATALOG[state.generation].flagship.baseCost;
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
 * платой за отступление, а не за тишину. Здесь единственное место, где платится общий котёл
 * (`glitchPayout`): глушат всех разом, и выплата равна сумме выплат по одному — она выдаётся
 * суммой, а не списывается: Глюк, который унёс Токены, не забирает их обратно в момент покупки.
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