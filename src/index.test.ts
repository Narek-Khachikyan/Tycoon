import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Именно node:fs, а не `import css from './index.css?raw'`: vitest отдаёт по `?raw`
// УЖЕ СЖАТЫЙ css (50 КБ против 70 КБ на диске, весь файл в одну строку), и проверять в нём
// баланс скобок бессмысленно — минификатор именно его и ест. Источник нужен как есть.
const css = readFileSync(new URL('./index.css', import.meta.url).pathname, 'utf8');

/**
 * Проверки целостности index.css.
 *
 * Файл не компилируется TypeScript, и всё, что в нём написано, проверяется браузером уже
 * ПОСЛЕ того, как страница собралась. Ошибка `@keyframes` внутри `@media` стоила целой
 * сборки: блок закрывался объявлением ключевых кадров, всё после него — тосты, кнопки,
 * Сцена, Глюки — выпадало из-под гейта `prefers-reduced-motion`, и баланс скобок уезжал на
 * минус. При этом `tsc` был зелёным, `npm test` — зелёным, а dev-сервер показывал всё
 * правильно: сломан был только production-путь.
 *
 * Четыре проверки ниже ловят именно класс поломок, а не конкретное число.
 */
const lines = css.split('\n');

/** Глубина вложенности фигурных скобок после каждой строки. */
const depths: number[] = [];
{
  let depth = 0;
  for (const line of lines) {
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    depths.push(depth);
  }
}

describe('index.css', () => {
  it('has balanced braces', () => {
    // Первая строка, где глубина ушла в минус, — это место, где закрылась лишняя скобка.
    // Искать её здесь дешевле, чем читать ошибку минификатора, которая указывает только
    // на конец файла.
    const broke = depths.findIndex((d) => d < 0);
    expect(broke, `глубина ушла в минус на строке ${broke + 1}: ${lines[broke]}`).toBe(-1);
    expect(depths[depths.length - 1], 'файл закрыт не на нулевой глубине').toBe(0);
  });

  it('declares no keyframes inside a motion gate', () => {
    // `@keyframes` — объявление, а не условие: под `prefers-reduced-motion` ему не место.
    // Именно такая вложенность закрывала media-блок и выбрасывала из гейта всё, что ниже.
    let depth = 0
    let mediaDepth: number | null = null;
    for (const [i, line] of lines.entries()) {
      if (mediaDepth === null && line.trim().startsWith('@media')) mediaDepth = depth;
      if (line.trim().startsWith('@keyframes') && mediaDepth !== null) {
        expect.fail(`@keyframes внутри @media на строке ${i + 1}: ${line.trim()}`);
      }
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (mediaDepth !== null && depth <= mediaDepth) mediaDepth = null;
    }
  });

  it('keeps every motion-gated rule reachable', () => {
    // Отклики, которые обязаны гаситься при reducedMotion. Проверяется не «правило есть»,
    // а «правило есть ВНУТРИ гейта»: вне гейта оно срабатывает всегда, и настройка движения
    // в игре перестаёт что-либо значить.
    const gated = [
      '.floater',
      '.toast-card',
      '.model-row--pop',
      '.model-row--unlock',
      '.deny-flash',
      '.tab-badge--pulse',
      '.spark',
      '.burst-particle',
      '.mascot-hop',
      '.pulse-glow::after',
      '.glitch-jitter',
      '.scene__drone',
      '.click-btn--squash',
      '.thermal-spark',
    ];
    // Границы гейта: от каждого `@media (prefers-reduced-motion: no-preference)` до его
    // закрытия по счёту скобок. Гейтов в файле два, и проверка обязана видеть оба, иначе
    // переезд правила во второй блок прошёл бы молча.
    //
    // Совпадение ищется по префиксу, а не сравнением строки целиком: sass-подобная сборка
    // не трогает файл, но отступ у вложенного гейта не ноль, и строка приходит с пробелами.
    const ranges: [number, number][] = [];
    lines.forEach((line, i) => {
      if (!line.trim().startsWith('@media (prefers-reduced-motion: no-preference)')) return;
      let depth = 0;
      for (let j = i; j < lines.length; j++) {
        depth += (lines[j].match(/\{/g) ?? []).length - (lines[j].match(/\}/g) ?? []).length;
        if (depth === 0 && j > i) {
          ranges.push([i, j]);
          return;
        }
      }
    });
    expect(ranges.length, 'гейт prefers-reduced-motion должен быть').toBeGreaterThan(0);
    const body = (sel: string) =>
      ranges.some(([a, b]) => lines.slice(a, b + 1).some((l) => l.trim().startsWith(sel)));

    for (const sel of gated) {
      expect(body(sel), `${sel} не под гейтом prefers-reduced-motion`).toBe(true);
    }
  });

  it('keeps the empty placeholder rules harmless', () => {
    // Пустые правила в файле есть и на main: ими помечены классы, анимация которых живёт
    // в гейте. Сами по себе они допустимы, но не должны превратиться в мусор — правило без
    // тела обязано быть помечено комментарием, иначе следующий читатель не поймёт, зачем оно.
    //
    // Комментарий может быть многострочным, поэтому ищется не «предыдущая строка», а ближайшая
    // непустая строка выше: она обязана быть продолжением или закрытием комментария.
    lines.forEach((line, i) => {
      if (!line.trim().endsWith('{')) return;
      if (lines[i + 1]?.trim() !== '}') return;
      let above = i - 1;
      while (above >= 0 && lines[above].trim() === '') above--;
      const prev = lines[above]?.trim() ?? '';
      expect(
        prev.startsWith('/*') || prev.endsWith('*/'),
        `пустое правило на строке ${i + 1} без поясняющего комментария: ${line.trim()}`,
      ).toBe(true);
    });
  });
});
