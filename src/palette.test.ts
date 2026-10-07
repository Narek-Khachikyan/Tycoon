import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GENERATIONS } from './data/generations';

/**
 * Контраст палитры (ADR-0007). Значения читаются из `index.css` и `generations.ts`, а не
 * переписываются сюда: копия расходилась бы с таблицей стилей ровно тогда, когда нужна — при
 * правке цвета. Проценты акцентной заливки (`color-mix`) тоже берутся из стилей.
 */

type Rgb = [number, number, number];

const MIN_CONTRAST = 4.5;
const HEX = /^#[0-9a-f]{6}$/i;

const stylesheet = readFileSync(new URL('./index.css', import.meta.url).pathname, 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const ruleBodies = (selector: string): string[] => {
  const escaped = selector.replace(/[.:]/g, '\\$&');
  const rule = new RegExp(`(?<=^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`, 'g');
  return [...stylesheet.matchAll(rule)].map((m) => m[1]);
};

const declarations = (body: string): Array<[name: string, value: string]> =>
  [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);

const rootBodies = ruleBodies(':root');
const palette = new Map(rootBodies.flatMap(declarations));

// Производные от акцента живут в `.app-root`: сначала запасное значение, затем `color-mix` в
// `@supports`. Браузер с `color-mix` берёт последнее, без него — первое, поэтому проверяется каждое.
const derived = new Map<string, string[]>();
for (const [name, value] of ruleBodies('.app-root').flatMap(declarations)) {
  derived.set(name, [...(derived.get(name) ?? []), value]);
}

const declared = (name: string): string[] => {
  const values = derived.get(name) ?? (palette.has(name) ? [palette.get(name) ?? ''] : []);
  if (values.length === 0) throw new Error(`--${name} не объявлена ни в :root, ни в .app-root`);
  return values;
};

const splitTopLevel = (list: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (const [i, ch] of [...list].entries()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((p) => p.trim());
};

/** Читает ровно то, чем пользуется палитра: `#rrggbb`, `var()` и `color-mix(in srgb, …)`. */
const resolve = (value: string, accent: string): Rgb => {
  const v = value.trim();

  if (HEX.test(v)) {
    const n = parseInt(v.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) {
    if (ref[1] === 'accent-color') return resolve(accent, accent);
    return resolve(declared(ref[1]).at(-1) ?? '', accent);
  }

  const mix = /^color-mix\(in srgb,(.+)\)$/s.exec(v);
  if (mix) {
    const [a, b] = splitTopLevel(mix[1]).map((stop) => {
      const m = /^(.+?)(?:\s+(\d+(?:\.\d+)?)%)?$/s.exec(stop);
      return { color: resolve(m?.[1] ?? stop, accent), percent: m?.[2] === undefined ? undefined : Number(m[2]) };
    });
    const pa = a.percent ?? (b.percent === undefined ? 50 : 100 - b.percent);
    const pb = b.percent ?? 100 - pa;
    if (pa + pb !== 100) throw new Error(`доли color-mix не сходятся к 100%: ${v}`);
    // Браузер округляет каналы до 8 бит; без этого замер расходится с экраном во втором знаке.
    const mixed = (i: number) => Math.round((a.color[i] * pa + b.color[i] * pb) / 100);
    return [mixed(0), mixed(1), mixed(2)];
  }

  throw new Error(`не умею читать цвет: ${v}`);
};

const channel = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (fg: Rgb, bg: Rgb): number => {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const ratio = (fg: string, bg: string, accent = ''): number => contrast(resolve(fg, accent), resolve(bg, accent));

const accents = GENERATIONS.map((g) => g.theme.accent);

// Ступени базы находятся по имени, а не списком: новая ступень `--bg-*` сразу обязана
// держать подписи, и забыть её добавить сюда нельзя.
const surfaces = [...palette].filter(([name, value]) => name.startsWith('bg-') && HEX.test(value)).map(([name]) => name);

describe('contrast calculator', () => {
  it('matches the WCAG reference ratios', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    // Пара, на которой ломается каждый чужой калькулятор: #767676 на белом проходит, #777777 — нет.
    expect(ratio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(ratio('#777777', '#ffffff')).toBeLessThan(MIN_CONTRAST);
  });

  it('mixes like the browser does', () => {
    // 255 × 0.48 = 122.4, 122 × 0.48 = 58.56, 47 × 0.48 = 22.56 — округлено до 8 бит.
    expect(resolve('color-mix(in srgb, #ff7a2f 48%, #000000)', '')).toEqual([122, 59, 23]);
    expect(resolve('color-mix(in srgb, var(--accent-color) 48%, #000000)', '#ff7a2f')).toEqual([122, 59, 23]);
    expect(resolve('color-mix(in srgb, #ffffff, #000000)', '')).toEqual([128, 128, 128]);
  });

  it('refuses a value it cannot read instead of passing silently', () => {
    expect(() => resolve('hsl(20 100% 59%)', '')).toThrow();
    expect(() => resolve('var(--no-such-color)', '')).toThrow();
  });
});

describe('palette contrast (ADR-0007)', () => {
  it('reads the stylesheet and the generation data it checks', () => {
    expect(rootBodies).toHaveLength(1);
    expect(surfaces).toEqual(expect.arrayContaining(['bg-void', 'bg-primary', 'bg-panel', 'bg-card', 'bg-raised']));
    // Не меньше восьми: тест, у которого сжали цикл, — это удалённый инвариант.
    expect(accents.length).toBeGreaterThanOrEqual(8);
  });

  it.each(surfaces)('--text-main and --text-muted hold on --%s', (surface) => {
    for (const text of ['text-main', 'text-muted']) {
      const r = ratio(`var(--${text})`, `var(--${surface})`);
      expect(r, `--${text} на --${surface}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it.each(['bg-void', 'bg-primary', 'bg-panel', 'bg-card'])('--red holds on --%s', (surface) => {
    const r = ratio('var(--red)', `var(--${surface})`);
    expect(r, `--red на --${surface}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it.each(['gold-solid', 'gold-solid-hover', 'red-solid'])('--text-main holds on the --%s fill', (fill) => {
    const r = ratio('var(--text-main)', `var(--${fill})`);
    expect(r, `--text-main на --${fill}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  describe.each(accents)('accent %s', (accent) => {
    it.each(['accent-solid', 'accent-solid-hover'])('--text-main holds on --%s', (fill) => {
      const values = declared(fill);
      for (const value of values) {
        const r = ratio('var(--text-main)', value, accent);
        expect(r, `--text-main на --${fill} (${value}): ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    });
  });
});
