import { describe, expect, it } from 'vitest';
import {
  CLICK_COL_MAX,
  CLICK_COL_MIN,
  clickColWidth,
  OFFICE_COL_MIN,
  SHOP_COL_MAX,
  SHOP_COL_MIN,
  shopColWidth,
  THREE_COL_MIN,
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
});
