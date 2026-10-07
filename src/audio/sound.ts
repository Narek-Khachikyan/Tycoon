/**
 * 8-битный звуковой синтезатор на Web Audio API.
 *
 * Звук синтезируется целиком: ни mp3, ни wav, ни лицензии на них. Источники одноразовые — каждый
 * эффект держит свой осциллятор, огибающую «экспонента в 0.001» и уходит.
 *
 * Громкость игрока — одна мастер-шина: на неё подключается каждый источник, поэтому ни один
 * эффект не может оказаться громче выбранного уровня, а мьют глушит всё разом. Музыка приходит из
 * music.ts, но контекст и граф остаются здесь: второй AudioContext на страницу браузер не даёт.
 *
 * AudioContext создаётся лениво и один на страницу. Без жеста игрока он остаётся suspended, и
 * звука нет: браузер не даёт звучать без жеста, и никакой код этого не обойдёт — это не баг. Ошибку
 * resume() глотаем, иначе каждое касание до первого клика сыпало бы в консоль unhandled rejection.
 */

export interface SoundSettings {
  muted: boolean;
  /** Громкость игрока 0..1. */
  volume: number;
}

/**
 * Мастер-громкость страницы.
 *
 * Отдельная чистая функция, потому что её результат — единственное число, на котором держится
 * тишина при мьюте, и его обязано быть видно в тесте без AudioContext.
 */
export function masterVolume(settings: SoundSettings): number {
  if (settings.muted) return 0;
  const volume = settings.volume;
  // Сохранение, сделанное до появления громкости, приезжает без этого поля: NaN в AudioParam бросил
  // бы TypeError на каждом звуке, поэтому настройка без громкости читается как полная.
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

let audioCtx: AudioContext | null = null;
let masterNode: GainNode | null = null;
let musicNode: GainNode | null = null;
/** Громкость, уже записанная в мастер: тик зовёт audioBus двадцать раз в секунду. */
let appliedVolume: number | null = null;

/**
 * Контекст игры, общий для всех модулей звука.
 *
 * Экспортируется потому, что `thermal.ts` держит непрерывный голос и обязан играть на том же
 * контексте: два контекста означают два системных приоритета и рассинхрон между модулями.
 * Побочный эффект общего контекста — общий resume, поэтому жеста пользователя хватает обоим.
 *
 * `latencyHint: 'interactive'` обязателен: значение по умолчанию на десктопе даёт задержку
 * около 20 мс плюс буфер вывода, и клик перестаёт ощущаться мгновенным. Интерактивный режим
 * просит у системы минимальный буфер, и это единственное, что можно сделать без
 * собственного аудиопотока.
 */
export function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Граф, к которому подключается всё звучание страницы. Отдаётся music.ts, который строит луп. */
export interface AudioBus {
  ctx: AudioContext;
  /** Мастер-шина игрока: на неё подключается каждый одноразовый источник. */
  master: GainNode;
  /** Музыкальная шина: её глушит дакинг под Событие, не трогая звуки. */
  musicBus: GainNode;
}

/**
 * Шина (или null, если окна/AudioContext нет) с уже применённой громкостью игрока.
 *
 * Шины создаются один раз на контекст и переживают источники: подключение на каждый клик плодило
 * бы узлы, а отключать их всё равно пришлось бы вручную. Громкость игрока живёт только здесь, на
 * мастере: источники пишут свой собственный уровень, иначе громкость применялась бы дважды.
 */
export function audioBus(settings: SoundSettings): AudioBus | null {
  const ctx = audioContext();
  if (!ctx) return null;
  const now = ctx.currentTime;
  if (!masterNode) {
    masterNode = ctx.createGain();
    masterNode.connect(ctx.destination);
  }
  const volume = masterVolume(settings);
  if (volume !== appliedVolume) {
    // Короткое сглаживание, а не скачок: мьют и ползунок двигают мастер, пока звучат гул и
    // музыка, и мгновенная ступенька щёлкала бы.
    masterNode.gain.setTargetAtTime(volume, now, 0.01);
    appliedVolume = volume;
  }
  if (!musicNode) {
    musicNode = ctx.createGain();
    // Музыки ещё нет, поэтому шина закрыта: startMusic открывает её, а лишний молчащий узел
    // ничего не слышит и не стоит ничего.
    musicNode.gain.setValueAtTime(0, now);
    musicNode.connect(masterNode);
  }
  return { ctx, master: masterNode, musicBus: musicNode };
}

/** Шина для эффекта: мьют не создаёт даже контекста, лишний звук всё равно не прозвучит. */
function effectBus(settings: SoundSettings): AudioBus | null {
  if (settings.muted) return null;
  return audioBus(settings);
}

/**
 * Шина для сигнала, который приходит из тика, а не от нажатия: только на уже звучащем контексте.
 *
 * До первого жеста контекст стоит, его время не идёт, и такие сигналы копились бы на одном
 * моменте, чтобы выстрелить пачкой на первом касании. Сигнал от нажатия так не ограничен: само
 * нажатие и будит контекст.
 */
export function runningBus(settings: SoundSettings): AudioBus | null {
  const bus = effectBus(settings);
  return bus && bus.ctx.state === 'running' ? bus : null;
}

/**
 * Антитрещотка Кликов.
 *
 * Игрок, который молотит по кнопке, даёт до восьми звуков в секунду: на прежней фиксированной
 * громкости это уже не отклик, а треск. Поэтому одиночный Клик тише прежнего (0.08 → 0.045), а чем
 * короче пауза до следующего, тем тише он звучит — вплоть до CLICK_MIN_LEVEL: чем чаще жмёшь, тем
 * меньше шума на кнопку. Полного молчания нет намеренно: клик без звука читается как сломанная
 * кнопка, поэтому тихий пол всё равно слышен.
 *
 * Счётчик живёт на модуле, а не в состоянии игры: он отвечает на «как давно был клик», а не на
 * состояние забега, и в сейв ему не место. Отдельного интервала нет и здесь — окно считается по
 * времени предыдущего клика, тем же приёмом, что lastTemplateIndex в сторе.
 */
const CLICK_STREAK_WINDOW_MS = 250;
const CLICK_LEVEL = 0.045;
const CLICK_MIN_LEVEL = 0.012;
let lastClickAt = 0;

/**
 * Громкость Клика по паузе до предыдущего: чем меньше пауза, тем тише клик.
 *
 * Чистая функция: правило антитрещотки проверяется тестом без AudioContext и без часов.
 */
export function clickVolumeForStreak(streakMs: number): number {
  if (Number.isNaN(streakMs)) return CLICK_LEVEL;
  const t = Math.min(1, Math.max(0, streakMs / CLICK_STREAK_WINDOW_MS));
  return CLICK_MIN_LEVEL + (CLICK_LEVEL - CLICK_MIN_LEVEL) * t;
}

/**
 * Голос синтезатора: осциллятор, экспоненциальная огибающая в 0.001 и, по желанию, фильтр.
 *
 * Голос — единственное место, где живёт правило огибающей: и одноразовые эффекты, и ноты лупа из
 * music.ts собираются через него, поэтому «экспонента в 0.001» не может разъехаться по файлам.
 * Все времена — в секундах AudioContext.
 */
export interface Voice {
  ctx: AudioContext;
  /** Куда подключать: мастер-шина эффекта или музыкальная шина лупа. */
  out: AudioNode;
  wave: OscillatorType;
  /** Точки частоты: первая звучит с начала, остальные — в указанное время. Одна точка = ровный тон. */
  freq: readonly (readonly [at: number, hz: number])[];
  start: number;
  /** Длина огибающей: столько же живёт осциллятор. */
  dur: number;
  level: number;
  /** Соединять соседние точки частоты экспонентой. false — ступенчато, как у покупки. */
  glide?: boolean;
  filter?: { type: BiquadFilterType; freq: number; freqTo?: number; q: number };
}

export function playVoice(t: Voice): void {
  const osc = t.ctx.createOscillator();
  const gain = t.ctx.createGain();

  osc.type = t.wave;
  osc.frequency.setValueAtTime(t.freq[0][1], t.start);
  for (let i = 1; i < t.freq.length; i += 1) {
    const [at, hz] = t.freq[i];
    if (t.glide === false) osc.frequency.setValueAtTime(hz, t.start + at);
    else osc.frequency.exponentialRampToValueAtTime(hz, t.start + at);
  }
  gain.gain.setValueAtTime(t.level, t.start);
  gain.gain.exponentialRampToValueAtTime(0.001, t.start + t.dur);

  osc.connect(gain);
  let tail: AudioNode = gain;
  if (t.filter) {
    const filter = t.ctx.createBiquadFilter();
    filter.type = t.filter.type;
    filter.Q.value = t.filter.q;
    filter.frequency.setValueAtTime(t.filter.freq, t.start);
    if (t.filter.freqTo) filter.frequency.exponentialRampToValueAtTime(t.filter.freqTo, t.start + t.dur);
    gain.connect(filter);
    tail = filter;
  }
  tail.connect(t.out);

  osc.start(t.start);
  osc.stop(t.start + t.dur);
}

/** Две секунды белого шума: из него делаются удары, шипение и гул Температуры. */
const NOISE_SEC = 2;
let noise: AudioBuffer | null = null;

/**
 * Буфер шума, один на страницу.
 *
 * Шум всегда один и тот же, поэтому одноразовые удары начинают его со случайного сдвига: иначе
 * два удара подряд звучали бы как два одинаковых сэмпла.
 */
export function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * NOISE_SEC), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

interface Noise {
  ctx: AudioContext;
  out: AudioNode;
  start: number;
  dur: number;
  level: number;
  filter: { type: BiquadFilterType; freq: number; freqTo?: number; q: number };
}

function playNoise(n: Noise): void {
  const src = n.ctx.createBufferSource();
  const filter = n.ctx.createBiquadFilter();
  const gain = n.ctx.createGain();

  src.buffer = noiseBuffer(n.ctx);
  filter.type = n.filter.type;
  filter.Q.value = n.filter.q;
  filter.frequency.setValueAtTime(n.filter.freq, n.start);
  if (n.filter.freqTo) filter.frequency.exponentialRampToValueAtTime(n.filter.freqTo, n.start + n.dur);
  gain.gain.setValueAtTime(n.level, n.start);
  gain.gain.exponentialRampToValueAtTime(0.001, n.start + n.dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(n.out);

  src.start(n.start, Math.random() * Math.max(0, NOISE_SEC - n.dur), n.dur);
  src.stop(n.start + n.dur);
}

/** Клик: короткий взлёт 320→740 Гц. Громкость — по антитрещотке, паузе до предыдущего клика. */
export function playClickSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = Date.now();
  const level = clickVolumeForStreak(now - lastClickAt);
  lastClickAt = now;

  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'square',
    freq: [[0, 320], [0.05, 740]],
    start: bus.ctx.currentTime,
    dur: 0.05,
    level,
  });
}

/** Покупка: треугольник, две ноты через 50 мс — подтверждение без праздника. */
export function playBuySound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'triangle',
    freq: [[0, 440], [0.05, 659.25]],
    glide: false,
    start: now,
    dur: 0.12,
    level: 0.12,
  });
}

/** Апгрейд: восходящее арпеджио C5–E5–G5–C6 треугольником. */
export function playUpgradeSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

  notes.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.master,
      wave: 'triangle',
      freq: [[0, freq]],
      start: now + idx * 0.04,
      dur: 0.09,
      level: 0.1,
    });
  });
}

/**
 * Престиж: свип снизу вверх плюс арпеджио-мост.
 *
 * Второй слой нужен, потому что свип умирал на 0.4 с, а оверлей живёт 2.6 с, и хвост оставался
 * немым. Мажорный треугольник вместо квадратного минора Достижения — чтобы два торжества не
 * звучали одинаково.
 */
export function playPrestigeSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'sawtooth',
    freq: [[0, 150], [0.35, 1200]],
    start: now,
    dur: 0.4,
    level: 0.15,
  });

  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.master,
      wave: 'triangle',
      freq: [[0, freq]],
      start: now + 0.35 + idx * 0.13,
      dur: 0.2,
      level: 0.1,
    });
  });
}

/** Достижение: восходящее арпеджио A4–C#5–E5–A5 квадратом — минор, в отличие от Престижа. */
export function playAchievementSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5

  notes.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.master,
      wave: 'square',
      freq: [[0, freq]],
      start: now + idx * 0.07,
      dur: 0.14,
      level: 0.08,
    });
  });
}

/**
 * Сигнал, что появилось Событие.
 *
 * Отдельный тембр, а не ещё один вызов playUpgradeSound: этот сигнал игрок обязан узнать на слух
 * из соседней вкладки, а привычка «звук = покупка» сбила бы его с толку. Ноты E5–B5–E6 идут
 * квартой вверх и квинтой — такой ход не совпадает ни с арпеджио Апгрейда, ни с треугольником
 * покупки, поэтому сигнал узнаётся, а не путается.
 *
 * Жест игрока здесь тот же, что у всех остальных звуков: `getAudioContext` сам пробует resume,
 * и если AudioContext остался suspended, сигнал просто не прозвучит. Это не баг, который надо
 * чинить: браузер не даёт звучать без жеста, и никакой код этого не обойдёт.
 */
export function playEventAlertSound(settings: SoundSettings): void {
  const bus = runningBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  // E5, B5, E6: последняя нота тянется вдвое дольше предыдущих — окно короткое, и хвост нужен,
  // чтобы сигнал не оборвался на полуфразе.
  [659.25, 987.77, 1318.51].forEach((freq, idx) => {
    const hold = idx === 2 ? 0.22 : 0.07;
    playVoice({
      ctx: bus.ctx,
      out: bus.master,
      wave: 'square',
      freq: [[0, freq]],
      start: now + idx * 0.06,
      dur: hold,
      level: 0.09,
    });
  });
}

/** Отказ по недоступной покупке: низкий короткий buzz, а не высокий тик — высокий тик совпал бы по
 *  тембру с покупкой и читался бы как подтверждение, а не как отказ. */
export function playDenySound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;

  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'square',
    freq: [[0, 140], [0.12, 90]],
    start: bus.ctx.currentTime,
    dur: 0.12,
    level: 0.1,
  });
}

/**
 * Стрекот печатной машинки поверх реплики говорящей Модели.
 *
 * Шесть коротких square-блёсток через 35 мс: печатка стучит очередью, а не нотой, поэтому
 * частот шесть и все высокие (1.7–2.6 кГц) — ни одна не совпадает с тембрами покупки,
 * Апгрейда и Достижения. Gain 0.05 вдвое тише одиночного Клика: стрекот идёт поверх него на том же
 * нажатии и не должен его перекрикивать. Как остальные: при muted молчит, а при
 * suspended AudioContext просто не звучит — жеста не было, и это не баг.
 */
export function playQuipSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const ticks = [2100, 1700, 2400, 1900, 2600, 2200];

  ticks.forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.master,
      wave: 'square',
      freq: [[0, freq]],
      start: now + idx * 0.035,
      dur: 0.03,
      level: 0.05,
    });
  });
}

/**
 * Удар по Глюку: глухой шлепок по мягкому паразиту.
 *
 * Удар и лопание слышатся попарно, поэтому разводить их приходится по трём осям сразу: удар —
 * полосатый шум плюс низкий triangle (тук), лопание — короткий квадратный «хлоп» и россыпь
 * верхних нот. И то и другое глуше отказа по покупке, но отличается от него тембром: здесь шум,
 * а не квадратный писк.
 */
export function playGlitchHitSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playNoise({
    ctx: bus.ctx,
    out: bus.master,
    start: now,
    dur: 0.06,
    level: 0.05,
    filter: { type: 'bandpass', freq: 1900, q: 1.2 },
  });
  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'triangle',
    freq: [[0, 210], [0.07, 90]],
    start: now,
    dur: 0.07,
    level: 0.05,
  });
}

/**
 * Лопание Глюка: хлоп с россыпью. От удара отличается всем — выше по регистру, длиннее, с хвостом из
 * верхних бликов, поэтому лопнувший паразит слышен и в соседней вкладке, а удары по нему остаются
 * локальной отметкой.
 */
export function playGlitchPopSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'square',
    freq: [[0, 760], [0.09, 170]],
    start: now,
    dur: 0.09,
    level: 0.1,
  });
  playNoise({
    ctx: bus.ctx,
    out: bus.master,
    start: now,
    dur: 0.08,
    level: 0.04,
    filter: { type: 'highpass', freq: 2500, q: 0.7 },
  });
  [1400, 2000, 2600, 2200, 3000].forEach((freq, idx) => {
    playVoice({
      ctx: bus.ctx,
      out: bus.master,
      wave: 'sine',
      freq: [[0, freq]],
      start: now + 0.06 + idx * 0.035,
      dur: 0.05,
      level: 0.05,
    });
  });
}

/**
 * Крах: красное Событие отнимает Токены, поэтому оно должно звучать тревожнее любой находки.
 *
 * Расходящийся вниз двойной пилообразный свип с расстроенной парой (интервал около четверти тона)
 * и закрывающимся фильтром: расстройка даёт биения и не отпускает ухо, падение вниз читается как
 * потеря, а низкая полка фильтра убирает из звука игривость обычного События. Длина 0.55 с —
 * вдвое больше любого короткого сигнала, чтобы тревога успела отзвучать вместе с экраном.
 */
export function playCrashSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'sawtooth',
    freq: [[0, 330], [0.5, 75]],
    start: now,
    dur: 0.5,
    level: 0.06,
    filter: { type: 'lowpass', freq: 900, freqTo: 260, q: 0.9 },
  });
  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'sawtooth',
    freq: [[0, 345], [0.5, 79]],
    start: now,
    dur: 0.5,
    level: 0.06,
    filter: { type: 'lowpass', freq: 900, freqTo: 260, q: 0.9 },
  });
  playNoise({
    ctx: bus.ctx,
    out: bus.master,
    start: now,
    dur: 0.3,
    level: 0.06,
    filter: { type: 'lowpass', freq: 420, q: 0.7 },
  });
}

/**
 * Финал контента: восходящая пентатоника с долгой последней нотой.
 *
 * Финал не должен звучать как Престиж или Достижение: там короткое торжество, здесь — точка.
 * Поэтому арпеджио длиннее и выше (до E6), а последняя нота тянется втрое дольше прочих и
 * продублирована квинтой — так короткое окно экрана ещё звучит, когда его уже закрыли.
 */
export function playFinaleSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 880, 1046.5, 1318.51]; // C5, E5, G5, A5, C6, E6

  notes.forEach((freq, idx) => {
    const last = idx === notes.length - 1;
    playVoice({
      ctx: bus.ctx,
      out: bus.master,
      wave: 'triangle',
      freq: [[0, freq]],
      start: now + idx * 0.1,
      dur: last ? 0.5 : 0.16,
      level: 0.1,
    });
  });
  // Квинта под последней нотой (A5 под E6) держит звук на месте, когда игрок уже закрыл окно.
  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'sine',
    freq: [[0, 880]],
    start: now + 0.6,
    dur: 0.5,
    level: 0.06,
  });
}

/**
 * Рестарт: всё, что набежало, стёрто.
 *
 * Свип вниз сквозь закрывающийся фильтр и низкий подвал под ним. От отказа (140→90 Гц) отличается
 * регистром и длиной, от Краха — ровностью: у рестарта нет расстроенной пары, потому что это не
 * потеря, а осознанный возврат к нулю.
 */
export function playRestartSound(settings: SoundSettings): void {
  const bus = effectBus(settings);
  if (!bus) return;
  const now = bus.ctx.currentTime;

  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'square',
    freq: [[0, 520], [0.2, 160]],
    start: now,
    dur: 0.2,
    level: 0.09,
    filter: { type: 'lowpass', freq: 1800, freqTo: 500, q: 0.9 },
  });
  playVoice({
    ctx: bus.ctx,
    out: bus.master,
    wave: 'sine',
    freq: [[0, 130], [0.22, 70]],
    start: now + 0.16,
    dur: 0.22,
    level: 0.07,
  });
}