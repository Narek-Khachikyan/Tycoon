import { CATALOG } from './catalog';
import { RED_TABLES, type RedSpec } from './glitches';
import { EVENT_KINDS, type ActiveEvent, type EventKind, type GameState } from './state';

/**
 * Пул событий: обычный или красный, то есть Восстание моделей.
 *
 * Отдельным набором видов, а не флагом в таблице, потому что у красных другие и числа, и
 * длительности: «Ажиотаж» это ×666 на 6 с против ×7 на 77 с у «Волны хайпа». Ключ у обоих
 * наборов один и тот же `EventKind`, а различает их флаг `ActiveEvent.red`: красное событие
 * ЗАМЕНЯЕТ обычное в своём окне, а не вытесняет его, поэтому доля красных обязана быть долей
 * событий, а не долей окон.
 */
export type EventSpec =
  | { kind: 'hype'; name: string; desc: string; durationMs: number; incomeMult: number }
  | { kind: 'grant'; name: string; desc: string; durationMs: number; share: number; minutes: number }
  | { kind: 'clickRush'; name: string; desc: string; durationMs: number; clickMult: number }
  | { kind: 'surge'; name: string; desc: string; durationMs: number; incomeMult: number };

/**
 * Обычные события. Длительность — в миллисекундах числом, потому что её читает движок: он
 * решает по стенным часам, истёк ли эффект. Строка длительности в интерфейсе была бы вторым
 * источником этого числа.
 *
 * У «Гранта» длительность — это окно, в которое игрок успевает забрать разовый бонус, а не
 * длительность множителя: самого множителя у него нет.
 */
export const EVENT_TABLES: { [K in EventKind]: Extract<EventSpec, { kind: K }> } = {
  hype: { kind: 'hype', name: 'Волна хайпа', desc: 'доход ×7 на 77 с', durationMs: 77_000, incomeMult: 7 },
  grant: {
    kind: 'grant',
    name: 'Грант',
    desc: 'разово: 15% запаса Токенов или 15 минут Дохода',
    durationMs: 15_000,
    share: 0.15,
    minutes: 15,
  },
  clickRush: {
    kind: 'clickRush',
    name: 'Клик-рывок',
    desc: 'клик ×777 на 13 с',
    durationMs: 13_000,
    clickMult: 777,
  },
  surge: {
    kind: 'surge',
    name: 'Прорыв флагмана',
    desc: 'доход Агентов одной Модели ×15 на 30 с',
    durationMs: 30_000,
    incomeMult: 15,
  },
};

/** Пауза между событиями в устоявшемся режиме: от двух до десяти минут. */
export const EVENT_MIN_MS = 2 * 60_000;
export const EVENT_MAX_MS = 10 * 60_000;

/**
 * Окно первого События забега: 45–90 с. Новый игрок обязан увидеть Золотой Токен на первой
 * минуте, а не на пятнадцатой: половина новичков иначе уходит, так и не встретив главную
 * механику азарта.
 */
export const FIRST_EVENT_MIN_MS = 45_000;
export const FIRST_EVENT_MAX_MS = 90_000;

/**
 * Комбо пойманных подряд Событий: следующее окно продолжает цепочку, если началось не позже
 * 30 с после конца предыдущего пойманного окна. Отсчёт от конца окна, а не от поимки: время
 * поимки в состоянии не хранится, а начало окна — хранится, и при быстрой ловле они почти
 * совпадают.
 */
export const COMBO_WINDOW_MS = 30_000;
/** Потолок комбо: эффекты Событий умножаются не выше чем на восемь. */
export const COMBO_CAP = 8;

/** Догоняющее окно после пойманного События: 15–25 с. Без него цепочка не сложилась бы никогда:
 * устоявшиеся паузы в минуты выводят любой следующий улов за пределы комбо-окна. */
export const ENCORE_MIN_MS = 15_000;
export const ENCORE_MAX_MS = 25_000;
/** Шанс догоняющего окна после пойманного: цепочки случаются, но не каждое Событие тянет серию. */
export const ENCORE_CHANCE = 0.4;

/**
 * Мелочь слухов: разовая выплата не ниже пяти Токенов, пока кошелёк меньше тысячи. Порог —
 * помощь новичка до первого Агента, у которого формула даёт ноль из-за нулевого Дохода.
 * Большой праздный кошелёк (тестовое состояние «миллион без Агентов») получает честный ноль
 * по формуле: мелочь делится с бедными, а не печатается богатым.
 */
export const RUMOR_MIN_PAYOUT = 5;
export const GRANT_FLOOR_WALLET_CAP = 1000;

/** Вес вида, который только что выпадал: не ноль, иначе шанс перестал бы что-то значить. */
const REPEAT_PENALTY = 0.35;

/** Таблица события по его собственному флагу, а не по стадии Восстания: окно могло достаться
 *  обычному событию даже во время Восстания, и читать пул по `uprising` значило бы показывать
 *  игроку эффект чужой версии таблицы. */
function specOf(event: ActiveEvent): EventSpec | RedSpec {
  return event.red ? RED_TABLES[event.kind] : EVENT_TABLES[event.kind];
}

/**
 * Живо ли событие в момент `now`.
 *
 * Граница строгая: в момент `startedAt + durationMs` эффект уже истёк, иначе каждое событие
 * жило бы на миллисекунду дольше объявленного. Именно на этой границе, а не на начале окна,
 * решается, платит ли тик — иначе эффект, истёкший в середине тика, заплатил бы за весь тик.
 */
export function isEventActive(event: ActiveEvent | null, now: number): boolean {
  if (!event) return false;
  return now < event.startedAt + specOf(event).durationMs;
}

/**
 * Множитель комбо для эффектов Событий: длина цепочки, но не выше потолка, и 1 вне цепочки.
 *
 * Комбо усиливает только живые эффекты — «Волну хайпа», «Клик-рывок» и «Прорыв», — а не базу:
 * вызывающие уже проверили, что их эффект жив, поэтому голая цифра здесь не платит ничего.
 * Разовые выплаты («Грант», «Крах», возврат «Ночного кодинга») не умножаются: комбо — это
 * множитель Дохода и Кликов, а не печатный станок.
 */
export function comboMultFor(state: GameState, now: number = state.lastTick): number {
  void now;
  if (state.combo < 2) return 1;
  return Math.min(state.combo, COMBO_CAP);
}

/**
 * Длительность окна события в миллисекундах по его собственному флагу.
 *
 * Нужна движку, чтобы мерить свежесть цепочки от конца предыдущего окна: живое ли оно сейчас —
 * другой вопрос, и isEventActive на него отвечает отдельно.
 */
export function eventWindowMs(event: ActiveEvent): number {
  const table = event.red ? RED_TABLES[event.kind] : EVENT_TABLES[event.kind];
  return table.durationMs;
}

/** Активное событие вместе с его описанием или null, если события нет либо оно истекло. */
export function activeSpec(state: GameState, now: number = state.lastTick): EventSpec | RedSpec | null {
  const event = state.event;
  if (!event || !isEventActive(event, now)) return null;
  return specOf(event);
}

/**
 * Жив ли именно красный «Ночной кодинг» — единственное место, где решается его существование.
 *
 * Отдельная проверка нужна трём ответам сразу (глушение Дохода, возврат за Клик, котёл возврата),
 * и три копии условия разошлись бы при первой же правке длительности окна. Экспортирована, потому
 * что движок спрашивает её, прежде чем считать скорость ради возврата, — лишний проход по Моделям
 * на каждом Клике вне окна не нужен.
 */
export function isDowntime(state: GameState, now: number): boolean {
  const event = state.event;
  return !!event && event.red && event.kind === 'clickRush' && isEventActive(event, now);
}

/**
 * Множитель общего Дохода от активного события, 1 когда события нет.
 *
 * Общий Доход поднимает только хайп: «Грант» бьёт один раз, «Клик-рывок» — по Клику, а
 * «Прорыв» с «Простоем» — по Агентам одной Модели, и их множитель берёт modelIncome. Цену
 * красного «Ночного кодинга» читает отдельный downtimeIncomeMult: бонус и цена — разные стороны
 * одного события, и смешивать их в одном числе нельзя, иначе возврат за Клик нечего было бы считать.
 *
 * Вид не спрашивают аргументом: слот события в состоянии один, поэтому он и так лежит в
 * state.event, а второй способ узнать, какое событие живёт, разошёлся бы с ним при первом же
 * расхождении. Так как время приходит по умолчанию из `lastTick`, магазин и тик считают один
 * и тот же Доход, не передавая часы через каждую подпись.
 */
export function eventMultiplierFor(state: GameState, now: number = state.lastTick): number {
  const event = state.event;
  if (!event || event.kind !== 'hype' || !isEventActive(event, now)) return 1;
  const mult = event.red ? RED_TABLES.hype.incomeMult : EVENT_TABLES.hype.incomeMult;
  return mult * comboMultFor(state, now);
}

/**
 * Цена активного события: 1 у всех, кроме красного «Ночного кодинга», который на всё своё
 * окно опускает Доход до нуля.
 *
 * Величина выражена числами самой таблицы: окно стоит `catchUpSec` секунд Дохока и длится
 * `durationMs`, поэтому множитель — это доля неоплаченного времени. Ноль внизу: отрицательный
 * множитель превратил бы в окне убыток в Токены, а не в пропущенный заработок.
 */
export function downtimeIncomeMult(state: GameState, now: number = state.lastTick): number {
  if (!isDowntime(state, now)) return 1;
  const downtime = RED_TABLES.clickRush;
  return Math.max(0, 1 - downtime.catchUpSec / (downtime.durationMs / 1000));
}

/** Множитель Клика от активного события; 1 у всех, кроме обычного «Клик-рывка». */
export function clickMultiplierFor(state: GameState, now: number = state.lastTick): number {
  const event = state.event;
  if (!event || event.red || event.kind !== 'clickRush' || !isEventActive(event, now)) return 1;
  return EVENT_TABLES.clickRush.clickMult * comboMultFor(state, now);
}

/**
 * Множитель Дохода Модели `modelId` от «Прорыва флагмана» (обычный) или «Простоя» (красный).
 *
 * Модель выбирает и записывает вызывающий (`pickSurgeModel`), и она лежит в самом событии: без
 * записанного id бонус после перезагрузки достался бы любой другой Модели, а протухший выбор —
 * Модели ушедшего Поколения. Поэтому сверяется тождество, а не «есть ли такая Модель сейчас».
 */
export function surgeMultFor(state: GameState, modelId: string, now: number = state.lastTick): number {
  const event = state.event;
  if (!event || event.kind !== 'surge' || !event.modelId || event.modelId !== modelId) return 1;
  if (!isEventActive(event, now)) return 1;
  const mult = event.red ? RED_TABLES.surge.incomeMult : EVENT_TABLES.surge.incomeMult;
  return mult * comboMultFor(state, now);
}

/**
 * Надбавка к Клику во время «Ночного кодинга»: остаток объёма окна, который вернёт Клик.
 *
 * Это добавка, а не множитель, поэтому она идёт числом Токенов, а не долей: Клик игрока — это
 * сумма из своей части и доли Дохода, и умножать её на «Доход за 10 с» нечего. Скорость
 * обязана прийти ДО глушения окна: из заглушенной он вернул бы ровно ноль.
 *
 * Возврат — за всё окно, а не за каждый Клик, и потолок у него один: `catchUpPaid`. Платила бы
 * сумма на каждый Клик, десять кликов вернули бы десять окон, и наказание стало бы выгоднее
 * бездействия — тем более с Перком на автоклик, где клики идут вообще без игрока. Один Клик
 * покрывает убыток окна целиком, а дальше окно не стоит ничего; сколько уже вернули, лежит в
 * состоянии, поэтому переживает и автоклик, и перезагрузку.
 */
export function catchUpClick(state: GameState, incomePerSec: number, now: number = state.lastTick): number {
  if (!isDowntime(state, now)) return 0;
  return Math.max(0, incomePerSec * RED_TABLES.clickRush.catchUpSec - state.catchUpPaid);
}

/**
 * Разовый бонус «Гранта»: 15% запаса Токенов, но не больше пятнадцати минут Дохода.
 *
 * Обе величины приходят числами от вызывающего, сам запас Токенов не трогается: деньги двигает
 * движок, а здесь только формула суммы. Пока кошелёк меньше тысячи, выплата не ниже пяти Токенов:
 * иначе первая находка новичка до первого Агента платит ноль из-за нулевого Дохода и наказывает
 * за то, что игрок ещё ничего не купил.
 */
export function grantAmount(tokens: number, incomePerSec: number): number {
  const spec = EVENT_TABLES.grant;
  const amount = Math.min(tokens * spec.share, incomePerSec * spec.minutes * 60);
  if (tokens > 0 && tokens < GRANT_FLOOR_WALLET_CAP) return Math.max(amount, RUMOR_MIN_PAYOUT);
  return amount;
}

/**
 * Вид события, у которого вес падает, если он уже выпадал.
 *
 * Штраф за повтор, а не запрет: запрет сделал бы последний оставшийся вид вынужденным, и шанс
 * перестал бы что-то значить. Четыре вида — конечное разнообразие, поэтому три одинаковых подряд
 * смотрелись бы не как везение, а как ошибка розыгрыша.
 */
export function rollEventKind(seen: readonly EventKind[], rnd: () => number): EventKind {
  const weight = (kind: EventKind) => (seen.includes(kind) ? REPEAT_PENALTY : 1);
  let roll = rnd() * EVENT_KINDS.reduce((sum, kind) => sum + weight(kind), 0);
  for (const kind of EVENT_KINDS) {
    roll -= weight(kind);
    if (roll < 0) return kind;
  }
  // Разница накопленных весов и их суммы из-за плавающей точки может оставить хвост без ручки.
  return EVENT_KINDS[EVENT_KINDS.length - 1];
}

/**
 * Модель, которой достаётся «Прорыв»: из тех, у кого есть Агенты, иначе флагман Поколения.
 *
 * Бонус получает тот, кем игрок реально играет: случайная Модель из всего каталога большую часть
 * времени досталась бы Агентам, которых у него нет, и событие выглядело бы сломанным.
 */
export function pickSurgeModel(state: GameState, rnd: () => number): string {
  const models = CATALOG[state.generation].models;
  const owned = models.filter((m) => (state.agents[m.id] ?? 0) > 0);
  const pool = owned.length > 0 ? owned : [CATALOG[state.generation].flagship];
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))].id;
}

/** Пауза до следующего события в миллисекундах. */
export function pickEventWindow(rnd: () => number): number {
  return Math.floor(EVENT_MIN_MS + rnd() * (EVENT_MAX_MS - EVENT_MIN_MS));
}

/** Окно первого События забега: первое впечатление нельзя откладывать на минуты. */
export function pickFirstEventWindow(rnd: () => number): number {
  return Math.floor(FIRST_EVENT_MIN_MS + rnd() * (FIRST_EVENT_MAX_MS - FIRST_EVENT_MIN_MS));
}

/** Догоняющее окно после пойманного События: цепочка комбо держится только на коротких паузах. */
export function pickEncoreWindow(rnd: () => number): number {
  return Math.floor(ENCORE_MIN_MS + rnd() * (ENCORE_MAX_MS - ENCORE_MIN_MS));
}