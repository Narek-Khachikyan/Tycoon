import { formatCount, formatNumber } from '../economy/format';
import {
  HALLUC_HEAT,
  HALLUC_LOSS,
  HEAT_COOL_RATE,
  HEAT_COOL_SEC,
  HEAT_PENALTY,
  HEAT_RATE,
  OVERHEAT_STUN_SEC,
  OVERLOAD_FROM,
  TEMP_MAX,
  TEMP_MIN,
  halluRate,
  heatRate,
  tempYieldMult,
} from '../economy/thermal';

/**
 * Тексты секции «Температура» для окна «Инфо».
 *
 * Числа здесь не написаны руками: они читаются из `thermal.ts` теми же функциями, что считают
 * Доход, и печатаются `formatNumber`/`formatCount`. Причина не в красоте — в правде: 55% среза,
 * 3,5 секунды оглушения и доля кошелька у Галлюцинации настраиваются вместе с балансом, и
 * захардкоженная строка разошлась бы с механикой молча, а игрок поверил бы ей, потому что это
 * справка. Правка константы обязана менять и текст, а для этого текст обязан считать её.
 *
 * Здесь нет ничего, что нужно самой механике: файл ничего не решает, а только объясняет.
 * Поэтому он и читает константы, а не пишет их.
 */

/**
 * Граница перегруза приходит из `thermal.ts`: её читают и шкала, рисуя пунктир, и эта справка,
 * и выбор зоны. Объявление здесь было бы третьим местом с числом, которое тихо разъехлось бы
 * при правке шкалы.
 */
export { OVERLOAD_FROM } from '../economy/thermal';

/** Проценты из доли: `HEAT_PENALTY` → «55%». Через `formatNumber`, потому что число в справке и
 *  число на экране обязаны печататься одной функцией. */
const pct = (share: number): string => `${formatNumber(Math.round(share * 100))}%`;

/** Секунды с окончанием по числу: «3,5 секунды», «26 секунд». `formatCount` даёт только
 *  окончание, поэтому число печатается отдельно и той же функцией, что на экране. */
const sec = (n: number): string => `${formatNumber(n)} ${formatCount(n, 'секунда', 'секунды', 'секунд')}`;

/** То же в винительном — для «раз в 12 секунд». */
const secIn = (n: number): string =>
  `${formatNumber(n)} ${formatCount(n, 'секунду', 'секунды', 'секунд')}`;

/** Во сколько раз перегрев копится быстрее в перегрузе, чем на единице: `heatRate` линейна. */
const HEAT_SPEEDUP = heatRate(TEMP_MAX) / HEAT_RATE;

/** Секунд от нулевой полосы до сброса: на единице и на пределе шкалы. Округление здесь, а не в
 *  `formatNumber`: доли секунды в тексте читаются как «меньше», и «раз в 11 секунд» при реальных
 *  11,7 обещало бы события чаще, чем они приходят. */
const SECONDS_TO_RESET_AT_ONE = Math.round(1 / (HEAT_RATE - HEAT_COOL_RATE));
const SECONDS_TO_RESET_AT_MAX = Math.round(1 / (heatRate(TEMP_MAX) - HEAT_COOL_RATE));

/** Как часто приходит Галлюцинация: на единице и в перегрузе. `halluRate` квадратична. */
const HALLU_EVERY_AT_ONE = Math.round(1 / halluRate(OVERLOAD_FROM));
const HALLU_EVERY_AT_MAX = Math.round(1 / halluRate(TEMP_MAX));

/** Зона шкалы. Холод — это ноль, а не диапазон: ниже нуля шкала не идёт. */
export type ThermalZoneId = 'cold' | 'working' | 'overload';

export interface ThermalZone {
  id: ThermalZoneId;
  /** Подпись на шкале: одно слово, как сама шкала. */
  label: string;
  /** Границы зоны по шкале включительно, от `TEMP_MIN` до `TEMP_MAX`. */
  range: readonly [number, number];
  /** Что игрок видит в этой зоне. Одно предложение. */
  text: string;
}

/**
 * Чем игрок платит за жар. Порядок — по тому, о чём узнаёшь раньше: перегруз виден на шкале
 * сразу, Галлюцинация приходит через минуту, а про оффлайн вспоминают обычно последним.
 */
export type ThermalRisk =
  | { kind: 'overload'; title: string; text: string }
  | { kind: 'heat'; title: string; text: string }
  | { kind: 'overheat'; title: string; text: string }
  | { kind: 'hallucination'; title: string; text: string }
  | { kind: 'offline'; title: string; text: string };

export interface ThermalCopy {
  /** Заголовок секции. */
  title: string;
  /** Что это и зачем игроку, в одном предложении. */
  summary: string;
  /** Зоны шкалы слева направо: от холода к перегрузу. */
  zones: readonly ThermalZone[];
  /** Чем платит жар, по порядку важности. */
  risks: readonly ThermalRisk[];
  /** Холод: базовый Доход остаётся, но и не растёт ничего. */
  cold: string;
  /** Одна строка тактики — ритм, а не арифметика. */
  tip: string;
}

const ZONES: Record<ThermalZoneId, ThermalZone> = {
  cold: {
    id: 'cold',
    label: 'холод',
    range: [TEMP_MIN, TEMP_MIN],
    text: 'Шкала в нуле. Доход ровно базовый, перегрев не растёт, галлюцинаций не бывает.',
  },
  working: {
    id: 'working',
    label: 'рабочий жар',
    range: [TEMP_MIN, OVERLOAD_FROM],
    text: 'Жар и перегрев растут пропорционально, поэтому здесь решается, догревать или сбрасывать.',
  },
  overload: {
    id: 'overload',
    label: 'перегруз',
    range: [OVERLOAD_FROM, TEMP_MAX],
    text: `Доход продолжает расти: на пределе шкалы это ×${formatNumber(tempYieldMult(TEMP_MAX))}, а перегрев копится в ${formatNumber(HEAT_SPEEDUP)} раза быстрее.`,
  },
};

/** Зоны в порядке шкалы. Массив, а не объект: интерфейсу нужен ряд для легенды. */
export const THERMAL_ZONES: ThermalZone[] = [ZONES.cold, ZONES.working, ZONES.overload];

/** Чем платит жар, по порядку важности. */
export const THERMAL_RISKS: readonly ThermalRisk[] = [
  {
    kind: 'overload',
    title: 'Перегруз',
    text: `Дальше единицы Доход продолжает расти, но платит за это скоростью: от нуля до сброса тут ${sec(SECONDS_TO_RESET_AT_MAX)} против ${sec(SECONDS_TO_RESET_AT_ONE)} на единице. Галлюцинации идут тут же чаще — их шанс растёт по квадрату жара.`,
  },
  {
    kind: 'heat',
    title: 'Перегрев',
    text: `Полоса под шкалой — обратный счётчик. Каждая единица жара добавляет к ней своё, и чем длиннее полоса, тем меньше Доход: срез линейный и на полной шкале съедает ${pct(HEAT_PENALTY)}. В холоде полоса не растёт, но и не стоит: за ${sec(HEAT_COOL_SEC)} она уходит сама, и опустить шкалу вниз — значит остудить офис.`,
  },
  {
    kind: 'overheat',
    title: 'Сброс по перегреву',
    text: `Полоса дошла до конца: жар падает в ноль, полоса очищается, а Доход душит ещё ${sec(OVERHEAT_STUN_SEC)} — срез стартует с тех же ${pct(HEAT_PENALTY)} и линейно сходит на нет. Это не поломка, а цена жара.`,
  },
  {
    kind: 'hallucination',
    title: 'Галлюцинация',
    text: `Модель уверенно выдала то, чего нет. Забирает около ${pct(HALLUC_LOSS)} от кошелька: доля, а не сумма, поэтому одинаково ощутима и на двадцати Токенах, и на очень многих. Заодно добавляет к перегреву ${pct(HALLUC_HEAT)} шкалы. Шанс в секунду квадратичен по жару: на единице это раз в ${secIn(HALLU_EVERY_AT_ONE)}, в перегрузе — раз в ${secIn(HALLU_EVERY_AT_MAX)}.`,
  },
  {
    kind: 'offline',
    title: 'Оффлайн-доход',
    text: 'Простой считается по базовой скорости, без Температуры: это минутный рычаг, а игра закрыта часами. Разогревать офис перед уходом бессмысленно.',
  },
];

export const THERMAL_COPY: ThermalCopy = {
  title: 'Температура',
  summary:
    'Температура генерации: насколько смело Модель выбирает следующий токен текста и во сколько раз больше Токенов в секунду это ей даёт.',
  zones: THERMAL_ZONES,
  risks: THERMAL_RISKS,
  cold: `Холод не бесплатен: множитель там ровно ×${formatNumber(tempYieldMult(TEMP_MIN))}, и весь жар, который мог бы его поднять, просто не добавлен. Взамен не растёт перегрев и не приходят галлюцинации.`,
  tip: `Грейте рывками: разогнались, заработали на жаре, опустили шкалу и дали офису остыть за ${sec(HEAT_COOL_SEC)}. Один и тот же жар растягивается на весь Забег, если сбрасывать его вовремя, — и это единственный способ выжать из шкалы больше, чем даёт постоянный максимум.`,
};

/** Зона по значению Температуры — чтобы легенда и подсветка не держали свой список порогов. */
export const thermalZoneId = (temp: number): ThermalZoneId =>
  temp > OVERLOAD_FROM ? 'overload' : temp <= TEMP_MIN ? 'cold' : 'working';

/** Зона как объект, готовый к отрисовке. */
export const thermalZone = (temp: number): ThermalZone => ZONES[thermalZoneId(temp)];