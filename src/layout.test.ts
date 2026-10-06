import { describe, expect, it } from 'vitest';
import {
  CLICK_COL_MAX,
  CLICK_COL_MIN,
  clickColWidth,
  HEADER_H,
  NARROW_MAX,
  OFFICE_COL_MIN,
  SHOP_COL_MAX,
  SHOP_COL_MIN,
  shopColWidth,
  TAB_BAR_H,
  TAP_MIN,
  THREE_COL_MIN,
  TOAST_CLEARANCE,
  TOAST_MARGIN,
  toastStackWidth,
} from './layout';

// Раскладку не проверяет ничто, кроме этих чисел, поэтому тест ловит ровно тот класс дефекта,
// из-за которого задача и появилась: значения в трёх местах разъезжаются (порог, базис колонок
// и CSS). Имена окна взяты из ручного чек-листа спеки.

const WINDOWS = [999, 1000, 1001, 1024, 1100, 1280, 1440];

describe('layout', () => {
  it('derives the three-column threshold from the column minima', () => {
    expect(THREE_COL_MIN).toBe(CLICK_COL_MIN + SHOP_COL_MIN + OFFICE_COL_MIN);
  });

  it('keeps every column minimum below its maximum', () => {
    expect(CLICK_COL_MIN).toBeLessThan(CLICK_COL_MAX);
    expect(SHOP_COL_MIN).toBeLessThan(SHOP_COL_MAX);
    expect(OFFICE_COL_MIN).toBeGreaterThan(0);
  });

  it('fits three columns exactly at the threshold and above it', () => {
    for (const vw of WINDOWS) {
      const columns = clickColWidth(vw) + shopColWidth(vw) + OFFICE_COL_MIN;
      expect(columns <= vw).toBe(vw >= THREE_COL_MIN);
    }
  });

  it('never lets a column leave its own bounds', () => {
    for (let vw = 320; vw <= 2560; vw += 7) {
      expect(clickColWidth(vw)).toBeGreaterThanOrEqual(CLICK_COL_MIN);
      expect(clickColWidth(vw)).toBeLessThanOrEqual(CLICK_COL_MAX);
      expect(shopColWidth(vw)).toBeGreaterThanOrEqual(SHOP_COL_MIN);
      expect(shopColWidth(vw)).toBeLessThanOrEqual(SHOP_COL_MAX);
    }
  });

  it('never shrinks a column as the window grows', () => {
    // Базис зависит только от ширины окна, поэтому колонка может упереться в минимум и
    // простоять там, но не может скачком сузиться — это и есть «сетка не прыгает».
    for (let vw = THREE_COL_MIN; vw < 2560; vw += 7) {
      expect(clickColWidth(vw + 7)).toBeGreaterThanOrEqual(clickColWidth(vw));
      expect(shopColWidth(vw + 7)).toBeGreaterThanOrEqual(shopColWidth(vw));
    }
  });

  it('reaches the former maximums on a full window', () => {
    expect(clickColWidth(1440)).toBe(CLICK_COL_MAX);
    expect(shopColWidth(1440)).toBe(SHOP_COL_MAX);
  });

  // Вертикальный ритм слоя 7 жил только в браузерных замерах, а числа обязаны держаться
  // тестом: они стоят в трёх местах сразу (CSS-шапка, таб-бар, отступ тостов), и разъезд
  // между ними выглядел бы как «плашка налезает на кнопку» — без единой ошибки в консоли.
  it('orders the shell bars so none is shorter than a touch target', () => {
    expect(TAP_MIN).toBeGreaterThanOrEqual(44);
    expect(HEADER_H).toBeGreaterThanOrEqual(TAP_MIN);
    expect(TAB_BAR_H).toBeGreaterThanOrEqual(TAP_MIN);
  });

  it('keeps the toast clearance clear of the bars it sits above', () => {
    // Отступ — это воздух, а не полоса: он обязан быть положительным и меньше самой
    // короткой полосы, иначе стопка тостов начала бы отодвигать половину экрана.
    expect(TOAST_CLEARANCE).toBeGreaterThan(0);
    expect(TOAST_CLEARANCE).toBeLessThan(TAP_MIN);
  });

  it('keeps the narrow breakpoint strictly inside the one-column range', () => {
    // NARROW_MAX — порог сжатия шапки, а не порог раскладки: на 600..999 px раскладка уже
    // одноколоночная, но шапка ещё может быть широкой. Равенство означало бы, что два разных
    // вопроса получили один ответ.
    expect(NARROW_MAX).toBeLessThan(THREE_COL_MIN);
  });

  // Стек тостов уже лечился от замороженного числа в нижнем отступе — ширина болела тем же:
  // число, посчитанное для одного конкретного окна, на 320 px уводило правый край карточки
  // за экран на 46 px. Ширина обязана приезжать из расчёта колонок и влезать в окно везде.
  it('fits the toast stack inside the window at 320, 360 and 390', () => {
    for (const vw of [320, 360, 390]) {
      const w = toastStackWidth(vw);
      expect(w).toBeGreaterThan(0);
      // Левое поле плюс стек плюс правое поле — внутри окна: горизонтальной прокрутки нет.
      expect(TOAST_MARGIN * 2 + w).toBeLessThanOrEqual(vw);
    }
    // Замер из задачи: на 320 px стек занимает окно за вычетом полей.
    expect(toastStackWidth(320)).toBe(320 - TOAST_MARGIN * 2);
  });

  it('derives the toast stack width from the column math on every window', () => {
    for (let vw = 320; vw <= 2560; vw += 7) {
      const w = toastStackWidth(vw);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(TOAST_MARGIN * 2 + w).toBeLessThanOrEqual(vw);
      // В трёхколоночном режиме стек живёт над колонкой Клика и не шире неё.
      if (vw >= THREE_COL_MIN) expect(w).toBeLessThanOrEqual(clickColWidth(vw));
    }
  });

  it('never shrinks the toast stack as the window of the same layout grows', () => {
    // Разрыв на самом пороге законен: ниже него колонка Клика — всё окно, выше —
    // треть, — поэтому монотонность проверяется внутри каждого режима, а не через порог.
    for (let vw = 320; vw < THREE_COL_MIN - 7; vw += 7) {
      expect(toastStackWidth(vw + 7)).toBeGreaterThanOrEqual(toastStackWidth(vw));
    }
    for (let vw = THREE_COL_MIN; vw < 2560; vw += 7) {
      expect(toastStackWidth(vw + 7)).toBeGreaterThanOrEqual(toastStackWidth(vw));
    }
  });
});
