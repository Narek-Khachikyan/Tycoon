import { EN_FORMS, TIME_UNITS } from '../i18n/plurals';
import type { Lang } from '../i18n/types';
import type { Notation } from './state';

const SUFFIXES = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg',
];

/**
 * Как печатается число.
 *
 * `'number'` — обычное число на экране: ближайшее целое под тысячей и четыре значащие цифры
 * в ярусах. `'price'` — цена, то есть число, за которым стоит обещание: из кошелька вычтут
 * ровно столько, сколько показано, или больше.
 *
 * Режим один на оба вызова (`formatNumber` и `formatCount`), потому что склонение обязано
 * считаться по той же записи, которую игрок видит: цена «2» читается как «2 Токена», и «1 Токен»
 * рядом с ней было бы второй неправдой на той же строке.
 */
export type PrintMode = 'number' | 'price';

/**
 * Разбор числа ровно так, как его напечатает `formatNumber`: мантисса, число знаков после
 * запятой и суффикс яруса.
 *
 * Живёт отдельно, потому что от раскладки зависят две вещи: сама строка и русская форма
 * числительного. Форма обязана считаться по тем же цифрам, что игрок видит на экране,
 * поэтому обе берут разбор отсюда, а не повторяют правило «две цифры, если мантисса
 * меньше сотни» в двух местах — иначе они разъедутся при первой же правке формата.
 */
interface Presented {
  /** Мантисса в том виде, в каком она печатается. */
  mantissa: number;
  /** Знаков после запятой в печати мантиссы. */
  decimals: number;
  /** Порядок величины для научной записи. */
  exp: number;
  /** Суффикс яруса; при переполнении лестницы суффиксов запись уходит в научную. */
  suffix: string;
  /** Ярус не помещается в лестницу суффиксов, печатать надо scientific. */
  overflow: boolean;
}

/** Порядок величины, отдельно от `present`: перенос яруса и научная запись берут его отсюда. */
const order = (abs: number) => Math.floor(Math.log10(abs));

/** Знаков после запятой в научной записи: столько же, сколько у переполненной мантиссы. */
const SCI_DECIMALS = 2;

/**
 * Округление вверх до печатаемой точности — единственное отличие режима `'price'`.
 *
 * Именно вверх, а не к ближайшему: цена, срезанная вниз, обещает дешёвую покупку, которой не
 * будет. Кнопка «Купить ×1 (10)» при цене 10,5 отнимала 10,5, и игрок с десятью Токенами в
 * кошельке нажимал на неё и ничего не получал. Ошибка в другую сторону (показано 11, списано
 * 10,5) стоит одного Токена и не ломает покупку.
 */
const ceilTo = (mantissa: number, decimals: number): number =>
  Math.ceil(mantissa * Math.pow(10, decimals)) / Math.pow(10, decimals);

/**
 * Стоит ли мантисса ровно на печатаемой сетке — та же осторожность, что и под тысячей, только
 * для яруса. Цена в 16,5 миллиона приходит из движка как 16500000,000000002, и округление вверх
 * напечатало бы «16,51 M» — на десять тысяч Токенов дороже настоящего. Порог — половина шага
 * double на этом масштабе, как и в разборе под тысячей.
 */
const exactAt = (value: number, decimals: number): boolean =>
  Math.abs(value - Number(value.toFixed(decimals))) <=
  Number.EPSILON * Math.max(Math.abs(value), 1) * 4;

/**
 * Научная запись: мантисса 1..10 и её порядок.
 *
 * Отдельной функцией потому, что в ней сходятся оба выхода из `present` — нотация `sci` и
 * выход за лестницу суффиксов, — и правило округления вверх у них одно и то же: переноса
 * мантиссы через 10 не бывает, иначе «10,00e300» означало бы уже 1e301.
 */
function presentSci(abs: number, mode: PrintMode): { mantissa: number; exp: number } {
  const exp = order(abs);
  const mantissa = abs / Math.pow(10, exp);
  if (mode !== 'price') return { mantissa, exp };
  const raised = exactAt(mantissa, SCI_DECIMALS) ? mantissa : ceilTo(mantissa, SCI_DECIMALS);
  return raised >= 10 ? { mantissa: raised / 10, exp: exp + 1 } : { mantissa: raised, exp };
}

function present(abs: number, notation: Notation, mode: PrintMode = 'number'): Presented {
  if (notation === 'sci') {
    const { mantissa, exp } = presentSci(abs, mode);
    return { mantissa, decimals: SCI_DECIMALS, exp, suffix: '', overflow: false };
  }
  const exp = order(abs);
  let tier = Math.floor(exp / 3);
  let mantissa = abs / Math.pow(1000, tier);
  if (mantissa >= 999.95 && tier + 1 < SUFFIXES.length) {
    tier += 1;
    mantissa /= 1000;
  }
  if (tier >= SUFFIXES.length) {
    const over = presentSci(abs, mode);
    return { ...over, decimals: SCI_DECIMALS, suffix: '', overflow: true };
  }
  // Не больше двух знаков после запятой: третий в этой игре — шум, а не точность.
  const decimals = mantissa >= 100 ? 1 : 2;
  if (mode !== 'price') return { mantissa, decimals, exp, suffix: SUFFIXES[tier], overflow: false };
  const raised = exactAt(mantissa, decimals) ? mantissa : ceilTo(mantissa, decimals);
  if (raised >= 1000) {
    // Округление вверх дотолкнуло мантиссу до 1000: ярус поднимается, иначе подпись показала бы
    // «1000,0 K» вместо «1,00 M» — это и на порядок больше настоящего, и не число из лестницы.
    if (tier + 1 < SUFFIXES.length) {
      return { mantissa: raised / 1000, decimals: 2, exp: exp + 3, suffix: SUFFIXES[tier + 1], overflow: false };
    }
    const over = presentSci(abs, mode);
    return { ...over, decimals: SCI_DECIMALS, suffix: '', overflow: true };
  }
  return { mantissa: raised, decimals, exp, suffix: SUFFIXES[tier], overflow: false };
}

/**
 * Разбор числа меньше тысячи, где ярусов ещё нет. Возвращает и тело строки, и целое,
 * которому игрок верит: склонение числительного обязано считаться по нему, иначе «2»
 * на экране получало бы «Токенов».
 */
function presentBelowThousand(a: number, mode: PrintMode = 'number') {
  const nearest = Math.round(a);
  // Значение, отличающееся от целого меньше, чем на эпсилон double, — это целое, просто
  // записанное неточно. Так приходит результат вычитания: 1.9999999999999998 печатать
  // как «2,0» нельзя, потому что это 2. Порог — половина шага double на этом масштабе,
  // а не «почти целое» на глаз.
  if (a === nearest || Math.abs(a - nearest) <= Number.EPSILON * Math.max(nearest, 1) * 4) {
    return { text: String(nearest), whole: nearest };
  }
  // Цена печатается целым вверх на любой высоте: под десятью дробь была бы точна, но
  // «Купить ×1 (7,5)» — цена, обещанная с пол-Токена точностью, а правило «вверх» одно.
  if (mode === 'price') {
    const up = Math.ceil(a);
    return { text: String(up), whole: up };
  }
  const whole = Math.floor(a);
  // Не больше одного знака после запятой: под десятью дробь ещё что-то значит, дальше
  // игрок видит только целое и не должен платить за точность, которой нет.
  return { text: a < 10 ? a.toFixed(1) : String(whole), whole };
}

export function formatNumber(
  lang: Lang,
  n: number,
  notation?: Notation,
  mode?: PrintMode,
): string;
export function formatNumber(
  n: number,
  notation?: Notation,
  mode?: PrintMode,
  lang?: Lang,
): string;
export function formatNumber(
  arg1: Lang | number,
  arg2?: number | Notation,
  arg3: Notation | PrintMode = 'short',
  arg4: PrintMode | Lang = 'number',
): string {
  let lang: Lang = 'ru';
  let n: number;
  let notation: Notation = 'short';
  let mode: PrintMode = 'number';

  if (typeof arg1 === 'string' && (arg1 === 'ru' || arg1 === 'en')) {
    lang = arg1;
    n = typeof arg2 === 'number' ? arg2 : 0;
    if (typeof arg3 === 'string' && (arg3 === 'short' || arg3 === 'sci')) notation = arg3;
    if (typeof arg4 === 'string' && (arg4 === 'number' || arg4 === 'price')) mode = arg4;
  } else {
    n = typeof arg1 === 'number' ? arg1 : 0;
    if (typeof arg2 === 'string' && (arg2 === 'short' || arg2 === 'sci')) notation = arg2;
    if (typeof arg3 === 'string' && (arg3 === 'number' || arg3 === 'price')) mode = arg3;
    if (typeof arg4 === 'string' && (arg4 === 'ru' || arg4 === 'en')) lang = arg4;
  }

  if (!Number.isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const dot = lang === 'ru' && notation !== 'sci' ? ',' : '.';
  if (a < 1000) {
    const { text } = presentBelowThousand(a, mode);
    return sign + text.replace('.', dot);
  }
  const p = present(a, notation, mode);
  if (p.overflow || notation === 'sci') return `${sign}${p.mantissa.toFixed(p.decimals)}e${p.exp}`;
  return `${sign}${p.mantissa.toFixed(p.decimals).replace('.', dot)} ${p.suffix}`;
}

/**
 * Русское склонение числительного: `one` для 1 и 21, `few` для 2–4 и 22–24,
 * `many` для остальных, включая 11–14 и 0. Хвост числа (n % 10) выбирает форму,
 * а десятки и сотни её отменяют — иначе 11 читалось бы как «11 Агент».
 *
 * За пределами MAX_SAFE_INTEGER число перестаёт хранить единицы: у 4.67e73 младшие
 * разряды — шум округления float, а не цифры, и форма по ним выбиралась случайно. Два
 * одинаково напечатанных числа получали разные окончания, и игрок видел «Токенов» рядом
 * с «Токена». Там форма считается по цифрам той же записи, которую печатает
 * `formatNumber`, — иначе она противоречила бы экрану: короткая запись показывает
 * четыре значащие цифры («471,0 Sp»), научная три («4.71e26»), и третья цифра ещё и
 * округляется. Поэтому нотация здесь обязательна, а не украшение.
 *
 * Ниже порога остаток берётся как есть, и это правильно: число ещё точное, и «1 010» —
 * это 1010, а не «1,01». Мантисса тут сжимает число только для экрана, и склонять по
 * ней значило бы написать «1,01 K Токен» вместо «1 010 Токенов». Экран и число
 * расходятся, но число — то, что declension считает.
 *
 * Режим печати обязателен вместе с числом: он решает, по какому целому считается форма, и
 * без него цена «2» получила бы форму от настоящей 1,5.
 */
export function formatCount(
  lang: Lang,
  n: number,
  one: string,
  few: string,
  many: string,
  notation?: Notation,
  mode?: PrintMode,
): string;
export function formatCount(
  n: number,
  one: string,
  few: string,
  many: string,
  notation?: Notation,
  mode?: PrintMode,
  lang?: Lang,
): string;
export function formatCount(
  arg1: Lang | number,
  arg2: number | string,
  arg3: string,
  arg4: string,
  arg5: string | Notation = 'short',
  arg6: Notation | PrintMode = 'number',
  arg7: PrintMode | Lang = 'ru',
): string {
  let lang: Lang = 'ru';
  let n: number;
  let one: string;
  let few: string;
  let many: string;
  let notation: Notation = 'short';
  let mode: PrintMode = 'number';

  if (typeof arg1 === 'string' && (arg1 === 'ru' || arg1 === 'en')) {
    lang = arg1;
    n = typeof arg2 === 'number' ? arg2 : 0;
    one = arg3;
    few = arg4;
    many = typeof arg5 === 'string' ? arg5 : '';
    if (typeof arg6 === 'string' && (arg6 === 'short' || arg6 === 'sci')) notation = arg6;
    if (typeof arg7 === 'string' && (arg7 === 'number' || arg7 === 'price')) mode = arg7;
  } else {
    n = typeof arg1 === 'number' ? arg1 : 0;
    one = typeof arg2 === 'string' ? arg2 : '';
    few = arg3;
    many = arg4;
    if (typeof arg5 === 'string' && (arg5 === 'short' || arg5 === 'sci')) notation = arg5;
    if (typeof arg6 === 'string' && (arg6 === 'number' || arg6 === 'price')) mode = arg6;
    if (typeof arg7 === 'string' && (arg7 === 'ru' || arg7 === 'en')) lang = arg7;
  }

  // Английский склоняет только на «один против всего остального», и 1,5 у него честно
  // читается как «1.5 Tokens»: форма выбирается по точному числу, а не по той записи,
  // которой расплатился бы русский declensionOf.
  if (lang === 'en') {
    const forms = EN_FORMS[one] ?? [one, many];
    return Math.abs(n) === 1 ? forms[0] : forms[1];
  }
  // Math.abs: в JS остаток от отрицательного числа отрицателен, и -1 ушёл бы в `many`.
  const { unit, tens } = declensionOf(Math.abs(n), notation, mode);
  if (unit === 1 && tens !== 11) return one;
  if (unit >= 2 && unit <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

/**
 * Единицы и десятки, по которым выбирается форма.
 *
 * До точных целых это просто остаток от деления. За ними остаток бессмыслен, и берутся
 * последние цифры напечатанной записи: `present` уже знает мантиссу и число знаков
 * после запятой для этой нотации, то есть ровно то, что увидит игрок.
 */
function declensionOf(abs: number, notation: Notation, mode: PrintMode) {
  // Под тысячей берётся то же целое, что печатает `formatNumber`: у результата вычитания
  // «1.9999999999999998» на экране стоит «2», и «2 Токенов» было бы неверно.
  if (abs < 1000) {
    const { whole } = presentBelowThousand(abs, mode);
    return { unit: whole % 10, tens: whole % 100 };
  }
  if (abs <= Number.MAX_SAFE_INTEGER) return { unit: abs % 10, tens: abs % 100 };
  const p = present(abs, notation, mode);
  // Целая часть НАПЕЧАТАННОЙ мантиссы, а не цифры её записи без точки. Мантисса уже приведена
  // к той нотации, которую выбрал игрок, поэтому игрок читает именно её: «2,71e19» — это
  // две целых (Агента), а «27,10 Qi» — двадцать семь (Агентов). Склейка «271» давала третье
  // число, которого на экране нет: по прогону 96 расхождений между нотациями, например
  // «27,10 Qi»/«Агентов» против «2.71e19»/«Агент» на одном и том же числе.
  const shown = Math.floor(Number(p.mantissa.toFixed(p.decimals)));
  return { unit: shown % 10, tens: shown % 100 };
}

export function formatDuration(lang: Lang, seconds: number): string;
export function formatDuration(seconds: number, lang?: Lang): string;
export function formatDuration(arg1: Lang | number, arg2?: number | Lang): string {
  let lang: Lang = 'ru';
  let seconds: number;
  if (typeof arg1 === 'string' && (arg1 === 'ru' || arg1 === 'en')) {
    lang = arg1;
    seconds = typeof arg2 === 'number' ? arg2 : 0;
  } else {
    seconds = typeof arg1 === 'number' ? arg1 : 0;
    if (typeof arg2 === 'string' && (arg2 === 'ru' || arg2 === 'en')) lang = arg2;
  }
  const u = TIME_UNITS[lang] ?? TIME_UNITS.ru;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return [`${h}${u.h}`, `${m}${u.m}`].join(u.sep);
  if (m > 0) return [`${m}${u.m}`, `${s % 60}${u.s}`].join(u.sep);
  return `${s}${u.s}`;
}
