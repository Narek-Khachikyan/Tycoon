/**
 * Звук Температуры.
 *
 * Отдельный модуль от `sound.ts`, потому что здесь не один вызов, а непрерывный голос:
 * короткие сигналы живут в том файле, а «температурный гул» обязан тянуться, меняться по
 * жару и сниматься остужанием. Смешивать их в одном модуле значило бы держать рядом
 * одноразовые вызовы и состояние, которое живёт минутами.
 *
 * Голос сделан из трёх слоёв, и каждый отвечает за свою часть шкалы:
 *   - шум сквозь полосовой фильтр — «жар», слышен с середины шкалы и выше;
 *   - пила с расстроем — «нестабильность», детюнит тем сильнее, чем горячее;
 *   - низкий треугольник — «тело», всегда на месте, чтобы голос не исчезал в холоде.
 *
 * Расстройство и фильтр задаются одним числом из состояния, поэтому игрок слышит ровно ту же
 * температуру, которую видит на шкале. Это и есть требование сигнатурной фишки: одно число
 * звучит, видно и ощущается.
 */

let noiseBuffer: AudioBuffer | null = null;

/** Белый шум один раз на контекст: генерировать его на каждый тик было бы чистой растратой. */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Двухсекундная петля нужна, чтобы шум не повторялся на каждом цикле источника.
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/**
 * Живой голос. Держится между вызовами, поэтому `updateThermalAudio` на каждом тике ничего
 * не пересоздаёт: источники запускаются один раз, а меняются только параметры.
 *
 * Контекст входит в состояние не для красоты: после `close()` старые узлы уже мёртвые, и
 * новый контекст без пересоздания голоса играл бы в никуда.
 */
let voice: {
  ctx: AudioContext;
  out: GainNode;
  saw: OscillatorNode;
  sawGain: GainNode;
  noise: AudioBufferSourceNode;
  noiseFilter: BiquadFilterNode;
  noiseGain: GainNode;
  body: OscillatorNode;
  bodyGain: GainNode;
} | null = null;

/** Распределение: 0 в холоде, 1 на максимуме шкалы. */
export interface ThermalAudioParams {
  /** Температура, [0, 1]. */
  temp: number;
  /** Перегрев, [0, 1]. */
  heat: number;
  muted: boolean;
}

/**
 * Поднимает голос Температуры и держит его на нужном уровне.
 *
 * Один вызов на тик, а не событие: параметры ползучие, и пересоздавать источники каждые
 * 50 мс было бы и слышно, и дорого. `start()` вызывается ровно один раз за жизнь голоса,
 * а всё остальное — `setTargetAtTime`, который по определению плавный и не щёлкает.
 *
 * `setTargetAtTime` с постоянной времени 0.08 с — это тот самый 80 мс, за которые ухо
 * принимает изменение тембра за движение, а не за скачок громкости.
 */
export function updateThermalAudio(ctx: AudioContext, { temp, heat, muted }: ThermalAudioParams): void {
  const target = muted ? 0 : 1;
  if (!voice || voice.ctx !== ctx) {
    // Смена контекста: старые узлы глушим и отпускаем, иначе они держат осцилляторы, а
    // новый контекст остался бы без голоса до следующей смены.
    if (voice) voice.out.gain.setValueAtTime(0, ctx.currentTime);
    voice = null;
    if (muted) return;

    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(ctx.destination);

    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    // Частота тела задаёт основной тон голоса; он не меняется, потому что это «гул офиса»,
    // а не мелодия. Тепло меняет тембр, а не высоту.
    const sawGain = ctx.createGain();
    sawGain.gain.value = 0;
    saw.connect(sawGain).connect(out);

    const noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.Q.value = 1.1;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(out);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 55; // A1: ниже голоса телефона, поэтому его почти не слышно как тон
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0;
    body.connect(bodyGain).connect(out);

    saw.start();
    noise.start();
    body.start();

    voice = { ctx, out, saw, sawGain, noise, noiseFilter, noiseGain, body, bodyGain };
  }

  const v = voice;
  const now = ctx.currentTime;
  const tc = 0.08;
  // Расстройка растёт от нуля в холоде до полутона в раскалённом состоянии. Полутон — порог,
  // за которым ухо начинает слышать «не ту ноту» вместо «плавающей ноты»; больше значило бы
  // уже не характер, а ошибка.
  const detune = 50 * temp + 220 * heat;
  v.saw.detune.setTargetAtTime(detune, now, tc);
  // Частота фильтра идёт вниз с жаром: раскалённый офис звучит глуше.
  v.noiseFilter.frequency.setTargetAtTime(280 + 2200 * (1 - temp), now, tc);
  v.noiseGain.gain.setTargetAtTime(0.05 * temp, now, tc);
  v.sawGain.gain.setTargetAtTime(0.035 * temp, now, tc);
  // Тело остаётся, даже в холоде: тишина была бы слышна как «звук выключен».
  v.bodyGain.gain.setTargetAtTime(0.05 * target, now, tc);
  v.out.gain.setTargetAtTime(target, now, tc);
}

/**
 * Охлаждающий свист: единственный звук, который не про жар, а про его конец.
 *
 * Отдельный вызов, а не состояние голоса: перегрев случается раз в минуту, это событие, и
 * держать ради него ещё один слой в `updateThermalAudio` незачем. Шум идёт вниз по частоте,
 * как и остывает металл.
 */
export function playCoolingSound(muted: boolean): void {
  if (muted) return;
  const ctx = getSharedContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 3.5;
  // Падение сверху вниз за 0.9 с — и есть остывание, выраженное одной нотой.
  filter.frequency.setValueAtTime(3800, now);
  filter.frequency.exponentialRampToValueAtTime(240, now + 0.9);
  const gain = ctx.createGain();
  // Начало с нуля и разгон 4 мс обязательны: без них щелчок в начале хуже, чем сам свист.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.16, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.92);
}

/**
 * Галлюцинация: короткий сдвиг тона вниз с возвратом.
 *
 * Не тревожный сигнал, а именно «сбой»: игра не ругает игрока за жар, она показывает, что
 * горячо. Поэтому это нисходящая терция на синусоиде, а не писк.
 */
export function playHallucinationSound(muted: boolean): void {
  if (muted) return;
  const ctx = getSharedContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.22);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.13, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.25);
}

/**
 * Контекст, доступный обоим модулям.
 *
 * Один контекст на игру обязателен: два `AudioContext` означают два независимых
 * системных приоритета, и звуки из разных модулей догоняли бы друг друга по задержке.
 * Владеет им `sound.ts`, а здесь только читается — иначе возник бы цикл импортов, а
 * цикл импортов означал бы, что у звука два хозяина.
 */
import { audioContext } from './sound';

const getSharedContext = audioContext;