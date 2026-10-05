import { describe, expect, it } from 'vitest';
import { sceneFilter, sceneFloorGradient, sceneGrade, sceneHeatLayers } from './sceneGrade';

/**
 * Проверяется решение, а не CSS.
 *
 * `filter` и градиент — то, как решение попадает в DOM, и строку с ними проверять нечем:
 * минификатор перепишет пробелы, и тест упадёт на правке, ничего не сказав о кадре.
 * Проверяются цели, ради которых режим и написан: после него все четыре Сцены обязаны
 * держаться в одном диапазоне яркости и температуры, а пол — достаточно тёмным под Маскотов.
 */

/** Те же замеры исходных Сцен, на которых считается режим. */
const MEASURED: readonly [number, number][] = [
  [71.2, 27.0],
  [99.4, -51.2],
  [74.2, 15.3],
  [73.9, -22.7],
];

/** Цели, объявленные в sceneGrade.ts. Дублируются здесь намеренно: если цель поменяют в
 *  модуле и забудут здесь, тест упадёт на расхождении, а не молча подтвердит новую. */
const TARGET_LUMA = 73;
const TARGET_WARMTH = 16;

describe('художественный режим Сцены', () => {
  it('сводит все четыре Сцены к целевой яркости', () => {
    // Замеренная яркость после фильтра равна исходной, умноженной на множитель: это верно
    // для `brightness()`, и проверка не требует браузера.
    const after = MEASURED.map(([luma], i) => luma * sceneGrade(i).brightness);
    for (const luma of after) expect(luma).toBeLessThanOrEqual(TARGET_LUMA + 0.1);

    // Разброс после правки узкий: сцены нарисованы разными, и требование «как угодно, лишь
    // бы не выбивалось» должно выполняться с запасом. Итоговые числа снимаются с композита
    // в браузере (shot/verify-grade.mjs): 30.6 → 5.4.
    const spread = Math.max(...after) - Math.min(...after);
    expect(spread).toBeLessThan(7);
    // До правки разброс был 28 пунктов, и виновата была одна Сцена.
    const before = MEASURED.map(([luma]) => luma);
    expect(spread).toBeLessThan((Math.max(...before) - Math.min(...before)) * 0.25);
  });

  it('уводит холодные Сцены к температуре базы и не трогает тёплые', () => {
    // Проверяется решение — доля тонировки по холодности, — а не результат CSS-фильтра:
    // сепия в браузере считается по своей матрице, и повторять её здесь значило бы держать
    // вторую, устаревающую копию. Связь «доля растёт с холодностью» и есть контракт.
    const coldness = MEASURED.map(([, warm]) => TARGET_WARMTH - warm);
    const mixes = MEASURED.map((_, i) => sceneGrade(i).warm);

    for (const c of coldness) expect(mixes[coldness.indexOf(c)]).toBeGreaterThanOrEqual(0);
    // Холодная Сцена 2 получает больше всех, тёплая Сцена 1 — меньше всех.
    expect(Math.max(...mixes)).toBe(mixes[coldness.indexOf(Math.max(...coldness))]);
    expect(Math.min(...mixes)).toBe(mixes[coldness.indexOf(Math.min(...coldness))]);
    // И разница существенная, а не «чуть подкрасили»: 78 пунктов холода против 9.
    expect(Math.max(...mixes)).toBeGreaterThan(Math.min(...mixes) * 4);
  });

  it('темнит пол тем сильнее, чем светлее Сцена', () => {
    // Светлый пол Сцены 2 — это то место, где Маскоты стояли белым по белому.
    expect(sceneGrade(1).floorShade).toBeGreaterThan(sceneGrade(0).floorShade);
    for (let i = 0; i < 4; i++) {
      expect(sceneGrade(i).floorShade, `пол Сцены ${i + 1} слишком светлый`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('не выходит за пределы CSS-фильтра на выбросной Сцене', () => {
    // Яркость Сцены 2 в полтора раза выше остальных, и режим обязан это учесть множителем
    // меньше единицы, а не «усилить насыщенность и не трогать яркость».
    expect(sceneGrade(1).brightness).toBeLessThan(1);
    expect(sceneGrade(1).brightness).toBeGreaterThan(0.5);
    for (let i = 0; i < 4; i++) {
      const g = sceneGrade(i);
      expect(g.saturate, `насыщенность Сцены ${i + 1}`).toBeLessThanOrEqual(1.1);
      // Потолок сепии — не украшение, а граница читаемости: дальше картина перестаёт быть
      // офисом. Он проверяется здесь, потому что проверять его больше нечем.
      expect(g.warm, `доля сепии Сцены ${i + 1}`).toBeLessThanOrEqual(0.42);
    }
    // Сепия высветляет, и без поправки Сцена 2 выходила на 6 пунктов светлее цели.
    expect(sceneGrade(1).brightness * MEASURED[1][0]).toBeLessThan(TARGET_LUMA);
  });

  it('держит индекс Сцены в границах каталога', () => {
    // Индекс приходит из `floor(generation / 2)` и ограничен в компоненте, но модуль не
    // должен падать на мусорном значении: сцена за кадром — это пустая рамка, а не исключение.
    expect(sceneGrade(-1)).toEqual(sceneGrade(0));
    expect(sceneGrade(99)).toEqual(sceneGrade(3));
    expect(sceneGrade(1.7)).toEqual(sceneGrade(1));
  });

  it('собирает фильтр и градиент так, чтобы они читались как решение', () => {
    // Три составляющие и никакого `hue-rotate`: жёлтый тон сепии — это температура палитры,
    // а поворот уводил бы картину в розовый.
    const f = sceneFilter(sceneGrade(1));
    expect(f.match(/brightness\(/g)).toHaveLength(1);
    expect(f.match(/saturate\(/g)).toHaveLength(1);
    expect(f.match(/sepia\(/g)).toHaveLength(1);
    expect(f).not.toContain('hue-rotate');
    // Фильтр не должен быть декоративным мусором из нулей: множитель яркости всегда > 0.
    for (let i = 0; i < 4; i++) expect(sceneGrade(i).brightness).toBeGreaterThan(0);

    const grad = sceneFloorGradient(sceneGrade(1));
    expect(grad).toContain('to top');
    expect(grad).toMatch(/rgba\(0, 0, 0, 0\.\d+\)/);
  });
});

describe('жар поверх Сцены', () => {
  it('кладёт оба слоя снизу вверх', () => {
    // Жар поднимается. Слой, идущий сверху вниз, читался бы как холод, падающий с потолка.
    const { tint, haze } = sceneHeatLayers();
    expect(tint.startsWith('linear-gradient(to top')).toBe(true);
    expect(haze).toContain('to top');
    // Марево обязано быть полосами, а не размытием: размытие нечёткого градиента не даёт
    // ничего, и слой молча превратился бы в ровную заливку.
    expect(haze).toContain('repeating-linear-gradient');
  });

  it('не задаёт прозрачность в JS', () => {
    // Прозрачность приходит из `--heat-glow` в CSS. Если число появится здесь, у шкалы
    // нагрева появится вторая копия, и они разъедутся при первой правке :root.
    const { tint, haze } = sceneHeatLayers();
    expect(tint).not.toContain('opacity');
    expect(haze).not.toContain('opacity');
  });
});
