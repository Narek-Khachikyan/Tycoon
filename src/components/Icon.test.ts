import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon, ICON_NAMES, type IconName } from './Icon';

const GRID = 16;
const FIELD_MIN = 2;
const FIELD_MAX = 14;

/** Пиктограммы, которые окна и баннер раньше брали из эмодзи и текстовой галочки. */
const REPLACED_GLYPHS: IconName[] = ['trophy', 'lock', 'moon', 'rocket', 'check'];

const render = (name: IconName, size?: number): string =>
  renderToStaticMarkup(createElement(Icon, { name, size }));

const rects = (markup: string): number[][] =>
  [...markup.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"><\/rect>/g)].map((m) =>
    m.slice(1).map(Number),
  );

describe('Icon', () => {
  it('carries a pixel icon for every pictogram the windows and banner used to take from emoji', () => {
    for (const name of REPLACED_GLYPHS) {
      expect(ICON_NAMES, `в наборе нет иконки «${name}»`).toContain(name);
    }
  });

  it('draws every icon on the 16×16 grid in currentColor and hides it from screen readers', () => {
    for (const name of ICON_NAMES) {
      const svg = render(name);
      expect(svg, name).toContain(`viewBox="0 0 ${GRID} ${GRID}"`);
      expect(svg, name).toContain('fill="currentColor"');
      expect(svg, `${name}: цвет задаётся только currentColor`).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
      expect(svg, `${name}: подпись берётся у соседнего текста, а не у картинки`).toContain(
        'aria-hidden="true"',
      );
      const boxes = rects(svg);
      expect(boxes.length, `${name}: иконка пуста`).toBeGreaterThan(0);
      for (const [x, y, w, h] of boxes) {
        expect(w, name).toBeGreaterThan(0);
        expect(h, name).toBeGreaterThan(0);
        expect(x + w, `${name}: прямоугольник вышел за правый край сетки`).toBeLessThanOrEqual(GRID);
        expect(y + h, `${name}: прямоугольник вышел за нижний край сетки`).toBeLessThanOrEqual(GRID);
      }
    }
  });

  it('keeps the new pictograms inside the common 12×12 field with 2 px margins', () => {
    for (const name of REPLACED_GLYPHS) {
      const boxes = rects(render(name));
      expect(boxes.length, `${name}: рисунок не прочитан из разметки`).toBeGreaterThan(0);
      for (const [x, y, w, h] of boxes) {
        expect(x, name).toBeGreaterThanOrEqual(FIELD_MIN);
        expect(y, name).toBeGreaterThanOrEqual(FIELD_MIN);
        expect(x + w, name).toBeLessThanOrEqual(FIELD_MAX);
        expect(y + h, name).toBeLessThanOrEqual(FIELD_MAX);
      }
    }
  });

  it('gives every icon its own picture', () => {
    const seen = new Map<string, IconName>();
    for (const name of ICON_NAMES) {
      const picture = JSON.stringify(rects(render(name)));
      expect(seen.get(picture), `«${name}» повторяет «${seen.get(picture)}»`).toBeUndefined();
      seen.set(picture, name);
    }
  });

  it('scales with the requested size without changing the drawing', () => {
    for (const name of REPLACED_GLYPHS) {
      const small = render(name, 16);
      const big = render(name, 40);
      expect(big).toContain('width="40" height="40"');
      expect(rects(big)).toEqual(rects(small));
    }
  });
});
