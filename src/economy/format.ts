import type { Notation } from './state';

const SUFFIXES = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
  'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg',
];

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

function present(abs: number, notation: Notation): Presented {
  const exp = Math.floor(Math.log10(abs));
  if (notation === 'sci') {
    return { mantissa: abs / Math.pow(10, exp), decimals: 2, exp, suffix: '', overflow: false };
  }
  let tier = Math.floor(exp / 3);
  let mantissa = abs / Math.pow(1000, tier);
  if (mantissa >= 999.95 && tier + 1 < SUFFIXES.length) {
    tier += 1;
    mantissa /= 1000;
  }
  if (tier >= SUFFIXES.length) {
    return { mantissa: abs / Math.pow(10, exp), decimals: 2, exp, suffix: '', overflow: true };
  }
  // Не больше двух знаков после запятой: третий в этой игре — шум, а не точность.
  return { mantissa, decimals: mantissa >= 100 ? 1 : 2, exp, suffix: SUFFIXES[tier], overflow: false };
}

export function formatNumber(n: number, notation: Notation = 'short'): string {
  if (!Number.isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 1000) {
    // Значение, отличающееся от целого меньше, чем на эпсилон double, — это целое,
    // просто записанное неточно. Так приходит результат вычитания: 1.9999999999999998
    // печатать как «2,0» нельзя, потому что это 2. Порог — половина шага double на
    // этом масштабе, а не «почти целое» на глаз.
    const nearest = Math.round(a);
    const isInt = a === nearest || Math.abs(a - nearest) <= Number.EPSILON * Math.max(nearest, 1) * 4;
    const body = isInt ? String(nearest) : a < 10 ? a.toFixed(1) : Math.floor(a).toString();
    // Разделитель выбирает запись, а не функция: короткая печатает по-русски, научная — с
    // точкой. Раньше этот выход стоял до ветвления по нотации, и запятая просачилась в sci.
    return notation === 'sci' ? sign + body : sign + body.replace('.', ',');
  }
  const p = present(a, notation);
  if (p.overflow || notation === 'sci') return `${sign}${p.mantissa.toFixed(p.decimals)}e${p.exp}`;
  return `${sign}${p.mantissa.toFixed(p.decimals).replace('.', ',')} ${p.suffix}`;
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
 */
export function formatCount(
  n: number,
  one: string,
  few: string,
  many: string,
  notation: Notation = 'short',
): string {
  const { unit, tens } = declensionOf(Math.abs(n), notation);
  if (unit === 1 && tens !== 11) return one;
  if (unit >= 2 && unit <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

interface Declension {
  unit: number;
  tens: number;
}

/**
 * Единицы и десятки, по которым выбирается форма.
 *
 * До точных целых это просто остаток от деления. За ними остаток бессмыслен, и берутся
 * последние цифры напечатанной записи: `present` уже знает мантиссу и число знаков
 * после запятой для этой нотации, то есть ровно то, что увидит игрок.
 */
function declensionOf(abs: number, notation: Notation): Declension {
  if (abs <= Number.MAX_SAFE_INTEGER) return { unit: abs % 10, tens: abs % 100 };
  if (abs < 1000) return { unit: Math.floor(abs) % 10, tens: Math.floor(abs) % 100 };
  const p = present(abs, notation);
  const printed = p.mantissa.toFixed(p.decimals).replace('.', '').replace(/^0+(?=\d)/, '');
  return {
    unit: Number(printed.slice(-1)),
    tens: Number(printed.slice(-2).padStart(2, '0')),
  };
}

export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s % 60} с`;
  return `${s} с`;
}
