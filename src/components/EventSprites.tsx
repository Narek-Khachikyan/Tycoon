import React, { useEffect, useState } from 'react';
import { reduceMotionMedia, useGameStore } from '../store/useGameStore';

/**
 * Процедурная графика событий: Золотой Токен, Глюк и Дрон с GPU.
 *
 * Всё рисуется кодом, а не картинками: события нужны сразу в нескольких размерах (от 16 px в
 * полосе кражи до 48 px в карточке события), и один спрайт тянется на все, тогда как растр
 * пришлось бы дублировать под каждый размер. Никаких SMIL и никаких keyframes в CSS.
 *
 * **Движение здесь не живёт.** Каждый спрайт — чистая функция состояния: перегрева (`heat`),
 * износа Глюка и, где есть, своей фазы полёта. Анимацию считает вызывающий компонент из
 * `state.lastTick`, то есть из того же тика, который и так перерисовывает игру двадцать раз в
 * секунду, и гасит настройкой движения через `useMotionAllowed`. Отдельного цикла, таймера и
 * нового кадра на каждый тик в слое нет — поэтому включение режима покоя не создаёт и не
 * пересоздаёт узлы, а просто перестаёт считать фазу.
 *
 * **Общий язык с Температурой.** Нагрев здесь — то же число, что у `--heat-glow` и у искр
 * над шкалой: металл Токена идёт от золота к белому калу, паразит на этом фоне бледнеет, а
 * сопло Дрона разгорается. Перегрев обязан читаться взглядом на любой из четырёх Сцен, и
 * графика обязана отражать его раньше, чем игрок прочитает число.
 *
 * **Пиксель, а не иллюстрация.** Растрызация идёт по сетке и склеивает соседние клетки одного
 * тона в отрезки: круг монеты отсюда круглый, а не восьмиугольник, и при этом рисуется пятью
 * `<path>`, а не тремястами `<rect>` — картинка перерисовывается каждый тик, и DOM должен быть
 * дешёвым.
 */

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/* ── Движение ──────────────────────────────────────────────────────────────────────── */

/**
 * Разрешено ли движение слою графики — по настройке игрока и по системе.
 *
 * Настройка приходит из состояния, система — из `matchMedia`, и обе читаются здесь же, а не в
 * трёх компонентах по разу: правило «движение выключено» одно на весь слой. Пока игрок не
 * трогал переключатель, компоненты перерисовываются только тиком; на смену системной настройки
 * подписан один слушатель на весь слой.
 *
 * В покое возвращается `false`, и вызывающий не создаёт частицы вовсе, а не «создаёт и гасит
 * правилом»: CSS-гейт умеет остановить анимацию, но не убрать узел из DOM. `?? true` —
 * fail closed, как в `motionAllowed` стора: непрочитанный список на движке без фичи отвечает
 * «движение разрешено», и без этой проверки слой поехал бы у игрока, который об этом не знал.
 */
export function useMotionAllowed(): boolean {
  const reduced = useGameStore((s) => s.state.settings.reducedMotion);
  const [systemReduced, setSystemReduced] = useState(() => reduceMotionMedia()?.matches ?? true);

  useEffect(() => {
    const mq = reduceMotionMedia();
    if (!mq) return;
    const onChange = () => setSystemReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return !reduced && !systemReduced;
}

/* ── Цвет ─────────────────────────────────────────────────────────────────────────── */

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Смешение двух цветов в sRGB: `t` = 0 берёт `a`, `t` = 1 берёт `b`.
 *
 * Без `color-mix()` и без зависимости: палитра спрайтов — это восемь-девять тонов на кадр, и
 * ради них не нужен ни CSS, ни нюансы цветового пространства. Смешивание в sRGB совпадает с
 * тем, что делает сам `color-mix(in srgb, …)` в интерфейсе, поэтому белый кал перегрева здесь
 * и на шкале Температуры — буквально один и тот же цвет.
 */
function mixHex(a: string, b: string, t: number): string {
  const pa = HEX.exec(a);
  const pb = HEX.exec(b);
  if (!pa || !pb) return a;
  const k = clamp01(t);
  const ch = (i: number): string => {
    const va = parseInt(pa[1].slice(i, i + 2), 16);
    const vb = parseInt(pb[1].slice(i, i + 2), 16);
    return Math.round(va + (vb - va) * k).toString(16).padStart(2, '0');
  };
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

/**
 * То же смешение, но для цветов интерфейса: `a` и `b` — CSS-значения (`var(--gold)`,
 * `#ff9a72`), а на выходе строка `color-mix()` для инлайнового стиля.
 *
 * Отдельная функция, потому что палитра спрайтов и палитра интерфейса живут в разных местах:
 * спрайты зашиты литералами (они одинаковы в карточке события и над почти чёрным полом Сцены),
 * а карточка и рамки обязаны брать тот же тон из `--gold` и `--thermal-hot`, что и шкала
 * Температуры. Три литерала в трёх компонентах разошлись бы при первой правке палитры.
 *
 * `alpha` нужен ореолу: он должен быть тем же цветом, но прозрачным, и без четвёртого слагаемого
 * пришлось бы писать вторую функцию.
 */
export function mixVar(a: string, b: string, heat: number, alpha?: number): string {
  const pct = Math.round(clamp01(heat) * 100);
  const base = `color-mix(in srgb, ${a} ${100 - pct}%, ${b})`;
  if (alpha === undefined) return base;
  return `color-mix(in srgb, ${base} ${Math.round(clamp01(alpha) * 100)}%, transparent)`;
}

/* ── Золотой Токен ────────────────────────────────────────────────────────────────── */

/**
 * Палитра Токена. Девять тонов на кадр: от контура до блика.
 *
 * Перегрев идёт ДВУМЯ путями сразу: металл бледнеет к белому калу (`--thermal-hot`), а контур
 * теплеет — холодная тень на раскалённом металле читается как «это горячо», а просто
 * высветлённая монета — как «старая». У красного события те же девять слотов, но к
 * `--danger`: крашеный Токен отличает окно Восстания от обычного взглядом, раньше чем игрок
 * прочитает название события.
 */
export interface TokenPalette {
  outline: string;
  edgeShade: string;
  edgeLight: string;
  rim: string;
  face: string;
  faceLight: string;
  dieDark: string;
  dieLight: string;
  /** Цвет ореола вокруг монеты; в холоде совпадает с золотом и не читается. */
  halo: string;
}

const COLD: TokenPalette = {
  outline: '#1c0f06',
  edgeShade: '#7a4008',
  edgeLight: '#ffcf72',
  rim: '#b06f11',
  face: '#e8a33d',
  faceLight: '#ffd166',
  dieDark: '#8a4b0d',
  dieLight: '#ffe6a8',
  halo: '#e8a33d',
};

/** Тот же металл, но белый кал вместо золота: перегрев должен быть виден на самой монете. */
const HOT: TokenPalette = {
  outline: '#4a2a12',
  edgeShade: '#b98d5c',
  edgeLight: '#fff3d6',
  rim: '#e6c39a',
  face: '#fbe4bd',
  faceLight: '#fff6e6',
  dieDark: '#c79a6a',
  dieLight: '#fffaef',
  halo: '#fff1d6',
};

/** Красное окно Восстания: тот же Токен, но меди нагретой добела и с трещиной по краю. */
const RED: TokenPalette = {
  outline: '#2a0a06',
  edgeShade: '#7a2418',
  edgeLight: '#ffb08c',
  rim: '#b23a26',
  face: '#e0574a',
  faceLight: '#ff9a72',
  dieDark: '#7f2318',
  dieLight: '#ffc0a2',
  halo: '#e0574a',
};

/**
 * Палитра Токена по перегреву и признаку красного события.
 *
 * Квантование перегрева — не округление ради красоты: развёртка монеты кэшируется по ключу, и
 * без ступеней ключ менялся бы двадцать раз в секунду, то есть кэш пересобирался бы на каждом
 * тике. Шесть ступеней на шкале 0…1 — это различимая глазом разница, и их хватает, чтобы кадр
 * не «дрожал» в свете.
 */
export function tokenPalette(heat: number, red = false): TokenPalette {
  const t = Math.round(clamp01(heat) * 6) / 6;
  const base = red ? RED : COLD;
  const hot = red ? base : HOT;
  if (t === 0) return base;
  const mix = (k: keyof TokenPalette): string => mixHex(base[k], hot[k], t);
  return {
    outline: mix('outline'),
    edgeShade: mix('edgeShade'),
    edgeLight: mix('edgeLight'),
    rim: mix('rim'),
    face: mix('face'),
    faceLight: mix('faceLight'),
    dieDark: mix('dieDark'),
    dieLight: mix('dieLight'),
    halo: mix('halo'),
  };
}

/** Номера тонов монеты. Порядок — это порядок отрисовки: тёмное под светлым. */
const T_OUTLINE = 0;
const T_EDGE_SHADE = 1;
const T_EDGE_LIGHT = 2;
const T_RIM = 3;
const T_FACE = 4;
const T_FACE_LIGHT = 5;
const T_DIE_DARK = 6;
const T_DIE_LIGHT = 7;

const COIN_GRID = 32;
const COIN_CENTER = COIN_GRID / 2;
/** Радиус гурта: дальше этой окружности монеты нет вовсе. 15.6 против 16 по краю сетки — один
 *  пиксель запаса, чтобы ореол и масштаб не упирались в край viewBox. */
const COIN_RIM = 15.6;
/** Гурт: полоса между COIN_RIM и COIN_FACE. Здесь живут и насечки, поэтому он широкий. */
const COIN_GURT = 13.9;
const COIN_RING = 9.6;
/** Монета чеканная, а не гладкая: тонкое кольцо вокруг лицевой стороны. */
const COIN_INNER = 6.8;

/**
 * Тон клетки монеты.
 *
 * Свет сверху-слева, и по нему же решается всё: гурт светлеет слева и сверху, лицевая сторона
 * светлее поля у верхней кромки и темнее у нижней. Отсюда и объём — без него монета читалась бы
 * как плоская наклейка, сколько бы тонов ни стояло.
 *
 * Светлая ступень узкая и высшая по тону: широкий блик съедал почти всю лицевую сторону, и
 * монета читалась как печенье — бледное и плоское. Основной тон здесь золотой, и именно он
 * держит кадр.
 *
 * `−1` означает «здесь пусто»: клетки вне гурта не рисуются вовсе, и круг получается круглым,
 * а не восьмиугольником, как у нарисованной вручную монеты.
 */
export function coinTone(x: number, y: number): number {
  const dx = x + 0.5 - COIN_CENTER;
  const dy = y + 0.5 - COIN_CENTER;
  const r = Math.hypot(dx, dy);
  if (r > COIN_RIM) return -1;

  // Насечки гурта: четыре выреза по осям. Без них диск с тенью читается как капля, а с ними —
  // как монета с тиснёным краем, и край перестаётся быть мёртвой дугой.
  if (r > COIN_GURT && (Math.abs(dx) < 1 || Math.abs(dy) < 1)) return T_OUTLINE;
  if (r > COIN_GURT) return dx + dy < 0 ? T_EDGE_LIGHT : T_EDGE_SHADE;

  // Лицевая сторона: узкий серп блика сверху и тень у нижнего края. Вал вокруг микросхемы —
  // углубление, а не вторая линия: на одном поле монета читалась бы как мишень.
  if (r > COIN_RING) {
    if (dy < -3) return T_EDGE_LIGHT;
    return dx + dy > 3 ? T_EDGE_SHADE : T_FACE;
  }
  if (r > COIN_INNER) {
    if (dy < -1) return T_EDGE_LIGHT;
    // Блик на поле лицевой стороны: маленькое пятно у верхнего левого края. Без него монета
    // остаётся правильной, но не блестит, а блеск и есть разница между металлом и краской.
    if (dx < -3 && dy < -3) return T_FACE_LIGHT;
    return dx + dy > 1 ? T_EDGE_SHADE : T_RIM;
  }

  // Чеканка «Т» в центре: Токен — это Токен, а не абстрактное золото. Тень под верхней перекладиной
  // делает букву объёмной; выводов-ножек по бокам здесь нет намеренно — на круглом царапанном
  // поле они читались глазами, и монета получалась лицом.
  const ax = Math.abs(dx);
  if (ax <= 2.5 && dy >= -0.5 && dy <= 0.5) return T_DIE_LIGHT;
  if (ax <= 2.5 && dy >= 0.5 && dy <= 1.5) return T_DIE_DARK;
  if (ax <= 0.5 && dy > 1.5 && dy <= 3.5) return T_DIE_DARK;
  return T_RIM;
}

/**
 * Растровая развёртка: клетки одного тона в ряду склеиваются в отрезок, отрезки одного тона —
 * в один `d`.
 *
 * Восемь path на монету вместо трёхсот rect: кадр перерисовывается каждый тик, и на таких
 * размерах React сравнивал бы сотни детей двадцать раз в секунду ради картинки, которая не
 * меняется. Пустые тон пропускаются, поэтому у бледной монеты на их месте просто нет узлов.
 */
export function rasterize(grid: number, toneAt: (x: number, y: number) => number): readonly string[] {
  const spans: string[][] = [];
  let max = -1;
  for (let y = 0; y < grid; y += 1) {
    let x = 0;
    while (x < grid) {
      const tone = toneAt(x, y);
      if (tone < 0) {
        x += 1;
        continue;
      }
      let w = 1;
      while (x + w < grid && toneAt(x + w, y) === tone) w += 1;
      const run = spans[tone] ?? (spans[tone] = []);
      run.push(`M${x} ${y}h${w}v1h${-w}z`);
      if (tone > max) max = tone;
      x += w;
    }
  }
  return Array.from({ length: max + 1 }, (_, i) => (spans[i] ?? []).join(''));
}

/** Кэш развёрток: ключ — вариант и ступень перегрева, их не больше семи на палитру. */
const COIN_D = new Map<string, readonly string[]>();

function coinPaths(p: TokenPalette): readonly string[] {
  const key = `${p.face}${p.outline}`;
  const hit = COIN_D.get(key);
  if (hit) return hit;
  const paths = rasterize(COIN_GRID, coinTone);
  COIN_D.set(key, paths);
  return paths;
}

const TOKEN_TONES: readonly (keyof TokenPalette)[] = [
  'outline',
  'edgeShade',
  'edgeLight',
  'rim',
  'face',
  'faceLight',
  'dieDark',
  'dieLight',
];

export interface TokenSpriteProps {
  size?: number;
  className?: string;
  /** Перегрев 0…1: металл идёт к белому калу. */
  heat?: number;
  /** Красное событие: меди в пепельно-красном. */
  red?: boolean;
}

/**
 * Золотой Токен: монетка с чеканной микросхемой в центре.
 *
 * Форма задана формулой, а не набором прямоугольников, поэтому монета остаётся круглой на всех
 * трёх размерах, в которых она живёт: 16 px в полосе кражи, 26 px у Глюка и 48 px в карточке
 * события. Блик держится на одной стороне (верх-слева), поэтому при любом размере кадр читается
 * как один источник света.
 */
export const GoldenToken: React.FC<TokenSpriteProps> = ({
  size = 32,
  className,
  heat = 0,
  red = false,
}) => {
  const p = tokenPalette(heat, red);
  const d = coinPaths(p);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${COIN_GRID} ${COIN_GRID}`}
      shapeRendering="crispEdges"
      aria-hidden={true}
      focusable="false"
      role="presentation"
      className={className}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    >
      {d.map((path, i) =>
        path === '' ? null : <path key={i} d={path} fill={p[TOKEN_TONES[i]]} />,
      )}
    </svg>
  );
};

/**
 * Круг разлетающихся монет вокруг Токена в момент поимки события.
 *
 * Движение целиком в радиусе самого спрайта: разброс шире наехал бы на подписи карточки, а
 * карточка стоит под счётчиком Токенов, и монета, летящая в счётчик, читалась бы как ошибка
 * вёрстки. Радиус, тон и число монет выведены из индекса, поэтому рой не повторяется и не
 * дрожит на каждом тике.
 */
const COIN_TOSS_MS = 420;
const COIN_TOSS_R = 20;

export function coinToss(
  elapsedMs: number,
  seed: number,
): { dx: number; dy: number; scale: number; opacity: number } | null {
  if (!(elapsedMs >= 0) || elapsedMs >= COIN_TOSS_MS) return null;
  const t = elapsedMs / COIN_TOSS_MS;
  // Угол из индекса, а не из времени: иначе все монеты летели бы по одной траектории и рой
  // читался бы как одна вспышка, а не как высыпанная мелочь.
  const angle = ((seed * 2.399963) % (Math.PI * 2)) - Math.PI;
  const reach = COIN_TOSS_R * (0.55 + 0.45 * Math.sin(t * Math.PI));
  return {
    dx: Math.round(Math.cos(angle) * reach),
    // Вверх сильнее, чем вниз: монета отскакивает от ладони, а не падает в неё.
    dy: Math.round(Math.sin(angle) * reach - t * 6),
    // Целые доли сетки: спрайт пиксельный, и дробный масштаб превращал бы его в мыло.
    scale: Math.max(0.34, Math.round((1 - t * 0.66) * 8) / 8),
    opacity: Math.round(Math.min(1, (1 - t) * 1.6) * 100) / 100,
  };
}

/** Сколько монет в одном ройке: пять — читаемый рой, десять превратились бы в грязь. */
export const COIN_TOSS_COUNT = 5;

/* ── Глюк ──────────────────────────────────────────────────────────────────────────── */

/** Глаз Глюка темнеет по мере износа: чем ближе лопание, тем злее читается паразит. */
export function glitchEye(heat: number, cracks: number): string {
  return cracks >= 2 ? '#ff5c5c' : mixHex('#4ade80', '#fff1d6', clamp01(heat));
}

/**
 * Блик перегрева у Глюка: растёт от еле заметного до белого кала.
 *
 * Глюк — чужой в офисе, и нагрев делает его не своей, а общей болезнью: на жаре он бледнеет
 * тем же тоном, что металл Токена. Это и есть требование «графика отражает перегрев»: один
 * перегрев — один кал, а не по своему оттенку на каждом спрайте.
 */
export function glitchHeatMix(heat: number): number {
  // Квадрат, а не линейная доля: при 0.3 перегрева паразит обязан оставаться своим, иначе
  // он бледнел бы раньше шкалы Температуры.
  return clamp01(heat) * clamp01(heat);
}

const GLITCH_GRID = 28;
const GLITCH_CX = 14;
const GLITCH_CY = 14;

/**
 * Силуэт паразита: эллипс, подрезанный двумя гармониками.
 *
 * Формулой, а не прямоугольниками: десять копий подряд иначе читались бы как плитки, а живое
 * пятно с двумя «собачками» по бокам — как то, чем Глюк и является. Тон зависит от расстояния до
 * края, поэтому контур остаётся контуром при любом размере.
 *
 * `wobble` — амплитуда неровностей, и она растёт с перегревом: на жаре паразит корчится. Это
 * единственное место, где графика слоя двигает СИЛУЭТ, а не положение, поэтому при выключенном
 * движении картинка остаётся целой, а не замирает намертво.
 */
function glitchBodyTone(x: number, y: number, wobble: number): number {
  const dx = x + 0.5 - GLITCH_CX;
  const dy = y + 0.5 - GLITCH_CY;
  const ang = Math.atan2(dy, dx);
  const r =
    Math.hypot(dx / 10.6, dy / 9.4) /
    (1 + (0.14 + 0.08 * wobble) * Math.sin(ang * 3 + 0.6) + (0.08 + 0.06 * wobble) * Math.cos(ang * 2 - 1.1));
  if (r > 1) return -1;
  // Контур в две клетки: на 28 px один пиксель контура есть, а двух — уже силуэт, и десять
  // паразитов перестают сливаться в кляксу на светлой Сцене 2.
  if (r > 0.88) return 0;
  if (r > 0.66) return dy < 0 ? 3 : 1;
  return dy < -1.5 ? 3 : 2;
}

export interface GlitchSpriteProps {
  size?: number;
  className?: string;
  heat?: number;
  /** Ступень износа: число ударов до лопания. */
  cracks?: number;
}

/**
 * Глюк: паразит, который сосёт Доход и которого игрок лопает кликами.
 *
 * Глаза, усики и рот нарисованы поверх силуэта, а не встроены в него: паразит должен узнаваться
 * по лицу, а по формуле тела узнаётся только пятно. Износ виден трещинами и покраснением глаз,
 * поэтому третий удар не приходится угадывать — паразит уже выглядит тем, кто вот-вот лопнет.
 */
export const GlitchSprite: React.FC<GlitchSpriteProps> = ({
  size = 28,
  className,
  heat = 0,
  cracks = 0,
}) => {
  const mix = glitchHeatMix(heat);
  const base = ['#170d26', '#3b1170', '#6d28d9', '#8b5cf6'];
  const pale = ['#241640', '#5b21b6', '#a78bfa', '#ddd6fe'];
  const d = glitchPaths(mix);
  const tone = (i: number): string => mixHex(base[i], pale[i], mix);
  const eye = glitchEye(heat, cracks);
  const stage = Math.max(0, Math.min(2, Math.floor(cracks)));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GLITCH_GRID} ${GLITCH_GRID}`}
      shapeRendering="crispEdges"
      aria-hidden={true}
      focusable="false"
      role="presentation"
      className={className}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    >
      {d.map((path, i) => (path === '' ? null : <path key={i} d={path} fill={tone(i)} />))}

      {/* Усики: два торчащих конца с зелёными набалдашниками. Они и делают пятно паразитом, а не
          камнем; на палитре сцены зелёный — единственное чужое пятно, и глаз цепляется за него. */}
      <g fill={tone(1)}>
        <rect x="10" y="3" width="2" height="5" />
        <rect x="16" y="3" width="2" height="5" />
      </g>
      <g fill={eye}>
        <rect x="9" y="1" width="4" height="3" />
        <rect x="15" y="1" width="4" height="3" />
      </g>

      {/* Глаза: глаз — состояние, а не украшение. На жаре он идёт к белому калу, на последнем
          ударе краснеет, и паразит читается как готовый лопнуть за одно нажатие. Узкие, с
          зрачком в две клетки: широкие глаза на круглом теле читались бы как гогглы. */}
      <g fill={eye}>
        <rect x="8" y="11" width="4" height="4" />
        <rect x="16" y="11" width="4" height="4" />
      </g>
      <g fill="#12061c">
        <rect x="9" y="12" width="2" height="3" />
        <rect x="17" y="12" width="2" height="3" />
      </g>
      <g fill="#ffffff">
        <rect x="9" y="12" width="1" height="1" />
        <rect x="17" y="12" width="1" height="1" />
      </g>

      {/* Пасть: щель с двумя клыками и каплей слюны. Тёмный тон — паразит должен читаться
          чужим, а не игрокским, и рот здесь самый тёмный пятно на теле. */}
      <g fill={tone(0)}>
        <rect x="10" y="18" width="8" height="3" />
        <rect x="9" y="22" width="3" height="2" />
        <rect x="16" y="22" width="3" height="2" />
      </g>
      <g fill={mix > 0.5 ? '#f5f3ff' : '#e9d5ff'}>
        <rect x="11" y="18" width="2" height="2" />
        <rect x="15" y="18" width="2" height="2" />
      </g>
      {stage < 2 && <rect x="14" y="21" width="2" height="2" fill={eye} />}

      {/* Трещины. Первая — волосяная линия, вторая — та же линия глубже и с куском, который
          высыпался: износ обязан нарастать, иначе два последних удара выглядели бы одинаково. */}
      {stage >= 1 && (
        <g fill={mix > 0.5 ? '#ffffff' : '#e9d5ff'}>
          <rect x="12" y="7" width="2" height="3" />
          <rect x="10" y="10" width="4" height="2" />
          <rect x="6" y="14" width="3" height="2" />
        </g>
      )}
      {stage >= 2 && (
        <g>
          <rect x="18" y="8" width="4" height="2" fill={tone(0)} />
          <rect x="17" y="7" width="2" height="1" fill={tone(0)} />
          <rect x="5" y="17" width="3" height="2" fill={mix > 0.5 ? '#ffffff' : '#e9d5ff'} />
        </g>
      )}
    </svg>
  );
};

const GLITCH_D = new Map<string, readonly string[]>();

function glitchPaths(mix: number): readonly string[] {
  const key = String(Math.round(mix * 6));
  const hit = GLITCH_D.get(key);
  if (hit) return hit;
  const paths = rasterize(GLITCH_GRID, (x, y) => glitchBodyTone(x, y, mix));
  GLITCH_D.set(key, paths);
  return paths;
}

/* ── Сцена: полосы ────────────────────────────────────────────────────────────────── */

/**
 * Что слою событий нельзя занимать в Сцене.
 *
 * Три полосы принадлежат не ему, и все три несут собственный текст: HUD с числом Агентов и
 * полоса кражи наверху, счётчики Маскотов внизу. Дрон, летящий через кадр, обязан пройти между
 * ними, а не поверх — иначе событие перекрывает подпись, которую игрок читает именно в этот
 * момент. Отсюда и порядок полос: сначала хард, потом полоса Дрона, под ней рой Глюков, внизу
 * Маскоты.
 */
export interface SceneBands {
  /** Верх полосы пролёта Дрона: сразу под HUD. */
  droneTop: number;
  /** Высота полосы Дрона: спрайт плюс его вертикальный размах. */
  droneHeight: number;
  /** Верх полосы Глюков: под полосой Дрона, чтобы дрон не лез на паразитов. */
  swarmTop: number;
  /** Сколько высоты Сцены рой может занять, не достав до счётчиков Маскотов. */
  swarmMaxHeight: number;
}

/** HUD (40 px) + полоса кражи (31 px) + запас на скрим. Обе полосы — фиксированная хромка. */
const HUD_RESERVED = 84;
/** Минимальная высота полотна — это `minHeight` Сцены в OfficeColumn. Запас на первый кадр,
 *  когда высота ещё не измерена: без неё полосы считались бы от нуля и слой встал бы на HUD. */
export const PLATE_MIN_H = 300;
/** Отступ ленты Маскотов (12 px) + подпись под ними (16 px) + запас. */
const COUNTER_RESERVED = 34;
/** Спрайт Дрона (24 px) плюс вертикальный размах полёта (10 px) в каждую сторону. */
const DRONE_LANE = 46;
/** Зазор между полосой Дрона и роем, чтобы дрон не цеплял верхний ряд паразитов. */
const LANE_GAP = 10;

/**
 * Полосы Сцены для слоя событий. Вход — измеренная высота полотна, выход — пиксели.
 *
 * Считается от измеренной высоты, а не от процентов: проценты от минимальной Сцены в 300 px
 * на экране в 487 px дают разные полосы, и дрон на высоком офисе уезжал бы под счётчики
 * Маскотов. Здесь при большем полотне полосы просто уезжают вниз вместе с ним.
 */
export function sceneBands(plateH: number): SceneBands {
  const h = plateH > 0 ? plateH : PLATE_MIN_H;
  const droneTop = HUD_RESERVED;
  const swarmTop = droneTop + DRONE_LANE + LANE_GAP;
  return {
    droneTop,
    droneHeight: DRONE_LANE,
    swarmTop,
    swarmMaxHeight: Math.max(0, Math.round(h) - COUNTER_RESERVED - swarmTop),
  };
}

/* ── Дрон ──────────────────────────────────────────────────────────────────────────── */

/** Пролёт Дрона: сколько длится и как далеко уходит за края. */
/** Сколько длится пролёт Дрона через Сцену. */
export const DRONE_FLIGHT_MS = 2600;
const DRONE_LIFT = 10;

export interface DroneFlight {
  /** Смещение слоя в пикселях от левого края Сцены. */
  x: number;
  /** Вертикальное смещение: дуга вверх с лёгким просадением на выходе. */
  y: number;
  opacity: number;
  /** Поворот рамок винтов, градусы. */
  spin: number;
}

/**
 * Полёт Дрона по прошедшему времени окна события.
 *
 * Время — игровое, то есть `lastTick − startedAt`, и это единственный источник: отдельный таймер
 * на перезапуск пролёта означал бы второй цикл анимации в компоненте. `null` вне окна полёта,
 * поэтому узел пропадает сам, а не висит в кадре прозрачным.
 *
 * Прозрачение по краям обязательно: дрон входит и выходит за кадр, и без плавного края он
 * появляется и исчезает щелчком на самой картине.
 */
export function droneFlight(elapsedMs: number, plateW: number, spriteW: number): DroneFlight | null {
  if (!(elapsedMs >= 0) || elapsedMs >= DRONE_FLIGHT_MS) return null;
  const p = elapsedMs / DRONE_FLIGHT_MS;
  // Вход и выход за кадр на ширине собственного спрайта, а не процентами: дрон целиком уходит
  // за левый и правый край на любой ширине Сцены.
  const span = Math.max(0, plateW) + spriteW * 2;
  const fade = Math.min(1, p / 0.14) * Math.min(1, (1 - p) / 0.14);
  return {
    x: Math.round(-spriteW + p * span),
    y: Math.round(-DRONE_LIFT * Math.sin(Math.PI * p) + DRONE_LIFT * 0.4 * p),
    opacity: Math.max(0, Math.min(1, fade)),
    spin: Math.round((elapsedMs / 90) % 1 * 360),
  };
}

/**
 * Токен, который Дрон роняет на пути.
 *
 * Падает от брюха вниз и гаснет, то есть читается как «сбросил груз», а не как украшение.
 * Монетка появляется с середины полёта: раньше она летела бы вместе с Дроном и не читалась, а
 * в самом конце — уже не успевала бы упасть.
 */
export function droneDrop(
  elapsedMs: number,
): { dy: number; scale: number; opacity: number } | null {
  const from = DRONE_FLIGHT_MS * 0.42;
  if (elapsedMs < from) return null;
  const t = Math.min(1, (elapsedMs - from) / (DRONE_FLIGHT_MS * 0.5));
  return {
    dy: Math.round(t * 26),
    scale: Math.max(0.4, Math.round((1 - t * 0.5) * 8) / 8),
    opacity: Math.round(Math.max(0, 1 - t * t) * 100) / 100,
  };
}

/**
 * Длина сопла Дрона по перегреву.
 *
 * Тяга греющегося офиса: сопло растёт с тем же перегревом, который красит край Сцены. На холоде
 * сопла нет вовсе — иначе Дрон на холодном офисе выглядел бы как припаркованный реактивный
 * истребитель, а не как рабочая лодка офиса.
 */
export function droneThrust(heat: number): number {
  return Math.round(clamp01(heat) * 5);
}

const DRONE_W = 44;
const DRONE_H = 26;

export interface GpuDroneProps {
  /** Ширина спрайта; высота выводится из пропорции viewBox. */
  size?: number;
  className?: string;
  heat?: number;
  /** Поворот рамок винтов в градусах — фаза полёта, см. `droneFlight`. */
  spin?: number;
  red?: boolean;
}

/**
 * Дрон с GPU: несёт видеокарту над офисом и роняет Токен.
 *
 * Раскладка сетки снизу вверх, и это не вкусщина: полозы, ремни и корпус должны состыковаться,
 * иначе дрон читается как ящик с двумя вентиляторами. Нос справа — дрон летит туда, куда его
 * выносит полёт. Лопасти нарисованы крестом и крутятся: одна лопасть при двадцати кадрах в
 * секунду читалась бы как шатающаяся проволока. Видеокарта под брюхом — идентичность дрона, и
 * золотые дорожки на плате держат его в палитре Токена: зелёная плата спорила бы с акцентом
 * Поколения, а золото читается как «Токен».
 */
export const GpuDrone: React.FC<GpuDroneProps> = ({
  size = DRONE_W,
  className,
  heat = 0,
  spin = 0,
  red = false,
}) => {
  const thrust = droneThrust(heat);
  const flame = thrust > 0 ? mixHex('#ff8a3c', '#fff1d6', clamp01(heat)) : 'transparent';
  const led = red ? '#ff5c5c' : '#4ade80';
  // Крест из двух лопастей вокруг ступицы: винты должны быть видны целиком, иначе на 40 px
  // остаются две серые точки, а не крылья.
  const rotor = (cx: number, cy: number) => (
    <g transform={`rotate(${spin} ${cx} ${cy})`}>
      <rect x={cx - 5} y={cy - 1} width="10" height="2" fill="#94a3b8" />
      <rect x={cx - 1} y={cy - 5} width="2" height="10" fill="#cbd5e1" />
      <rect x={cx - 1} y={cy - 1} width="2" height="2" fill="#f1f5f9" />
    </g>
  );

  return (
    <svg
      width={size}
      height={Math.round((size * DRONE_H) / DRONE_W)}
      viewBox={`0 0 ${DRONE_W} ${DRONE_H}`}
      shapeRendering="crispEdges"
      aria-hidden={true}
      focusable="false"
      role="presentation"
      className={className}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    >
      {/* Сопло. На холоде прозрачно: тяга есть только у греющегося офиса. Три ступени в длину,
          а не одна полоса, — пламя сужается, и Дрон читается как летящий, а не как ящик с
          оранжевой чертой сзади. */}
      {thrust > 0 && (
        <g fill={flame}>
          <rect x={8 - thrust} y="12" width={thrust} height="2" />
          <rect x={9 - thrust} y="14" width={thrust} height="1" opacity={0.75} />
          <rect x={10 - thrust} y="10" width={Math.max(1, thrust - 2)} height="1" opacity={0.5} />
        </g>
      )}

      {/* Стойки: из них кольца винтов свисают к корпусу. Без стоек винты висели бы в воздухе
          над дроном двумя отдельными предметами. */}
      <g fill="#475569">
        <rect x="8" y="9" width="3" height="3" />
        <rect x="33" y="9" width="3" height="3" />
      </g>
      {/* Кольца винтов: две полосы сверху и снизу, отверстие залито тёмным, а не оставлено
          дыркой в разметке — иначе сквозь него читалась бы картина Сцены. */}
      <g fill="#64748b">
        <rect x="3" y="5" width="12" height="1" />
        <rect x="3" y="9" width="12" height="1" />
        <rect x="29" y="5" width="12" height="1" />
        <rect x="29" y="9" width="12" height="1" />
      </g>
      {rotor(9, 7)}
      {rotor(35, 7)}

      {/* Фюзеляж и нос. Нос каплевидный и с объективом: без сужения дрон читается как ящик. */}
      <rect x="13" y="11" width="19" height="7" fill="#0f172a" />
      <rect x="14" y="12" width="17" height="5" fill="#334155" />
      <rect x="15" y="12" width="12" height="1" fill="#475569" />
      <rect x="32" y="12" width="5" height="5" fill="#334155" />
      <rect x="37" y="13" width="3" height="3" fill="#0f172a" />
      <rect x="37" y="13" width="1" height="1" fill="#94a3b8" />
      {/* Кокпит: стекло над корпусом. Без него дрон читается как ящик, а кокпит делает его
          аппаратом, который куда-то несёт груз. */}
      <rect x="28" y="12" width="4" height="3" fill="#0ea5e9" />
      <rect x="28" y="12" width="4" height="1" fill="#7dd3fc" />
      {/* Мачта с огоньком: единственная деталь выше корпуса, из-за неё дрон узнаётся в проёме. */}
      <rect x="22" y="9" width="1" height="3" fill="#64748b" />
      <rect x="21" y="8" width="3" height="1" fill={led} />
      {/* Полозы по бокам корпуса: дают тень под брюхом, без которой дрон выглядит плоским. */}
      <rect x="15" y="18" width="14" height="1" fill="#334155" />

      {/* Ремни крепления груза. Без них видеокарта висела бы под корпусом, а не везлась. */}
      <g fill="#0f172a">
        <rect x="17" y="19" width="1" height="3" />
        <rect x="26" y="19" width="1" height="3" />
      </g>

      {/* Видеокарта под брюхом — то, что дрон несёт: плата, золотые контакты, радиатор с
          рёбрами и вентилятор. Вентилятор крутится в другую сторону, чем винты: одна частота на
          всей машине читалась бы как механизм, а не как техника. */}
      <rect x="15" y="20" width="15" height="6" fill="#0f172a" />
      <rect x="16" y="21" width="13" height="4" fill="#1c1917" />
      <rect x="16" y="22" width="3" height="2" fill="#b45309" />
      <rect x="20" y="21" width="4" height="4" fill="#475569" />
      <rect x="21" y="22" width="1" height="2" fill="#94a3b8" />
      <rect x="22" y="22" width="1" height="2" fill="#94a3b8" />
      <rect x="25" y="20" width="4" height="5" fill="#64748b" />
      <g transform={`rotate(${-spin} 27 22)`}>
        <rect x="25" y="21" width="4" height="3" fill="#0f172a" />
        <rect x="26" y="21" width="2" height="3" fill="#cbd5e1" />
      </g>
      <rect x="27" y="22" width="1" height="1" fill="#f1f5f9" />
    </svg>
  );
};


export interface EventSpriteProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const GlitchPopSprite: React.FC<EventSpriteProps> = ({ size = 28, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    shapeRendering="crispEdges"
    className={className}
    style={{ display: 'block', ...style }}
  >
    <rect x="2" y="2" width="2" height="2" fill="var(--accent-color)" />
    <rect x="20" y="2" width="2" height="2" fill="var(--accent-color)" />
    <rect x="2" y="20" width="2" height="2" fill="var(--accent-color)" />
    <rect x="20" y="20" width="2" height="2" fill="var(--accent-color)" />
    <rect x="6" y="6" width="3" height="3" fill="#ffe680" />
    <rect x="15" y="6" width="3" height="3" fill="#ffe680" />
    <rect x="6" y="15" width="3" height="3" fill="#ffe680" />
    <rect x="15" y="15" width="3" height="3" fill="#ffe680" />
    <rect x="10" y="10" width="4" height="4" fill="#ffffff" />
  </svg>
);
