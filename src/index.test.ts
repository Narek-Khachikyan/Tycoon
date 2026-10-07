import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Именно node:fs, а не `?raw`: vitest отдаёт по `?raw` уже сжатый css, а баланс скобок
// нужен в исходнике — его и ест минификатор.
const css = readFileSync(new URL('./index.css', import.meta.url).pathname, 'utf8');
const lines = css.split('\n');
const braces = (line: string) => (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;

/**
 * index.css не проверяет ни TypeScript, ни dev-сервер: лишняя скобка ломает только
 * production-сборку, где всё после неё выпадает из-под гейта `prefers-reduced-motion`.
 */
describe('index.css', () => {
  it('has balanced braces', () => {
    let depth = 0;
    for (const [i, line] of lines.entries()) {
      depth += braces(line);
      expect(depth, `лишняя закрывающая скобка на строке ${i + 1}: ${line}`).toBeGreaterThanOrEqual(0);
    }
    expect(depth, 'файл закрыт не на нулевой глубине').toBe(0);
  });

  it('declares no keyframes inside a media block', () => {
    let depth = 0;
    let mediaDepth: number | null = null;
    for (const [i, line] of lines.entries()) {
      if (mediaDepth === null && line.trim().startsWith('@media')) mediaDepth = depth;
      expect(
        mediaDepth !== null && line.trim().startsWith('@keyframes'),
        `@keyframes внутри @media на строке ${i + 1}`,
      ).toBe(false);
      depth += braces(line);
      if (mediaDepth !== null && depth <= mediaDepth) mediaDepth = null;
    }
  });
});
