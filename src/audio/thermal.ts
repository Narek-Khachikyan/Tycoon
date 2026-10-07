/**
 * Звук Температуры.
 *
 * Отдельный модуль от `sound.ts`, потому что здесь не один вызов, а непрерывный голос:
 * короткие сигналы живут в том файле, а «температурный гул» обязан тянуться, меняться по
 * жару и сниматься остужанием.
 *
 * Голос сделан из трёх слоёв, и каждый отвечает за свою часть шкалы:
 *   - шум сквозь полосовой фильтр — «жар», слышен с середины шкалы и выше;
 *   - пила с расстроем — «нестабильность», детюнит тем сильнее, чем горячее;
 *   - низкий треугольник — «тело», всегда на месте, чтобы голос не исчезал в холоде.
 *
 * Расстройство и фильтр задаются одним числом из состояния, поэтому игрок слышит ровно ту же
 * температуру, которую видит на шкале. Всё идёт через канал эффектов `sound.ts`: громкость и мьют
 * игрока применяются там.
 */
import { audioBus, isAudioHidden, noiseBuffer, runningBus, type SoundSettings } from './sound';

/**
 * Живой голос. Держится между вызовами, поэтому `updateThermalAudio` на каждом тике ничего
 * не пересоздаёт: источники запускаются один раз, а меняются только параметры.
 *
 * Контекст входит в состояние: после `close()` старые узлы уже мёртвые, и новый контекст без
 * пересоздания голоса играл бы в никуда.
 */
let voice: {
  ctx: AudioContext;
  saw: OscillatorNode;
  sawGain: GainNode;
  noiseFilter: BiquadFilterNode;
  noiseGain: GainNode;
  bodyGain: GainNode;
} | null = null;

export interface ThermalAudioParams {
  /** Температура, [0, 1] шкалы. */
  temp: number;
  /** Перегрев, [0, 1]. */
  heat: number;
}

/**
 * Поднимает голос Температуры и держит его на нужном уровне.
 *
 * Один вызов на тик, а не событие: параметры ползучие, и пересоздавать источники каждые
 * 50 мс было бы и слышно, и дорого. `start()` вызывается ровно один раз за жизнь голоса,
 * а всё остальное — `setTargetAtTime`, который по определению плавный и не щёлкает.
 * Пока звук выключен или страница скрыта, голос не создаётся вовсе; уже созданный глушит мастер.
 */
export function updateThermalAudio(settings: SoundSettings, { temp, heat }: ThermalAudioParams): void {
  if ((settings.muted || isAudioHidden()) && !voice) return;
  const bus = audioBus(settings);
  if (!bus) return;
  const { ctx, sfx } = bus;
  if (!voice || voice.ctx !== ctx) {
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sawGain = ctx.createGain();
    sawGain.gain.value = 0;
    saw.connect(sawGain).connect(sfx);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.Q.value = 1.1;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(sfx);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = 55; // A1: ниже голоса телефона, поэтому его почти не слышно как тон
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0;
    body.connect(bodyGain).connect(sfx);

    saw.start();
    noise.start();
    body.start();

    voice = { ctx, saw, sawGain, noiseFilter, noiseGain, bodyGain };
  }

  const v = voice;
  const now = ctx.currentTime;
  const tc = 0.08;
  // Расстройка растёт от нуля в холоде до полутона с лишним в раскалённом состоянии: за этим
  // порогом ухо слышит уже не «плавающую ноту», а «не ту ноту».
  v.saw.detune.setTargetAtTime(50 * temp + 220 * heat, now, tc);
  // Частота фильтра идёт вниз с жаром: раскалённый офис звучит глуше.
  v.noiseFilter.frequency.setTargetAtTime(280 + 2200 * (1 - temp), now, tc);
  v.noiseGain.gain.setTargetAtTime(0.05 * temp, now, tc);
  v.sawGain.gain.setTargetAtTime(0.035 * temp, now, tc);
  // Тело остаётся и в холоде: тишина была бы слышна как «звук выключен».
  v.bodyGain.gain.setTargetAtTime(0.05, now, tc);
}

/**
 * Охлаждающий свист: единственный звук, который не про жар, а про его конец.
 *
 * Отдельный вызов, а не состояние голоса: перегрев — событие. Шум идёт вниз по частоте,
 * как и остывает металл. Оба сигнала Температуры приходят из тика, поэтому звучат только на
 * уже проснувшемся контексте.
 */
export function playCoolingSound(settings: SoundSettings): void {
  const bus = runningBus(settings);
  if (!bus) return;
  const { ctx, sfx } = bus;

  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 3.5;
  filter.frequency.setValueAtTime(3800, now);
  filter.frequency.exponentialRampToValueAtTime(240, now + 0.9);
  const gain = ctx.createGain();
  // Начало с нуля и разгон 4 мс обязательны: без них щелчок в начале хуже, чем сам свист.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.16, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

  src.connect(filter).connect(gain).connect(sfx);
  src.start(now);
  src.stop(now + 0.92);
}

/**
 * Галлюцинация: короткий сдвиг тона вниз.
 *
 * Не тревожный сигнал, а именно «сбой»: игра не ругает игрока за жар, она показывает, что
 * горячо. Поэтому это нисходящая кварта на синусоиде, а не писк.
 */
export function playHallucinationSound(settings: SoundSettings): void {
  const bus = runningBus(settings);
  if (!bus) return;
  const { ctx, sfx } = bus;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.22);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.13, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

  osc.connect(gain).connect(sfx);
  osc.start(now);
  osc.stop(now + 0.25);
}
