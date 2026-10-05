/**
 * Процедурная музыка игры.
 *
 * Не цикл, а слой, который собирается под текущее состояние. Игрок в idle-игре проводит
 * часы в одном экране, и запись длиной в три минуты выдаёт себя на пятом повторе.
 * Здесь вместо записи четыре голоса, каждый включается и выключается по своим условиям,
 * а параметры ползучие — поэтому переход слышен как «стало громче», а не как «сменился трек».
 *
 * Голоса (снизу вверх по регистру):
 *   - бас       — треугольник на корне тоники, всегда: без него музыка висит в воздухе;
 *   - пульс     — шум сквозь узкий фильтр на доле такта, задаёт ритм и тон жара;
 *   - арпеджио  — меандр по гамме Поколения, идёт третьим;
 *   - подушка   — две расстроенные пилы, редкая, даёт ширину.
 *
 * Тон и лад задаёт Поколение, громкость — Температура. Обе величины приходят из состояния
 * числами, поэтому музыка не может разойтись с тем, что на экране.
 */
import { CATALOG, LAST_GENERATION } from '../economy/catalog';
import { HEAT_LIMIT, TEMP_MAX } from '../economy/thermal';
import { SFX_PEAK_CEILING } from './sfx';

/**
 * Доли, которые движок играет за раз. Ограничение нужно, чтобы setInterval, отставший
 * из-за фоновой вкладки, не разогнал бы очередь на десятки тысяч нот: музыка обязана
 * вернуться к текущему такту, а не выдать накопленное за полчаса безлума.
 */
const MAX_STEPS_PER_TICK = 32;

/**
 * Тональность Поколения.
 *
 * Восемь Поколений — восемь корней, и это единственное, что делает переход слышимым:
 * число «Поколение 2» игрок видит, а смену тона слышит. Лад не меняется: тональные
 * подушки в минорных тональностях звучат одинаково мрачно, и восемь разных настроений
 * перегрузили бы ухо сильнее, чем помогли.
 */
/**
 * Корни экспортируются не для красоты, а ради проверки: их число обязано совпадать с
 * числом Поколений в каталоге, иначе девятое Поколение получило бы тон седьмого молча,
 * а заметить это можно только слухом в игре, которую никто не слушает на девятом шаге.
 */
export const ROOTS = [55, 58.27, 61.74, 65.41, 69.3, 73.42, 77.78, 82.41] as const;

/** Ступени минорной гаммы от корня: только они, гамма одна на всю игру. */
const SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15] as const;

/** Скорость пульса в долях в секунду при полной Температуре. Растёт с жаром, и это главный
 *  признак температуры на слух: в холоде пульс еле слышен, на пределе — отчётлив. */
const PULSE_RATE_MIN = 0.6;
const PULSE_RATE_MAX = 2.4;

/**
 * Бюджет громкости музыки.
 *
 * Музыка обязана звучать ПОД звуковыми эффектами: игрок кликает раз в секунду и клик слышен,
 * а музыка — фон. Поэтому её суммарный пик держится на половине потолка эффектов, и с
 * запасом: щелчок, наложенный на долю, остаётся щелчком.
 *
 * Без этого ограничения музыка играла громче клика вчетверо — на пределе Температуры её
 * RMS был 0.21 против 0.04 у звуков, и фон заглушал то, ради чего игрок и кликает.
 */
export const MUSIC_PEAK_BUDGET = SFX_PEAK_CEILING * 0.5;

/** Пик удара пульса на единицу уровня шума: конверт в `scheduleNoiseHit`. */
const NOISE_HIT_PEAK = 0.25;

/**
 * Громкость голосов при текущем состоянии.
 *
 * Вынесена отдельной чистой функцией, а не строкой в `updateMusic`, потому что сумму голосов
 * обязательно нужно проверять: мастер выводится из неё делением, и единственная защита от
 * тихой музыки после правки голоса — тест, который складывает те же числа.
 *
 * Бас уходит с жаром, а арпеджио, пульс и подушка приходят. Иначе на пределе остаётся ровное
 * гудение, и Температура слышна только по скорости, а не по тембру.
 */
export function voiceGains(temp01: number, heat: number): { bass: number; arp: number; pad: number; noise: number } {
  return {
    // Бас слегка приходит с Температурой и уходит с жаром: низ проседает, и смесь
    // становится светлее ровно тогда, когда офис перегревается.
    bass: 0.26 + 0.04 * temp01 - 0.14 * heat,
    arp: 0.08 + 0.26 * temp01,
    pad: 0.05 + 0.10 * temp01,
    noise: 0.12 + 0.44 * temp01,
  };
}

/** Сумма пиков голосов: арпеджио и подушка — по два голоса, шум — через `NOISE_HIT_PEAK`. */
export function voicePeakSum(gains: { bass: number; arp: number; pad: number; noise: number }): number {
  return gains.bass + 2 * gains.arp + 2 * gains.pad + gains.noise * NOISE_HIT_PEAK;
}

/**
 * Худшая сумма голосов на всём прямоугольнике состояния.
 *
 * Сумма линейна по обеим величинам, поэтому максимум достигается в одной из четырёх углов,
 * и перебор сеткой был бы дороже той же правды. Углы, а не «температура и жар на максимуме»:
 * *одновременного* максимума у голосов нет — бас уходит с жаром, а остальные от него не
 * зависят, поэтому худшая точка это предел Температуры при холодном железе.
 */
function worstVoicePeakSum(): number {
  let worst = 0;
  for (const t of [0, 1]) {
    for (const h of [0, 1]) worst = Math.max(worst, voicePeakSum(voiceGains(t, h)));
  }
  return worst;
}

/**
 * Мастер: бюджет, делённый на худшую сумму голосов.
 *
 * Деление, а не константа: мастер нельзя задавать отдельно от голосов. Заданный отдельно,
 * он разъезжается с ними при первой же правке громкости — и музыка уходит за потолок
 * эффектов без единой строки, где это видно.
 */
export const MASTER_LEVEL = MUSIC_PEAK_BUDGET / worstVoicePeakSum();

const LOOKAHEAD_MS = 120;
const TICK_MS = 40;

/** Голос: осциллятор и его усиление. Осциллятор один на весь голос и перенастраивается
 *  по частоте, а не пересоздаётся — создание узла даёт щелчок на старте. */
interface Tone {
  osc: OscillatorNode;
  gain: GainNode;
}

interface MusicEngine {
  ctx: AudioContext;
  master: GainNode;
  /** Бас: один голос, всегда в игре. */
  bass: Tone;
  /** Арпеджио: два голоса в расстройке, дают ширину вместо «пилы из коробки». */
  arp: [Tone, Tone];
  /** Подушка: ещё пара, тише и без переноса огибающей. */
  pad: [Tone, Tone];
  noise: AudioBufferSourceNode;
  noiseFilter: BiquadFilterNode;
  noiseGain: GainNode;
  /** Номер следующей доли. Растёт монотонно и переживает смену Поколения. */
  step: number;
  timer: ReturnType<typeof setInterval> | null;
  /** Последние применённые значения. Кэш обязателен: без него планировщик дёргал бы
   *  `setTargetAtTime` пятьдесят раз в секунду на каждый голос, а слышно было бы ничего. */
  applied: { root: number; rate: number };
}

let engine: MusicEngine | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/** Нота по индексу ступени: сумма корня и гаммы, без нормализации октав — так мелодия
 *  не уезжает в неслышимую низость на третьем Поколении. */
const noteAt = (root: number, degree: number): number => root * Math.pow(2, SCALE[degree % SCALE.length] / 12) * Math.pow(2, Math.floor(degree / SCALE.length));

/**
 * Создаёт один голос: осциллятор с усилением, оба подключены к мастеру.
 *
 * Осцилляторы создаются ОДИН раз на весь голос и перенастраиваются по частоте на каждой
 * доле. Создавать новый на ноту дороже, чем менять частоту существующего, и главное —
 * создание узла даёт щелчок на старте, который слышно как «пук» в такт.
 */
function makeTone(
  ctx: AudioContext,
  master: GainNode,
  type: OscillatorType,
  detune = 0,
): { osc: OscillatorNode; gain: GainNode } {
  const osc = ctx.createOscillator();
  osc.type = type;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  if (detune !== 0) osc.detune.value = detune;
  osc.connect(gain).connect(master);
  osc.start();
  return { osc, gain };
}

/**
 * Поднимает музыку и держит её на текущих параметрах.
 *
 * Вызывается на тик из стора, а не по событию: параметры ползучие, и событийный перезапуск
 * слышался бы как переключение трека. `now` приходит из состояния — тот же `lastTick`,
 * по которому считается Доход, — поэтому музыка и экономика стоят на одних часах.
 */
export function updateMusic(
  ctx: AudioContext,
  params: { generation: number; temp: number; heat: number; muted: boolean },
): void {
  if (!engine || engine.ctx !== ctx) {
    stopMusic();
    if (params.muted) return;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const bass = makeTone(ctx, master, 'triangle');
    const arp = makeTone(ctx, master, 'square', 7);
    const arp2 = makeTone(ctx, master, 'square', -7);
    const pad = makeTone(ctx, master, 'sawtooth', -6);
    const pad2 = makeTone(ctx, master, 'sawtooth', 6);

    // Пульс — шум сквозь узкий полосовой фильтр: он даёт «тик», который осциллятор
    // не даёт, и на нём держится ощущение скорости.
    const noise = ctx.createBufferSource();
    noise.buffer = getNoise(ctx);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1800;
    noiseFilter.Q.value = 2.5;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start();

    engine = {
      ctx,
      master,
      bass,
      arp: [arp, arp2],
      pad: [pad, pad2],
      noise,
      noiseFilter,
      noiseGain,
      step: 0,
      timer: null,
      applied: { root: -1, rate: -1 },
    };

    // Планировщик доли: setInterval с упреждением, потому что `AudioParam` нельзя
    // «включить в такт» задним числом. Упреждение LOOKAHEAD_MS означает, что доля
    // назначается за 120 мс до её прихода, и браузер успевает её отыграть ровно.
    // Замыкание на локальную переменную: `engine` пересоздаётся при смене контекста, и
    // колбэк обязан смотреть на тот движок, который создал таймер, а не на поле, которое
    // к тому моменту может указывать на другой.
    const created = engine;
    created.timer = setInterval(() => schedule(created, ctx.currentTime), TICK_MS);
  }

  const e = engine;
  const root = ROOTS[Math.min(CATALOG.length - 1, Math.max(0, params.generation))] ?? ROOTS[0];
  const heat = Math.min(HEAT_LIMIT, Math.max(0, params.heat));
  // Скорость от Температуры, громкость — от неё же, но с задержкой: перегрев и жар
  // должны ощущаться по-разному, иначе это одна величина, названная двумя словами.
  const temp01 = Math.min(1, Math.max(0, params.temp / TEMP_MAX));
  const rate = PULSE_RATE_MIN + (PULSE_RATE_MAX - PULSE_RATE_MIN) * (0.35 * temp01 + 0.65 * heat);

  const now = ctx.currentTime;
  const glide = 0.25;

  // Громкость. Мастер выводится из суммы голосов, а не задаётся на глаз: см. MASTER_LEVEL.
  const target = params.muted ? 0 : 1;
  e.master.gain.setTargetAtTime(target * MASTER_LEVEL, now, glide);

  const g = voiceGains(temp01, heat);
  e.bass.gain.gain.setTargetAtTime(g.bass, now, glide);
  for (const t of e.arp) t.gain.gain.setTargetAtTime(g.arp, now, glide);
  for (const t of e.pad) t.gain.gain.setTargetAtTime(g.pad, now, glide);
  e.noiseGain.gain.setTargetAtTime(g.noise, now, glide);

  // Фильтр пульса ползёт вниз с жаром: горячее звучит глуше, как и выглядит.
  e.noiseFilter.frequency.setTargetAtTime(1200 + 2600 * (1 - heat), now, glide);

  e.applied.root = root;
  e.applied.rate = rate;
}

/**
 * Назначает доли, попадающие в окно упреждения.
 *
 * Ноты не пропускаются при отставании: если планировщик опоздал, доли просто не
 * назначаются, и музыка продолжается со следующей. Пытаться «догнать» значило бы
 * назначить десять нот на одно и то же время, и они ударили бы каскадом.
 */
function schedule(e: MusicEngine, horizon: number): void {
  const now = horizon;
  const root = e.applied.root > 0 ? e.applied.root : ROOTS[0];
  const rate = e.applied.rate > 0 ? e.applied.rate : PULSE_RATE_MIN;
  const beat = 1 / rate;
  // Окно упреждения: назначаем ноты от «сейчас» до «сейчас плюс упреждение». Всё, что
  // началось раньше `now`, уже невозможно отыграть и пропускается; всё, что дальше окна,
  // будет назначено на следующем тике.
  const horizon2 = now + LOOKAHEAD_MS / 1000;

  // Прокрутка мимо просроченных долей. Без неё первая же доля сессии имела бы время 0 при
  // now больше нуля, и Web Audio просто проигнорировал бы назначение — музыка молчала бы
  // первую долю. Счётчик не останавливается на пропуске: после простоя планировщик обязан
  // догнать текущий такт, а не отыгрывать всё, что «не заметил».
  while (e.step * beat < now) e.step++;

  const firstStep = e.step;
  while (e.step * beat <= horizon2 && e.step - firstStep < MAX_STEPS_PER_TICK) {
    scheduleStep(e, root, e.step * beat, e.step);
    e.step++;
  }
}

/**
 * Одна доля.
 *
 * Рисунок — четыре доли, а не случайный: `s % 4` даёт пульс на первой и третьей, как в
 * базовом ритме, а не «иногда». На сильных долях играет только пульс, на слабых — арпеджио,
 * и бас держит каждую вторую. Случайности здесь нет намеренно: ритм, который меняется
 * от такта к такту, читается как сбой, а не как живая игра.
 */
function scheduleStep(e: MusicEngine, root: number, t: number, step: number): void {
  const inBar = step % 4;
  const glide = 0.01;

  // Бас: корень на каждой сильной доле и квинта выше — единственный неизменный тон.
  if (inBar % 2 === 0) {
    setNote(e, t, root, inBar === 0 ? 0 : 7);
  }

  // Пульс: первая и третья доля. Громче на перегреве — услышно, что офис горячий.
  if (inBar === 0 || inBar === 2) {
    scheduleNoiseHit(e, t, inBar === 0 ? 1 : 0.6);
  }

  // Арпеджио: меандр вверх-вниз. На пределе скорость удваивается — та же температура,
  // тот же узор, но глаз и ухо слышат разницу.
  const up = Math.floor(step / 4) % 4;
  if (inBar === 1 || inBar === 3) {
    setNote(e, t, root, [0, 4, 7, 4][up] + 12, glide);
  }
}

/** Одноразовый удар шумом: короткий конверт, иначе шум гудел бы. */
function scheduleNoiseHit(e: MusicEngine, t: number, level: number): void {
  const ctx = e.ctx;
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const gain = ctx.createGain();
  // Разгон 1 мс и спад за 60 мс: щелчок на старте громче самогo удара.
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level * 0.25, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  src.connect(gain).connect(e.master);
  src.start(t);
  src.stop(t + 0.07);
}

/**
 * Ставит частоту на все голоса сразу: удар на басу должен звучать во всей ширине,
 * иначе низ уходил бы отдельно от середины.
 *
 * Голосов пять, и все получают одну ноту: подушка из двух пил даёт ширину, а одиночный
 * осциллятор слышно как «синтезатор из коробки». Частота меняется `setTargetAtTime` с
 * короткой постоянной времени, поэтому переход между нотами слышен как перелив, а не
 * как щелчок переключения.
 */
function setNote(e: MusicEngine, t: number, root: number, degree: number, glide = 0.01): void {
  const freq = noteAt(root, degree);
  for (const v of allTones(e)) v.osc.frequency.setTargetAtTime(freq, t, glide);
}

/** Все тона движка: бас, арпеджио и подушка. Список каждый раз собирается заново — он
 *  короткий, а держать его в состоянии значило бы дублировать то, что уже лежит в полях. */
const allTones = (e: MusicEngine): Tone[] => [e.bass, ...e.arp, ...e.pad];

/**
 * Останавливает музыку.
 *
 * Вызывается при глушении и при размонтировании. Голоса не удаляются из графа, а только
 * глушатся: `stop()` на осцилляторе необратим, и перезапуск после снятия мута потребовал
 * бы создавать их заново, а они и так уже созданы.
 */
export function stopMusic(): void {
  if (!engine) return;
  const e = engine;
  if (e.timer !== null) clearInterval(e.timer);
  e.master.gain.setTargetAtTime(0, e.ctx.currentTime, 0.15);
  // Узлы останавливаются с задержкой: убирать их мгновенно обрывало бы хвост ноты,
  // и на снятии мута слышался бы щелчок.
  const killAt = e.ctx.currentTime + 0.6;
  for (const t of allTones(e)) t.osc.stop(killAt);
  e.noise.stop(killAt);
  engine = null;
}

/** Тон последнего Поколения — для теста: смена Поколения обязана менять высоту. */
export const lastRoot = ROOTS[Math.min(LAST_GENERATION, ROOTS.length - 1)];
