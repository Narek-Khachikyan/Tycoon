/**
 * Музыкальный луп: бас и арпеджио по пентатонике, собранные из осцилляторов.
 *
 * Пентатоника выбрана сознательно. Генеративная музыка на мажорном ладу фальшивит, а в
 * пентатонике нет ни полутонов, ни тритонов, поэтому любые две ступени звучат вместе: луп может
 * перебирать ступени по кругу сколько угодно и не промахнуться. Спектр узкий сознательно — под
 * Сценой и эффектами, а не вместо них.
 *
 * Музыка читает три числа игры, и каждое отвечает за своё:
 *   - Температура — темп: игрок тянет шкалу и сразу слышит, что офис разгоняется;
 *   - Доход — слои: арпеджио проступает по мере того, как игра «включается»;
 *   - Поколение — тональность: каждое следующее на два полутона выше.
 *
 * Шедулер — lookahead: раз в 100 мс он планирует ноты на 0.2 с вперёд, а играет их AudioContext по
 * своему часу. У лупа нет иного способа попасть в такт, потому что его события повторяются
 * бесконечно, в отличие от одноразового звука и тика на 50 мс.
 *
 * Музыка не стартует сама: пока AudioContext suspended, планировать нечего, и первое озвученное
 * касание оживит контекст, после чего луп оживёт сам.
 */
import { audioBus, channelVolume, masterVolume, playVoice, type AudioBus, type SoundSettings } from './sound';

/** Ступени пентатоники в полутонах от корня: до-мажорная пентатоника, без D и F. */
const PENTATONIC = [0, 2, 4, 7, 9] as const;

/** Корень в первом Поколении: C2 (65.4 Гц) — низ баса, под Сценой. */
const BASE_ROOT_HZ = 65.41;
/** Поколение поднимает весь луп на два полутона: к третьему это +4, и разницу слышно без сравнения. */
const SEMITONES_PER_GENERATION = 2;
/** Потолок транспозиции: восемь Поколений (индексы 0..7) — это +14 полутонов. */
const MAX_TRANSPOSITION = 14;
/** Темп по Температуре: 90 BPM в холоде, 120 на краю шкалы. */
const MIN_BPM = 90;
const MAX_BPM = 120;
/** Шестнадцатые: 16 шагов на такт, по шагу на ноту арпеджио и четыре удара баса. */
const STEPS_PER_BAR = 16;
/** Арпеджио на четыре октавы выше корня: 1.0–1.6 кГц в первом Поколении, выше баса, ниже эффектов. */
const ARP_OCTAVE_SEMITONES = 48;
/** Корни тактов по ступеням пентатоники: цикл в четыре такта, гармония не стоит на месте. */
const BAR_ROOTS = [0, 3, 1, 4];
/** Ступени арпеджио внутри такта: линия идёт вверх-вниз, чтобы не звучала как ровный пульс. */
const ARP_STEPS = [0, 2, 4, 2, 3, 4, 1, 2, 4, 3, 2, 1, 0, 2, 3, 4];
/** Бас: корень на 1-й и 3-й доли, квинта на 2-й и 4-й — ноги вразнобой, а не «тум-тум-тум-тум». */
const BASS_STEPS: readonly (readonly [at: number, degreeOffset: number])[] = [
  [0, 0],
  [6, 3],
  [8, 0],
  [14, 3],
];

/** Уровни слоёв. Музыка держится ниже эффектов: в сумме не больше потолка сигнала из sfx.ts. */
const BASS_LEVEL = 0.035;
const BASS_GROWTH = 0.02;
const ARP_LEVEL = 0.04;
/** Интенсивность, на которой арпеджио начинает проступать, и та, на которой он выходит на полную. */
const ARP_INTENSITY_FLOOR = 0.15;
const ARP_INTENSITY_CEILING = 0.75;
/**
 * С третьего Поколения (индекс 2) слой есть всегда.
 *
 * Интенсивность падает вместе с Престижем — после него Доход начинается с нуля, — и арпеджио
 * был бы слышен только у игрока с большим забегом. Порог по Поколению держит обещание: к третьему
 * Поколению музыка звучит иначе, чем в первом, сколько бы Токенов ни накопил игрок.
 */
const ARP_FROM_GENERATION = 2;
const ARP_GENERATION_LEVEL = 0.03;

/** Приглушение под стингер События и Престижа: музыка уходит в фон, но не пропадает. */
const DUCK_LEVEL = 0.3;
const DUCK_SEC = 2;
const DUCK_ATTACK = 0.05;
const DUCK_RELEASE = 0.4;

/** Период тика шедулера и горизонт планирования: заметок на тик полторы, запас есть. */
const SCHEDULER_TICK_MS = 100;
const SCHEDULE_AHEAD_SEC = 0.2;
/** Спад при остановке: уже запланированные ноты доживают тихо, вместо обрыва щелчком. */
const MUSIC_FADE_OUT_SEC = 0.08;
/** Первая нота планируется чуть позже текущего момента, чтобы луп не начинал на полуфразе. */
const MUSIC_START_DELAY_SEC = 0.05;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hzFromSemitones(rootHz: number, semitones: number): number {
  return rootHz * 2 ** (semitones / 12);
}

/** Транспозиция по индексу Поколения в полутонах: 0 в первом, +2 во втором, +4 в третьем. */
export function calcTransposition(generation: number): number {
  // Пол и потолок — страховка от чужого номера Поколения: бас не должен уехать вниз или в
  // ультразвук, потому что на обоих концах луп перестаёт быть музыкой.
  const steps = Number.isFinite(generation) ? Math.floor(generation) : 0;
  return Math.min(MAX_TRANSPOSITION, Math.max(0, steps) * SEMITONES_PER_GENERATION);
}

/** Частота корня баса в этом Поколении. */
export function calcBaseFrequency(generation: number): number {
  return hzFromSemitones(BASE_ROOT_HZ, calcTransposition(generation));
}

/** Темп по Температуре (доля шкалы 0..1): 90 → 120 BPM. */
export function calcMusicBpm(temp01: number): number {
  return MIN_BPM + (MAX_BPM - MIN_BPM) * clamp01(temp01);
}

/** Длительность шестнадцатой в секундах. */
export function calcStepSeconds(bpm: number): number {
  return 60 / Math.max(MIN_BPM, Number.isFinite(bpm) ? bpm : MIN_BPM) / 4;
}

/** Громкости слоёв: бас всегда есть, арпеджио приходит вместе с Доходом и Поколением. */
export interface MusicLayers {
  bass: number;
  arp: number;
}

export function calcMusicLayers(intensity: number, generation: number): MusicLayers {
  const fromIntensity = ARP_LEVEL * smoothstep(ARP_INTENSITY_FLOOR, ARP_INTENSITY_CEILING, clamp01(intensity));
  return {
    bass: BASS_LEVEL + BASS_GROWTH * clamp01(intensity),
    arp: generation >= ARP_FROM_GENERATION ? Math.max(fromIntensity, ARP_GENERATION_LEVEL) : fromIntensity,
  };
}

/**
 * Частота басовой ноты на шаге; null, если на этом шаге бас молчит.
 *
 * null, а не ноль: «здесь тишина» — это решение, а не число.
 */
export function calcBassFrequency(step: number, generation: number): number | null {
  const hit = BASS_STEPS.find(([at]) => at === inBarIndex(step));
  if (!hit) return null;
  const semitones = PENTATONIC[(BAR_ROOTS[barIndex(step)] + hit[1]) % PENTATONIC.length];
  return hzFromSemitones(BASE_ROOT_HZ, semitones + calcTransposition(generation));
}

/** Частота ноты арпеджио на шаге: сумма двух ступеней пентатоники, поэтому линия не фальшивит. */
export function calcArpFrequency(step: number, generation: number): number {
  const semitones =
    PENTATONIC[BAR_ROOTS[barIndex(step)]] + PENTATONIC[ARP_STEPS[inBarIndex(step)]] + ARP_OCTAVE_SEMITONES;
  return hzFromSemitones(BASE_ROOT_HZ, semitones + calcTransposition(generation));
}

function barIndex(step: number): number {
  return Math.floor(step / STEPS_PER_BAR) % BAR_ROOTS.length;
}

function inBarIndex(step: number): number {
  return ((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR;
}

/** Курсор лупа: номер шага и время AudioContext, на которое этот шаг приходится. */
export interface LoopCursor {
  step: number;
  time: number;
}

/**
 * Какие шаги надо запланировать до горизонта — решение шедулера без AudioContext.
 *
 * Пропущенное время (сон лаптопа, троттлинг скрытой вкладки) не возвращается пачкой: музыка
 * продолжается с текущего момента, а номер шага всё равно растёт, иначе гармония застревала бы на
 * месте до конца такта. Шаг, попавший в прошлое, считается сыгранным.
 */
export function planSteps(cursor: LoopCursor, now: number, bpm: number, horizon: number): { next: LoopCursor; times: number[] } {
  const stepSeconds = calcStepSeconds(bpm);
  let { step, time } = cursor;
  while (time < now) {
    time += stepSeconds;
    step += 1;
  }
  const times: number[] = [];
  while (time <= now + horizon) {
    times.push(time);
    time += stepSeconds;
    step += 1;
  }
  return { next: { step, time }, times };
}

/** Что игра сообщает музыке на каждом тике. */
export interface MusicParams {
  settings: SoundSettings;
  /** Насколько «включилась» игра: логарифм Дохода, 0..1. */
  intensity: number;
  /** Температура как доля шкалы, 0..1. */
  temp01: number;
  /** Индекс Поколения, с нуля. */
  generation: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let bus: AudioBus | null = null;
let cursor: LoopCursor = { step: 0, time: 0 };
let params: MusicParams = {
  settings: { muted: false, volume: 1, musicVolume: 1, sfxVolume: 1 },
  intensity: 0,
  temp01: 0,
  generation: 0,
};
let duckUntil = 0;
/** Куда сейчас уехала музыкальная шина: нужно, чтобы не переписывать AudioParam на каждом тике. */
let busLevel = 0;

/**
 * Запустить луп. Идемпотентна: повторный вызов не заводит второго лупа.
 *
 * Без жеста игрока музыки не слышно, но луп уже тикает: контекст suspended, его время не идёт, и
 * первое озвученное касание оживит и его.
 */
export function startMusic(settings: SoundSettings): void {
  params = { ...params, settings };
  const buses = audioBus(settings);
  if (!buses || timer !== null) return;
  bus = buses;
  duckUntil = 0;
  cursor = { step: 0, time: buses.ctx.currentTime + MUSIC_START_DELAY_SEC };
  setBusLevel(1);
  timer = setInterval(tick, SCHEDULER_TICK_MS);
}

/** Остановить луп. Повторный вызов и остановка незапущенного ничего не делают. */
export function stopMusic(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  const current = bus;
  bus = null;
  busLevel = 0;
  duckUntil = 0;
  if (!current) return;
  const now = current.ctx.currentTime;
  const level = current.musicBus.gain.value;
  current.musicBus.gain.cancelScheduledValues(now);
  current.musicBus.gain.setValueAtTime(level, now);
  current.musicBus.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_OUT_SEC);
}

/**
 * Обновить то, что музыка слышит от игры. Зовётся каждый тик.
 *
 * Настройки читаются отсюда, а не запоминаются при старте: ползунки громкости и мьют доходят до
 * мастера и канала музыки на следующем же тике, без перезапуска лупа. Мьют луп не останавливает —
 * его глушит мастер, и снятие мьюта возвращает музыку с того же такта.
 */
export function updateMusic(next: MusicParams): void {
  params = next;
  if (!bus) return;
  audioBus(next.settings);
  setBusLevel(bus.ctx.currentTime < duckUntil ? DUCK_LEVEL : 1);
}

/** Короткое приглушение: стингер События или Престижа не должен спорить с лупом. */
export function duckMusic(): void {
  if (!bus) return;
  duckUntil = bus.ctx.currentTime + DUCK_SEC;
  setBusLevel(DUCK_LEVEL);
}

/** Идёт ли луп. */
export function isMusicPlaying(): boolean {
  return timer !== null;
}

/** Громкость музыкальной шины: 1 в норме, 0.3 под приглушением. Обратный подъём медленнее падения. */
function setBusLevel(target: number): void {
  if (!bus || target === busLevel) return;
  const now = bus.ctx.currentTime;
  const ramp = target < busLevel ? DUCK_ATTACK : DUCK_RELEASE;
  bus.musicBus.gain.cancelScheduledValues(now);
  bus.musicBus.gain.setValueAtTime(bus.musicBus.gain.value, now);
  bus.musicBus.gain.linearRampToValueAtTime(target, now + ramp);
  busLevel = target;
}

/**
 * Тик шедулера: досыпать ноты до горизонта.
 *
 * Планирования нет, пока контекст suspended (его время не идёт) и пока вкладка скрыта (там
 * setInterval душится до раза в секунду, и заметки всё равно не поспевают). Без второй проверки
 * курсор отстал бы на всё это время и вернул ноты пачкой в одно касание. Под мьютом и на нулевой
 * громкости — общей или канала музыки — курсор идёт, но нот не создаёт: молчащие осцилляторы
 * стоили бы работы и не дали бы ничего.
 */
function tick(): void {
  if (!bus) return;
  // Не только suspended: Safari ставит контексту ещё и 'interrupted', и время там тоже не идёт.
  if (bus.ctx.state !== 'running') return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const { ctx, musicBus } = bus;
  const { intensity, temp01, generation, settings } = params;
  const bpm = calcMusicBpm(temp01);
  const stepSeconds = calcStepSeconds(bpm);
  const plan = planSteps(cursor, ctx.currentTime, bpm, SCHEDULE_AHEAD_SEC);
  const firstStep = plan.next.step - plan.times.length;
  cursor = plan.next;
  if (masterVolume(settings) === 0 || channelVolume(settings, 'music') === 0) return;

  const layers = calcMusicLayers(intensity, generation);
  // Фильтры открываются вместе с Доходом: на старте Забега луп — фон, к концу — собирается.
  // Квадратное арпеджио без фильтра на полной громкости режет ухо.
  const cutoff = clamp01(intensity);
  plan.times.forEach((time, idx) => {
    const step = firstStep + idx;
    const bass = calcBassFrequency(step, generation);
    if (bass !== null) {
      playVoice({
        ctx,
        out: musicBus,
        wave: 'triangle',
        freq: [[0, bass]],
        start: time,
        dur: stepSeconds * 0.9,
        level: layers.bass,
        filter: { type: 'lowpass', freq: 400 + 400 * cutoff, q: 0.7 },
      });
    }
    if (layers.arp > 0) {
      playVoice({
        ctx,
        out: musicBus,
        wave: 'square',
        freq: [[0, calcArpFrequency(step, generation)]],
        start: time,
        dur: stepSeconds * 0.8,
        level: layers.arp,
        filter: { type: 'lowpass', freq: 2000 + 800 * cutoff, q: 0.7 },
      });
    }
  });
}
