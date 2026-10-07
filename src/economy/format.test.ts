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

  it('печатает цену 10,5 как 11, а не как 10', () => {
    const cheapest = CATALOG[0].models[0];
    const cost = bulkCost(cheapest, 0, 1, discountMult(newGame(0)));
    expect(cost).toBe(10.5);
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

  it('слово следует за напечатанным в обеих нотациях и обоих режимах', () => {
    // Сайты без notation читали слово по short-записи при числе в sci: «2.71e19 Токенов»
    // вместо «Токена». Цена Клика и остаток до Compute при этом считаются как цены —
    // слово обязано следовать за округлённой вверх печатью, а не за сырым числом.
    const nums = [2.71e19, 4.71e25, 3.008e47, 2.1999e19, 1e21, 1.5, 10.5, 1.9999999999999998];
    let diverged = 0;
    for (const mode of ['number', 'price'] as const) {
      for (const notation of ['short', 'sci'] as const) {
        for (const n of nums) {
          // Целая часть головы печати, без экспоненты и суффикса: форма смотрит на неё.
          const head = formatNumber(n, notation, mode).split(/[e ]/)[0].replace(',', '.');
          const whole = Math.floor(Number(head));
          const last = whole % 10;
          const tens = whole % 100;
          const expected =
            last === 1 && tens !== 11
              ? 'Токен'
              : last >= 2 && last <= 4 && (tens < 12 || tens > 14)
                ? 'Токена'
                : 'Токенов';
          expect(formatCount(n, 'Токен', 'Токена', 'Токенов', notation, mode)).toBe(expected);
        }
      }
      // Набор обязан содержать числа, где окончание различается между нотациями, —
      // иначе проверка прошла бы и без прогона второй нотации.
      for (const n of nums) {
        if (
          formatCount(n, 'Токен', 'Токена', 'Токенов', 'short', mode) !==
          formatCount(n, 'Токен', 'Токена', 'Токенов', 'sci', mode)
        ) {
          diverged += 1;
        }
      }
    }
    expect(diverged).toBeGreaterThan(0);
    // Якоря: одно и то же число читается по-разному, но правильно в каждой нотации.
    expect(formatCount(2.71e19, 'Токен', 'Токена', 'Токенов', 'short', 'price')).toBe('Токенов');
    expect(formatCount(2.71e19, 'Токен', 'Токена', 'Токенов', 'sci', 'price')).toBe('Токена');
  });
});

describe('format', () => {
  it('uses short scale suffixes with a Russian decimal comma', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(0.5)).toBe('0,5');
    expect(formatNumber(1500)).toBe('1,50 K');
    expect(formatNumber(1729)).toBe('1,73 K');
    expect(formatNumber(999999)).toBe('1,00 M');
    expect(formatNumber(2.5e9)).toBe('2,50 B');
    expect(formatNumber(1.23e15, 'sci')).toBe('1.23e15');
  });

  it('keeps sci notation with a dot while short uses a comma', () => {
    expect(formatNumber(1729, 'sci')).toBe('1.73e3');
    expect(formatNumber(1500, 'sci')).toContain('.');
    expect(formatNumber(1500)).not.toContain('.');
    // Выход «меньше тысячи» стоит до ветвления по нотации, поэтому запятая не должна
    // просачиваться в научную запись и на нём.
    expect(formatNumber(0.5, 'sci')).toBe('0.5');
    expect(formatNumber(0.5)).toBe('0,5');
  });

  it('never uses a dot as a decimal separator and keeps at most two decimals', () => {
    // Значения внутри лестницы суффиксов: за её пределом формат возвращается к sci,
    // где точка обязательна.
    const values = [0.5, 9.9, 999, 1000, 1500, 1729, 12345, 999999, 2.5e9, 1.23e15, 1e27, 4.567e60];
    for (const v of values) {
      const out = formatNumber(v);
      expect(out).not.toContain('.');
      const frac = out.split(',')[1];
      if (frac !== undefined) expect(frac.split(' ')[0].length).toBeLessThanOrEqual(2);
    }
  });

  it('declines agent counts in Russian', () => {
    const agent = (n: number) => formatCount(n, 'Агент', 'Агента', 'Агентов');
    expect(agent(0)).toBe('Агентов');
    expect(agent(1)).toBe('Агент');
    expect(agent(2)).toBe('Агента');
    expect(agent(4)).toBe('Агента');
    expect(agent(5)).toBe('Агентов');
    // 11–14 живут по правилу десятков, а не хвоста: «11 Агентов», но «21 Агент».
    expect(agent(11)).toBe('Агентов');
    expect(agent(12)).toBe('Агентов');
    expect(agent(14)).toBe('Агентов');
    expect(agent(21)).toBe('Агент');
    expect(agent(22)).toBe('Агента');
    expect(agent(25)).toBe('Агентов');
    expect(agent(101)).toBe('Агент');
    expect(agent(111)).toBe('Агентов');
    expect(agent(-1)).toBe('Агент');
  });

  it('declines by the digits the player sees once the number outgrows exact integers', () => {
    const token = (n: number) => formatCount(n, 'Токен', 'Токена', 'Токенов');
    // Граница точных целых: выше неё единицы float — шум округления, и форма по ним
    // выбиралась случайно. Раньше 4.67e73 читалось как «Токена», а 9.08e75 как «Токена»
    // же, при одинаковом виде на экране — теперь обе по значащим цифрам.
    // Ниже границы поведение прежнее и точное.
    expect(token(9007199254740991)).toBe('Токен');
    expect(token(9007199254740990)).toBe('Токенов');

    // Форма следует за ЦЕЛОЙ ЧАСТЬЮ напечатанной мантиссы, вместе с отменой на 11–14.
    // Раньше брались последние две цифры записи без точки, то есть форма соответствовала
    // числу, которого на экране нет: «1.11e70» читалось как 111, то есть «Токенов», хотя
    // игрок видит единицу с хвостом. Теперь 4.67e73 → «4,67» → 4 → «Токена», 1.23e70 →
    // «1,23» → 1 → «Токен», 9.08e75 → 9 → «Токенов».
    expect(token(4.67e73)).toBe('Токена');
    expect(token(9.08e75)).toBe('Токенов');
    expect(token(1.23e70)).toBe('Токен');
    expect(token(1.11e70)).toBe('Токен');
    expect(token(1.21e70)).toBe('Токен');
    // Смена нотации обязана менять форму только вместе с тем, что напечатано: «27,10 Qi» —
    // двадцать семь, «2.71e19» — две. Прежнее правило давало здесь «Токенов» в обоих
    // случаях, то есть одно и то же количество называлось двумя словами.
    expect(formatCount(2.71e19, 'Токен', 'Токена', 'Токенов', 'short')).toBe('Токенов');
    expect(formatCount(2.71e19, 'Токен', 'Токена', 'Токенов', 'sci')).toBe('Токена');

    // Настоящий инвариант: форма не должна зависеть от шума младших разрядов. Два числа,
    // печатающиеся одинаково, обязаны давать одинаковую форму — до правки именно здесь
    // и ломалось, поэтому проверка на сам формат без сравнения ничего бы не поймала.
    for (const n of [1e70, 4.67e73, 9.08e75, 7.77e250]) {
      const twin = n * (1 + 1e-15);
      expect(formatNumber(twin, 'sci')).toBe(formatNumber(n, 'sci'));
      expect(token(twin)).toBe(token(n));
    }
  });

  it('prints a float one step off an integer as that integer', () => {
    // Результат вычитания почти никогда не попадает ровно в целое: дефицит 2 при цене
    // 1010 и кошельке 1008 приходит как 1.9999999999999998. Печатать его как «2,0» нельзя —
    // это 2, и так его видит игрок.
    expect(formatNumber(1.9999999999999998)).toBe('2');
    expect(formatNumber(5.000000000000001)).toBe('5');
    expect(formatNumber(7.999999999999999)).toBe('8');
    expect(formatNumber(-1.9999999999999998)).toBe('-2');
    // Настоящие дробные и целые значения не изменились.
    expect(formatNumber(0.1)).toBe('0,1');
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(999)).toBe('999');
  });

  it('declines below a thousand by the integer it prints', () => {
    // Строка ShopColumn и ClickColumn печатают число и форму рядом, поэтому форма обязана
    // следовать за напечатанным целым, а не за младшими разрядами float.
    const tokens = (n: number) => formatCount(n, 'Токен', 'Токена', 'Токенов');
    // Тот самый дефицит: на экране «2», значит и «2 Токена», а не «2 Токенов».
    expect(tokens(1.9999999999999998)).toBe('Токена');
    // Настоящая дробь под десятью печатается с одним знаком и склоняется по нему же.
    expect(formatNumber(2.5)).toBe('2,5');
    expect(tokens(2.5)).toBe('Токена');
    // Дробь от десяти и выше печатается целой частью — форма считается по ней.
    expect(formatNumber(12.5)).toBe('12');
    expect(tokens(12.5)).toBe('Токенов');
    expect(formatNumber(21.5)).toBe('21');
    expect(tokens(21.5)).toBe('Токен');
    // Целые значения не изменились ни в чём.
    expect(tokens(1010)).toBe('Токенов');
    expect(tokens(1021)).toBe('Токен');
    expect(tokens(111)).toBe('Токенов');
  });
});
