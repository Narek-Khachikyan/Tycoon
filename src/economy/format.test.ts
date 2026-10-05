import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { bulkCost, discountMult } from './engine';
import { formatCount, formatNumber } from './format';
import { newGame } from './state';

/**
 * Напечатанная цена обратно в число: сколько Токенов обещает подпись на самом деле.
 *
 * Шаг — величина последней напечатанной единицы, то есть ровно та погрешность, которую запись
 * обязана иметь. Утверждения выше сравнивают не со строкой, а с этим числом: иначе тест
 * закреплял бы текущий текст вместо обещания, и следующая правка формата прошла бы молча.
 */
function parsePrice(text: string): { value: number; step: number } {
  const sci = /^(\d+(?:[.,]\d+)?)e(\d+)$/.exec(text);
  if (sci) {
    const mantissa = Number(sci[1].replace(',', '.'));
    return { value: mantissa * Math.pow(10, Number(sci[2])), step: Math.pow(10, Number(sci[2]) - 2) };
  }
  const short = /^(\d+(?:[.,]\d+)?)(?: ([A-Za-z]+))?$/.exec(text);
  if (!short) throw new Error(`цена напечатана не как число: «${text}»`);
  const mantissa = Number(short[1].replace(',', '.'));
  const tiers = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No',
    'Dc', 'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'];
  const tier = tiers.indexOf(short[2] ?? '');
  if (tier < 0) throw new Error(`неизвестный суффикс яруса в «${text}»`);
  const value = mantissa * Math.pow(1000, tier);
  const decimals = short[1].includes(',') || short[1].includes('.') ? short[1].split(/[.,]/)[1].length : 0;
  return { value, step: Math.pow(1000, tier) * Math.pow(10, -decimals) };
}

/** Все цены покупки, какие встречаются в игре: каждая Модель, несколько владений и объёмов. */
function catalogPrices(): number[] {
  const out: number[] = [];
  for (const gen of CATALOG) {
    for (const m of gen.models) {
      for (const owned of [0, 1, 2, 7, 33]) {
        for (const n of [1, 10, 100]) {
          out.push(bulkCost(m, owned, n, 1));
          out.push(bulkCost(m, owned, n, 0.7));
        }
      }
    }
  }
  return out;
}

const price = (n: number, notation: 'short' | 'sci' = 'short') => formatNumber(n, notation, 'price');
const tokenWord = (n: number, notation: 'short' | 'sci' = 'short') =>
  formatCount(n, 'Токен', 'Токена', 'Токенов', notation, 'price');

describe('format: цена никогда не меньше списания', () => {
  it('печатает цену не меньше настоящей в обеих нотациях', () => {
    const prices = catalogPrices();
    expect(prices.length).toBeGreaterThan(1000);
    for (const notation of ['short', 'sci'] as const) {
      for (const cost of prices) {
        const text = price(cost, notation);
        const { value, step } = parsePrice(text);
        // Главное обещание: цифра на кнопке не может быть дешевле покупки. Допуск — только шум
        // double (цена в 16,5 миллиона приходит как 16500000,000000002, и печатать её дороже
        // означало бы завысить счёт на 10 000 Токенов из-за последнего бита).
        const noise = Number.EPSILON * Math.max(cost, 1) * 8;
        expect(value).toBeGreaterThanOrEqual(cost - noise);
        // И не должна врать в другую сторону больше, чем на одну печатную единицу:
        // цена, завышенная на порядок, была бы своим враньём.
        expect(value - cost).toBeLessThan(step);
      }
    }
  });

  it('тот случай из плей-аудита: 10,5 на кнопке читалось как 10', () => {
    const cheapest = CATALOG[0].models[0];
    const cost = bulkCost(cheapest, 0, 1, discountMult(newGame(0)));
    expect(cost).toBe(10.5);
    // Ровно та строка, на которой чисел было 2 в 10.
    expect(formatNumber(cost)).toBe('10');
    expect(price(cost)).toBe('11');
    // Кошелёк ровно в показанную цену теперь всегда хватает: покупка не может отказать
    // при сумме, которую подпись назвала.
    expect(cost).toBeLessThanOrEqual(Number(price(cost)));
  });

  it('целые цены печатаются точно, а обычный режим не тронут', () => {
    // Целое, попадающее в сетку обеих нотаций, печатается одинаково в обоих режимах.
    for (const n of [0, 1, 15, 999, 1000]) {
      expect(price(n)).toBe(formatNumber(n));
      expect(price(n, 'sci')).toBe(formatNumber(n, 'sci'));
    }
    // Режим по умолчанию остался прежним, включая свои (осознанные) срезы.
    expect(formatNumber(10.5)).toBe('10');
    expect(formatNumber(12.5)).toBe('12');
    expect(formatNumber(2.5)).toBe('2,5');
    expect(formatNumber(1.9999999999999998)).toBe('2');
    expect(formatNumber(1500)).toBe('1,50 K');
    // А под десятью цена округляется вверх, а не вниз до «0» и не в пол-Токена точностью.
    expect(price(7.5)).toBe('8');
    expect(price(0.4)).toBe('1');
    // Научная запись сжимает всегда: там 12345 → 1.23e4 в обоих режимах, и разница — только
    // сторона округления, а не сама точность записи.
    expect(price(12345, 'sci')).toBe('1.24e4');
    expect(formatNumber(12345, 'sci')).toBe('1.23e4');
    // Шум младших разрядов double не должен поднимать цену на целый ярус: ровные 16,5 миллиона
    // приходят из движка как 16500000,000000002.
    expect(price(16500000.000000002)).toBe('16,50 M');
  });

  it('округление вверх переносит ярус, а не печатает «1000»', () => {
    // Мантисса 999,94 при одном знаке после запятой округляется вверх ровно до 1000: ярус
    // обязан подняться, иначе подпись стала бы «1000,0 Sx».
    expect(price(999.94e21)).toBe('1,00 Sp');
    expect(formatNumber(999.94e21)).toBe('999,9 Sx');
    // Последний ярус лестницы: переноса выше уже нет, и запись уходит в научную — с тем же
    // переносом мантиссы, потому что «10,00e65» означало бы уже 1e66.
    expect(price(9.9994e65)).toBe('1.00e66');
    expect(price(9.9994e65, 'sci')).toBe('1.00e66');
    expect(formatNumber(9.9994e65)).toBe('999,9 Vg');
    // Перенос в научной нотации: 9,999 вверх не может стать «10,00e300».
    expect(price(9.999e300, 'sci')).toBe('1.00e301');
    // Ровная мантисса не меняется: правило трогает только дробь.
    expect(price(1e300)).toBe('1.00e300');
    expect(price(1e300)).toBe(formatNumber(1e300));
  });

  it('форма числительного следует за напечатанной ценой', () => {
    // На экране «11» — значит «11 Токенов»: правило десятков отменяет хвост, как и у любого числа.
    expect(price(10.5)).toBe('11');
    expect(tokenWord(10.5)).toBe('Токенов');
    // Настоящая разница режимов видна там, где печать меняет форму: 1,5 → «2» и «2 Токена»,
    // а не «1,5 Токен».
    expect(price(1.5)).toBe('2');
    expect(tokenWord(1.5)).toBe('Токена');
    expect(formatCount(1.5, 'Токен', 'Токена', 'Токенов')).toBe('Токен');
    expect(tokenWord(21.5)).toBe('Токена');
    expect(tokenWord(12.5)).toBe('Токенов');
    expect(tokenWord(22.5)).toBe('Токена');
    expect(tokenWord(0)).toBe('Токенов');
    // За пределами точных целых форма по-прежнему по цифрам печати, и цена не меняет знак.
    expect(tokenWord(1.21e70)).toBe('Токен');
    expect(tokenWord(1.21e70)).toBe(formatCount(1.21e70, 'Токен', 'Токена', 'Токенов', 'short'));
    expect(price(-10.5)).toBe('-11');
    expect(tokenWord(-10.5)).toBe('Токенов');
  });
});
