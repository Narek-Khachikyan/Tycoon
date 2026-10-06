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
      '.scene__heat--haze',
    ];
    // Границы гейта: от каждого `@media (prefers-reduced-motion: no-preference)` до его
    // закрытия по счёту скобок. Гейтов в файле два, и проверка обязана видеть оба, иначе
    // переезд правила во второй блок прошёл бы молча.
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
    // Совпадение ищется по ВХОЖДЕНИЮ в строку, а не по префиксу строки. Это не ослабление
    // проверки, а её точная формулировка: любое правило внутри
    // `prefers-reduced-motion: no-preference` по определению действует только когда движение
    // разрешено, поэтому класс, упомянутый в селекторе внутри гейта, и есть запертый под
    // гейтом класс. Префикс требовал бы писать `.мotion` первым в селекторе и запрещал бы
    // совершенно законную форму `[data-thermal='hot'] .мotion`, где состояние стоит первым.
    const body = (sel: string) =>
      ranges.some(([a, b]) => lines.slice(a, b + 1).some((l) => l.trim().includes(sel)));

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

// Источники ниже читаются как текст намеренно: в node-окружении vitest компоненты
// не смонтировать (нет jsdom и Testing Library, а конфиг запускает только
// src/**/*.test.ts), поэтому проводку очистки — тот же обработчик в снятии,
// гашение таймера при закрытии — проверяем структурно, а не поведением.
// Это тот же приём, что и проверки css выше: ловится класс поломки, а не строка.
const sparks = readFileSync(new URL('./components/ThermalSparks.tsx', import.meta.url).pathname, 'utf8');
const modals = readFileSync(new URL('./components/Modals.tsx', import.meta.url).pathname, 'utf8');

/**
 * Таймеры и слушатели убираются за собой (issue #70).
 *
 * Два дефекта одного класса: слушатель медиазапроса снимался другой стрелкой
 * (removeEventListener с чужой функцией молча ничего не снимает — при каждом
 * перемонтировании оставался живой слушатель), а таймер сброса статуса копирования
 * не гасился при закрытии окна Настроек (окно не размонтируется, состояние живёт —
 * закрытие с переоткрытием в течение 2 с гасило статус свежей копии).
 */
describe('timers and listeners clean up after themselves', () => {
  it('removes the media listener with the same handler it added', () => {
    // Требуется именно идентификатор, а не «что-то передано»: две стрелки выглядят
    // как пара, но для removeEventListener это разные функции.
    const handlerOf = (verb: 'add' | 'remove'): string[] =>
      [
        ...sparks.matchAll(
          new RegExp(`${verb}EventListener\\('change',\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'g'),
        ),
      ].map((m) => m[1]);
    const adds = handlerOf('add');
    const removes = handlerOf('remove');
    expect(adds.length, `addEventListener('change', <имя>) обязан быть один: ${JSON.stringify(adds)}`).toBe(1);
    expect(removes.length, `removeEventListener('change', <имя>) обязан быть один: ${JSON.stringify(removes)}`).toBe(1);
    expect(removes[0], 'снимается другой обработчик — слушатель не снимется вовсе').toBe(adds[0]);
    expect(sparks.includes(`const ${adds[0]} =`), `обработчик ${adds[0]} обязан быть именованным`).toBe(true);
  });

  it('leaves no live media listener across remounts', () => {
    // Один add на монтирование плюс снятие в возврате эффекта: контракт эффектов React
    // (cleanup перед перезапуском и при размонтировании, в StrictMode монтирование
    // вообще двойное) превращает это в ноль живых слушателей после любого числа
    // перемонтирований. Проверка выше уже доказала «тем же обработчиком», здесь —
    // «в возврате эффекта и ровно одна подписка».
    const adds = (sparks.match(/addEventListener\('change'/g) ?? []).length;
    expect(adds, 'подписка на смену настройки обязана быть одна на монтирование').toBe(1);
    expect(
      sparks,
      'снятие обязано жить в возврате эффекта, иначе перемонтирование его не зовёт',
    ).toMatch(/return \(\) => mq\?\.removeEventListener\('change',\s*[A-Za-z_$][\w$]*\)/);
  });

  it('clears the copy-status timer when Settings closes', () => {
    // id таймера обязан лежать в рефе: без него закрытию гасить нечего.
    expect(
      modals,
      'таймер сброса «Скопировано» не отслеживается: id setTimeout обязан лежать в рефе',
    ).toMatch(/copyTimer\.current\s*=\s*(?:window\.)?setTimeout/);
    // Два гашения: cleanup эффекта (закрытие окна и размонтирование) и перевзведение
    // при повторной копии (иначе старый таймер гасит статус свежей копии).
    const clears = (modals.match(/clearTimeout\(copyTimer\.current\)/g) ?? []).length;
    expect(clears, `нужно два гашения (cleanup + перевзведение), найдено ${clears}`).toBeGreaterThanOrEqual(2);
    expect(
      modals,
      'таймер обязан гаситься в cleanup эффекта, иначе закрытие его не зовёт',
    ).toMatch(/return \(\) => \{[\s\S]*?clearTimeout\(copyTimer\.current\)/);
  });
});
