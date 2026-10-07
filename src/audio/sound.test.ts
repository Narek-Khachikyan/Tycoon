/**
 * Проверки решений аудио-слоя.
 *
 * WebAudio в тестах не создаётся: вместо него стоит подделка, которая записывает всё расписание
 * параметров и топологию подключений. Этого хватает, чтобы проверить решения, а не звук: громкость
 * доходит до мастер-шины, мьют молчит, клик глохнет при частом нажатии, а луп останавливается.
 *
 * Реального звука здесь быть не может и не нужно — на что звучит синтез, решают уши, а что решение
 * принято верно, решают числа.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  audioBus,
  clickVolumeForStreak,
  masterVolume,
  playAchievementSound,
  playBuySound,
  playClickSound,
  playCrashSound,
  playDenySound,
  playEventAlertSound,
  playFinaleSound,
  playGlitchHitSound,
  playGlitchPopSound,
  playPrestigeSound,
  playQuipSound,
  playRestartSound,
  playUpgradeSound,
  setAudioHidden,
  type SoundSettings,
} from './sound';
import {
  calcArpFrequency,
  calcBaseFrequency,
  calcBassFrequency,
  calcMusicBpm,
  calcMusicLayers,
  calcStepSeconds,
  calcTransposition,
  duckMusic,
  isMusicPlaying,
  planSteps,
  startMusic,
  stopMusic,
  updateMusic,
  type MusicParams,
} from './music';
import { playMilestoneSound, playPrestigeConfirmSound, playToggleSound, SFX_PEAK_CEILING } from './sfx';
import { playCoolingSound, playHallucinationSound, updateThermalAudio } from './thermal';

const T0 = 1_700_000_000_000;
const SETTINGS: SoundSettings = { muted: false, volume: 0.8, musicVolume: 1, sfxVolume: 1 };

// ---------- Подделка Web Audio ----------

interface ParamPoint {
  at: number;
  value: number;
}

class FakeParam {
  value: number;
  readonly points: ParamPoint[] = [];
  constructor(initial: number) {
    this.value = initial;
  }
  setValueAtTime(value: number, at: number): this {
    this.points.push({ at, value });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, at: number): this {
    this.points.push({ at, value });
    this.value = value;
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number): this {
    // Настоящий AudioParam бросает TypeError на ноль и на отрицательное: подделка повторяет это,
    // чтобы огибающая, дошедшая до нуля экспонентой, ломала тест, а не игнорировалась.
    if (!(value > 0)) throw new TypeError('экспоненциальная огибающая требует положительного значения');
    this.points.push({ at, value });
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number, at: number): this {
    this.points.push({ at, value });
    this.value = value;
    return this;
  }
  cancelScheduledValues(at: number): this {
    const keep = this.points.filter((p) => p.at < at);
    this.points.length = 0;
    this.points.push(...keep);
    return this;
  }
  /** Пик за всё расписание: им ловится громкость узла. */
  get peak(): number {
    return this.points.reduce((max, p) => Math.max(max, p.value), 0);
  }
}

class FakeNode {
  readonly connected: FakeNode[] = [];
  connect(target: FakeNode): FakeNode {
    this.connected.push(target);
    return target;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  start(at: number): void {
    this.starts.push(at);
  }
  stop(at: number): void {
    this.stops.push(at);
  }
}

class FakeBiquadFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = { value: 1 };
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  readonly stops: number[] = [];
  start(): void {}
  stop(at: number): void {
    this.stops.push(at);
  }
}

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = 'running';
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  /** Все осцилляторы за жизнь файла: голос Температуры заводится один раз и чистку не переживает. */
  readonly everOscillators: FakeOscillator[] = [];
  readonly filters: FakeBiquadFilter[] = [];
  readonly noise: FakeBufferSource[] = [];
  resumes = 0;

  resume(): Promise<void> {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    this.everOscillators.push(node);
    return node;
  }
  createBiquadFilter(): FakeBiquadFilter {
    const node = new FakeBiquadFilter();
    this.filters.push(node);
    return node;
  }
  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.noise.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number, sampleRate: number): unknown {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i += 1) data[i] = Math.sin(i);
    return { length, sampleRate, getChannelData: () => data };
  }
  /** Чистка только источников: шины создаются один раз и живут до конца файла тестов. */
  clearSources(): void {
    this.oscillators.length = 0;
    this.noise.length = 0;
  }
}

const ctx = new FakeAudioContext();
/** Сколько раз звуковой модуль создавал AudioContext: нужен тесту «скрытие не будит звук». */
let contextsBuilt = 0;

/** Мастер-шина создаётся первой, музыкальная — сразу за ней: порядок в audioBus фиксирован. */
const masterNode = (): FakeGain => ctx.gains[0];
const musicNode = (): FakeGain => ctx.gains[1];

/** Все узлы, достижимые из источника по подключениям. */
function chainFrom(source: FakeNode): FakeNode[] {
  const seen = new Set<FakeNode>([source]);
  const queue: FakeNode[] = [source];
  while (queue.length > 0) {
    const node = queue.shift() as FakeNode;
    for (const target of node.connected) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen];
}

/** Самая низкая частота, до которой доходит источник: у свипа это конец, а не начало. */
const sourceHz = (osc: FakeOscillator): number => Math.min(...osc.frequency.points.map((p) => p.value));

/** Тик шедулера: часы подделки и таймеры вилтосена идут вместе, срезками по тику. */
function advance(ms: number): void {
  let left = ms;
  while (left > 0) {
    const slice = Math.min(100, left);
    ctx.currentTime += slice / 1000;
    vi.advanceTimersByTime(slice);
    left -= slice;
  }
}

/** Часы теста идут только вперёд: иначе «длинная пауза» между кликами окажется короче прошлой. */
let clickClock = T0;

function nextClickMoment(): number {
  clickClock += 60_000;
  vi.setSystemTime(clickClock);
  return clickClock;
}

/** Клик после гарантированно длинной паузы — полный уровень, без хвоста прошлого теста. */
function clickLevel(settings: SoundSettings = SETTINGS): number {
  nextClickMoment();
  playClickSound(settings);
  return ctx.gains[ctx.gains.length - 1].gain.peak;
}

/** Пик свежего источника: у каждого эффекта и ноты своя громкость, её и ловим. */
const lastGainPeak = (): number => ctx.gains[ctx.gains.length - 1].gain.peak;

beforeAll(() => {
  // Контекст создаёт сам звуковой модуль, поэтому конструктор-подделка всегда отдаёт один и тот же
  // экземпляр: иначе тест смотрел бы в пустой объект, а звук писал бы в свой.
  vi.stubGlobal('window', {
    AudioContext: function SingleAudioContext() {
      contextsBuilt += 1;
      return ctx;
    },
  });
});
afterAll(() => {
  stopMusic();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  ctx.currentTime = 0;
  ctx.state = 'running';
  ctx.clearSources();
});
afterEach(() => {
  stopMusic();
  vi.useRealTimers();
});

// ---------- Мастер-громкость ----------

describe('громкость игрока', () => {
  it('мьут даёт тишину, громкость проходит и зажимается в 0..1', () => {
    expect(masterVolume({ muted: true, volume: 1 })).toBe(0);
    expect(masterVolume({ muted: false, volume: 0.35 })).toBeCloseTo(0.35);
    expect(masterVolume({ muted: false, volume: 4 })).toBe(1);
    expect(masterVolume({ muted: false, volume: -2 })).toBe(0);
  });

  it('настройка без громкости (старое сохранение) читается как полная, а не как NaN', () => {
    const безПоля = { muted: false } as unknown as SoundSettings;
    expect(masterVolume(безПоля)).toBe(1);
  });

  it('громкость игрока применяется один раз — на мастере, а эффект пишет свой уровень', () => {
    clickLevel({ muted: false, volume: 0.5, musicVolume: 1, sfxVolume: 1 });
    expect(masterNode().gain.points.at(-1)?.value).toBeCloseTo(0.5);
    const click = ctx.gains[ctx.gains.length - 1];
    expect(click.gain.peak).toBeCloseTo(clickVolumeForStreak(60_000));
  });

  it('при мьюте ни один источник не создаётся', () => {
    playClickSound({ muted: true, volume: 1, musicVolume: 1, sfxVolume: 1 });
    playBuySound({ muted: true, volume: 1, musicVolume: 1, sfxVolume: 1 });
    playPrestigeSound({ muted: true, volume: 1, musicVolume: 1, sfxVolume: 1 });
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('ни один источник не подключается к колонкам напрямую: всё проходит через мастер-шину', () => {
    playPrestigeSound(SETTINGS);
    playGlitchPopSound(SETTINGS);
    playMilestoneSound(SETTINGS);
    playCoolingSound(SETTINGS);
    playHallucinationSound(SETTINGS);
    updateThermalAudio(SETTINGS, { temp: 0.8, heat: 0.5 });
    startMusic(SETTINGS);
    advance(800);

    const toSpeakers = ctx.gains.filter((gain) => gain.connected.includes(ctx.destination));
    expect(toSpeakers).toEqual([masterNode()]);
    const sources: FakeNode[] = [...ctx.oscillators, ...ctx.noise];
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(chainFrom(source)).toContain(masterNode());
  });
});

// ---------- Каналы музыки и эффектов ----------

describe('громкость каналов поверх мастера', () => {
  /**
   * Во сколько раз игрок приглушает источник: произведение всех шин на его пути к колонкам.
   * Собственная огибающая голоса — первый GainNode цепочки — в счёт не идёт: это тембр, а не
   * громкость игрока. Остальное — мастер, канал и приглушение музыки.
   */
  const playerLevel = (source: FakeNode): number => {
    const [, ...shared] = chainFrom(source).filter((node): node is FakeGain => node instanceof FakeGain);
    return shared.reduce((product, bus) => product * bus.gain.value, 1);
  };

  const mix = (over: Partial<SoundSettings>): SoundSettings => ({ ...SETTINGS, ...over });

  /** Уровень игрока для каждой ноты лупа за две секунды при этих настройках. */
  const musicLevels = (settings: SoundSettings): number[] => {
    startMusic(settings);
    ctx.clearSources();
    updateMusic(music({ settings, intensity: 1, generation: 2 }));
    advance(2000);
    return ctx.oscillators.map(playerLevel);
  };

  /** Тело голоса Температуры: единственный осциллятор на 55 Гц, заданный присваиванием, а не расписанием. */
  const humBody = (): FakeOscillator => {
    const body = ctx.everOscillators.find((o) => o.frequency.value === 55 && o.frequency.points.length === 0);
    if (!body) throw new Error('голос Температуры не заведён');
    return body;
  };

  it('эффект идёт через канал эффектов: мастер и канал дают громкость ровно по разу', () => {
    nextClickMoment();
    playClickSound(mix({ volume: 0.5, sfxVolume: 0.4, musicVolume: 0.1 }));
    expect(playerLevel(ctx.oscillators[0])).toBeCloseTo(0.5 * 0.4);
  });

  it('нота лупа идёт через канал музыки: громкость эффектов её не трогает', () => {
    const levels = musicLevels(mix({ volume: 0.5, musicVolume: 0.2, sfxVolume: 0.9 }));
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) expect(level).toBeCloseTo(0.5 * 0.2);
  });

  it('голос Температуры идёт через канал эффектов, а не мимо него', () => {
    updateThermalAudio(mix({ volume: 0.8, sfxVolume: 0.5 }), { temp: 0.8, heat: 0.5 });
    expect(playerLevel(humBody())).toBeCloseTo(0.8 * 0.5);
    updateThermalAudio(mix({ volume: 0.8, sfxVolume: 0 }), { temp: 0.8, heat: 0.5 });
    expect(playerLevel(humBody())).toBe(0);
  });

  it('ноль на ползунке эффектов глушит каждый эффект, а музыку не трогает', () => {
    const silent = mix({ sfxVolume: 0, volume: 1 });
    const effects: ((s: SoundSettings) => void)[] = [
      playClickSound,
      playBuySound,
      playPrestigeSound,
      playGlitchPopSound,
      playMilestoneSound,
      playCoolingSound,
      playHallucinationSound,
    ];
    for (const play of effects) {
      ctx.clearSources();
      nextClickMoment();
      play(silent);
      const sources: FakeNode[] = [...ctx.oscillators, ...ctx.noise];
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) expect(playerLevel(source)).toBe(0);
    }

    const notes = musicLevels(silent);
    expect(notes.length).toBeGreaterThan(0);
    for (const level of notes) expect(level).toBeGreaterThan(0);
  });

  it('ноль на ползунке музыки глушит луп и не ставит молчащих нот, а эффекты звучат', () => {
    // Как мьют и ноль мастера: молчащие осцилляторы стоили бы работы и не дали бы ничего.
    expect(musicLevels(mix({ musicVolume: 0 }))).toHaveLength(0);
    expect(isMusicPlaying()).toBe(true);

    ctx.clearSources();
    nextClickMoment();
    playClickSound(mix({ musicVolume: 0, volume: 1 }));
    expect(playerLevel(ctx.oscillators[0])).toBeGreaterThan(0);
  });

  it('ползунки доходят до своих каналов: музыка слышит их с ближайшего такта, эффект — со следующего звука', () => {
    startMusic(mix({ musicVolume: 1 }));
    ctx.clearSources();
    updateMusic(music({ settings: mix({ musicVolume: 0.3 }) }));
    advance(1000);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    for (const note of ctx.oscillators) expect(playerLevel(note)).toBeCloseTo(0.8 * 0.3);

    ctx.clearSources();
    nextClickMoment();
    playClickSound(mix({ sfxVolume: 0.6 }));
    expect(playerLevel(ctx.oscillators[0])).toBeCloseTo(0.8 * 0.6);
  });

  it('мьют глушит оба канала сразу', () => {
    const muted = mix({ muted: true });
    expect(musicLevels(muted)).toHaveLength(0);
    nextClickMoment();
    playClickSound(muted);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('настройка без каналов (старое сохранение) читается как полные каналы, а не как NaN', () => {
    const legacy = { muted: false, volume: 0.5 } as unknown as SoundSettings;
    nextClickMoment();
    playClickSound(legacy);
    expect(playerLevel(ctx.oscillators[0])).toBeCloseTo(0.5);
  });

  it('значение вне 0..1 зажимается, как у мастера', () => {
    nextClickMoment();
    playClickSound(mix({ volume: 1, sfxVolume: 7 }));
    expect(playerLevel(ctx.oscillators[0])).toBe(1);
    ctx.clearSources();
    nextClickMoment();
    playClickSound(mix({ volume: 1, sfxVolume: -3 }));
    expect(playerLevel(ctx.oscillators[0])).toBe(0);
  });
});

// ---------- Фоновая вкладка ----------

describe('тишина скрытой страницы', () => {
  const masterLevel = (): number | undefined => masterNode().gain.points.at(-1)?.value;

  afterEach(() => {
    setAudioHidden(false, SETTINGS);
  });

  it('закрывает мастер-шину, пока страница скрыта, и возвращает громкость игрока, когда она видна', () => {
    playClickSound(SETTINGS);
    expect(masterLevel()).toBeCloseTo(0.8);

    setAudioHidden(true, SETTINGS);
    expect(masterLevel()).toBe(0);

    setAudioHidden(false, SETTINGS);
    expect(masterLevel()).toBeCloseTo(0.8);
  });

  it('глушит и непрерывный голос, и музыку: они идут через ту же мастер-шину', () => {
    startMusic(SETTINGS);
    updateThermalAudio(SETTINGS, { temp: 0.8, heat: 0.2 });
    setAudioHidden(true, SETTINGS);

    // Тик, пришедший из скрытой вкладки, зовёт те же функции с теми же настройками игрока:
    // он не должен открыть шину обратно.
    updateThermalAudio(SETTINGS, { temp: 0.9, heat: 0.2 });
    updateMusic(music());
    expect(masterLevel()).toBe(0);
  });

  it('не создаёт источников для эффектов, пока страница скрыта, и звучит снова после возврата', () => {
    setAudioHidden(true, SETTINGS);
    playClickSound(SETTINGS);
    playBuySound(SETTINGS);
    playAchievementSound(SETTINGS);
    playPrestigeSound(SETTINGS);
    playCoolingSound(SETTINGS);
    playHallucinationSound(SETTINGS);
    playMilestoneSound(SETTINGS);
    playToggleSound(SETTINGS);
    playPrestigeConfirmSound(SETTINGS);
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.noise).toHaveLength(0);

    setAudioHidden(false, SETTINGS);
    playBuySound(SETTINGS);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it('не отпирает то, что игрок заглушил сам: мьют переживает возвращение', () => {
    const muted: SoundSettings = { ...SETTINGS, muted: true };
    playClickSound(SETTINGS);
    setAudioHidden(true, muted);
    setAudioHidden(false, muted);
    expect(masterLevel()).toBe(0);
  });

  it('возвращается с громкостью, выставленной к моменту возврата, а не к моменту ухода', () => {
    playClickSound(SETTINGS);
    setAudioHidden(true, SETTINGS);
    setAudioHidden(false, { ...SETTINGS, volume: 0.3 });
    expect(masterLevel()).toBeCloseTo(0.3);
  });

  it('не открывается обратно от запроса шины с полной громкостью, пока страница скрыта', () => {
    playClickSound(SETTINGS);
    setAudioHidden(true, SETTINGS);
    audioBus({ ...SETTINGS, volume: 1 });
    expect(masterLevel()).toBe(0);
  });

  it('не заводит голос Температуры под скрытой страницей и заводит его после возврата', async () => {
    vi.resetModules();
    const fresh = await import('./sound');
    const thermal = await import('./thermal');
    fresh.setAudioHidden(true, SETTINGS);
    thermal.updateThermalAudio(SETTINGS, { temp: 0.5, heat: 0 });
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.noise).toHaveLength(0);

    fresh.setAudioHidden(false, SETTINGS);
    thermal.updateThermalAudio(SETTINGS, { temp: 0.5, heat: 0 });
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it('не создаёт AudioContext сама: до первого жеста звука нет, и скрытие его не будит', async () => {
    vi.resetModules();
    const fresh = await import('./sound');
    const before = contextsBuilt;
    fresh.setAudioHidden(true, SETTINGS);
    fresh.setAudioHidden(false, SETTINGS);
    expect(contextsBuilt).toBe(before);
  });
});

// ---------- Антитрещотка кликов ----------

describe('антитрещотка Кликов', () => {
  it('одиночный клик тише прежнего и громче клика в потоке', () => {
    const single = clickVolumeForStreak(1000);
    expect(single).toBeLessThan(0.08);
    expect(single).toBeGreaterThan(clickVolumeForStreak(0));
  });

  it('громкость падает монотонно, пока пауза короче 250 мс, и дальше не растёт', () => {
    const samples = [0, 50, 125, 200, 249, 250, 2500].map(clickVolumeForStreak);
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    expect(samples[0]).toBeGreaterThan(0);
    expect(samples.at(-1)).toBeCloseTo(samples[4]);
  });

  it('быстрые нажатия глушат клик, редкие оставляют полный', () => {
    const first = clickLevel();
    vi.setSystemTime(clickClock + 40);
    playClickSound(SETTINGS);
    const second = lastGainPeak();
    vi.setSystemTime(clickClock + 900);
    playClickSound(SETTINGS);
    const third = lastGainPeak();

    expect(second).toBeLessThan(first);
    expect(third).toBeGreaterThan(second);
    expect(third).toBeCloseTo(first);
  });
});

// ---------- Тембры ----------

describe('звуки значимых действий', () => {
  const everySound: [string, (settings: SoundSettings) => void][] = [
    ['клик', playClickSound],
    ['покупка', playBuySound],
    ['апгрейд', playUpgradeSound],
    ['достижение', playAchievementSound],
    ['престиж', playPrestigeSound],
    ['событие', playEventAlertSound],
    ['отказ', playDenySound],
    ['реплика', playQuipSound],
    ['удар по глюку', playGlitchHitSound],
    ['лопание глюка', playGlitchPopSound],
    ['крах', playCrashSound],
    ['финал', playFinaleSound],
    ['рестарт', playRestartSound],
  ];

  it.each(everySound)('%s звучит хоть что-то и укладывается в короткое окно', (_name, play) => {
    nextClickMoment();
    play(SETTINGS);
    const started = ctx.oscillators.length + ctx.noise.length;
    expect(started).toBeGreaterThan(0);
    // Окно считается по последнему «стоп» источника: так проверяется длительность звука целиком,
    // а не только то, что он начался сразу.
    const ends = [...ctx.oscillators.map((o) => o.stops[o.stops.length - 1] ?? 0), ...ctx.noise.map((n) => n.stops[0] ?? 0)];
    expect(Math.max(...ends)).toBeLessThan(1.2);
  });

  it('лопание Глюка отчётливее удара: больше источников и живёт дольше', () => {
    nextClickMoment();
    playGlitchHitSound(SETTINGS);
    const hitSounds = ctx.oscillators.length + ctx.noise.length;
    const hitEnd = ctx.oscillators[0].stops[0];
    ctx.clearSources();
    nextClickMoment();
    playGlitchPopSound(SETTINGS);
    const popSounds = ctx.oscillators.length + ctx.noise.length;
    const popEnd = Math.max(
      ...ctx.oscillators.map((o) => o.stops[o.stops.length - 1] ?? 0),
      ...ctx.noise.map((n) => n.stops[0] ?? 0),
    );

    expect(popSounds).toBeGreaterThan(hitSounds);
    expect(popEnd).toBeGreaterThan(hitEnd);
  });

  it('Крах тревожнее отказа: длиннее и ниже', () => {
    nextClickMoment();
    playDenySound(SETTINGS);
    const denyEnd = ctx.oscillators[0].stops[0];
    ctx.clearSources();
    nextClickMoment();
    playCrashSound(SETTINGS);
    const crashLowest = Math.min(...ctx.oscillators.map(sourceHz));

    expect(denyEnd).toBeLessThan(0.2);
    expect(crashLowest).toBeLessThan(100);
  });
});

// ---------- Формулы музыки ----------

/** Параметры музыки на тике: всё по умолчанию, кроме переданного. */
const music = (over: Partial<MusicParams> = {}): MusicParams => ({
  settings: SETTINGS,
  intensity: 0.5,
  temp01: 0.5,
  generation: 0,
  ...over,
});

describe('темп и транспозиция', () => {
  it('темп идёт от 90 к 120 BPM по Температуре и зажимается в границы', () => {
    expect(calcMusicBpm(0)).toBe(90);
    expect(calcMusicBpm(1)).toBe(120);
    expect(calcMusicBpm(0.5)).toBe(105);
    expect(calcMusicBpm(-1)).toBe(90);
    expect(calcMusicBpm(9)).toBe(120);
    expect(calcMusicBpm(Number.NaN)).toBe(90);
  });

  it('шестнадцатая длится 1/6 с на 90 BPM и 1/8 с на 120', () => {
    expect(calcStepSeconds(90)).toBeCloseTo(1 / 6);
    expect(calcStepSeconds(120)).toBeCloseTo(1 / 8);
  });

  it('каждое Поколение поднимает луп на два полутона, начиная со второго', () => {
    // Индекс Поколения с нуля — тот же, что в состоянии игры.
    expect(calcTransposition(0)).toBe(0);
    expect(calcTransposition(1)).toBe(2);
    expect(calcTransposition(2)).toBe(4);
    expect(calcTransposition(7)).toBe(14);
    expect(calcTransposition(-3)).toBe(0);
    expect(calcTransposition(999)).toBe(14);
    expect(calcBaseFrequency(2)).toBeCloseTo(calcBaseFrequency(0) * 2 ** (4 / 12));
  });

  it('каждая нота третьего Поколения выше своей ноты в первом ровно на четыре полутона', () => {
    for (let step = 0; step < 64; step += 1) {
      expect(calcArpFrequency(step, 2)).toBeCloseTo(calcArpFrequency(step, 0) * 2 ** (4 / 12));
      const bass = calcBassFrequency(step, 2);
      const base = calcBassFrequency(step, 0);
      if (bass !== null && base !== null) expect(bass).toBeCloseTo(base * 2 ** (4 / 12));
    }
  });
});

describe('пентатоника', () => {
  /** Расстояние между нотами в полутонах, 1 — полутон, 6 — тритон. */
  const semitonesBetween = (a: number, b: number): number => {
    const pc = (hz: number) => ((Math.round(12 * Math.log2(hz / calcBaseFrequency(0))) % 12) + 12) % 12;
    const diff = Math.abs(pc(a) - pc(b));
    return Math.min(diff, 12 - diff);
  };

  it('арпеджио не строит полутонов — фальшить нечем', () => {
    for (let bar = 0; bar < 8; bar += 1) {
      const notes: number[] = [];
      for (let step = 0; step < 16; step += 1) notes.push(calcArpFrequency(bar * 16 + step, 0));
      for (const a of notes) for (const b of notes) expect(semitonesBetween(a, b)).not.toBe(1);
    }
  });

  it('бас молчит на всех шагах, кроме четырёх ударов в такте', () => {
    const notes = Array.from({ length: 16 }, (_, step) => calcBassFrequency(step, 0));
    expect(notes.map((hz) => hz !== null)).toEqual([true, false, false, false, false, false, true, false, true, false, false, false, false, false, true, false]);
  });

  it('бас лежит под арпеджио и не выше квинты над своим корнем', () => {
    for (let step = 0; step < 32; step += 1) {
      const bass = calcBassFrequency(step, 7);
      if (bass === null) continue;
      expect(bass).toBeLessThan(calcArpFrequency(step, 7));
      expect(bass).toBeLessThanOrEqual(calcBaseFrequency(7) * 2 ** (7 / 12));
      expect(bass).toBeLessThan(250);
    }
  });
});

describe('слои музыки', () => {
  it('в первом Поколении на малой интенсивности играет только бас', () => {
    const layers = calcMusicLayers(0, 0);
    expect(layers.bass).toBeGreaterThan(0);
    expect(layers.arp).toBe(0);
  });

  it('интенсивность добавляет арпеджио и прибавляет басу', () => {
    const early = calcMusicLayers(0.2, 0);
    const late = calcMusicLayers(1, 0);
    expect(late.arp).toBeGreaterThan(early.arp);
    expect(late.bass).toBeGreaterThan(early.bass);
  });

  it('с третьего Поколения арпеджио есть даже на нулевом Доходе', () => {
    expect(calcMusicLayers(0, 2).arp).toBeGreaterThan(0);
    expect(calcMusicLayers(0, 1).arp).toBe(0);
  });

  it('играет под эффектами: оба слоя вместе не громче потолка одного сигнала', () => {
    for (let g = 0; g < 8; g += 1) {
      const { bass, arp } = calcMusicLayers(1, g);
      expect(bass + arp).toBeLessThanOrEqual(SFX_PEAK_CEILING);
    }
  });
});

// ---------- Шедулер ----------

describe('планирование нот', () => {
  it('не выходит за горизонт и держит интервал шестнадцатой', () => {
    const { next, times } = planSteps({ step: 0, time: 0.05 }, 0.1, 90, 0.2);
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time).toBeLessThanOrEqual(0.1 + 0.2 + 1e-9);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeCloseTo(1 / 6);
    expect(next.time - (times.at(-1) ?? 0)).toBeCloseTo(1 / 6);
  });

  it('пропущенное время не возвращается пачкой: музыка продолжается с текущего момента', () => {
    const { next, times } = planSteps({ step: 0, time: 0.05 }, 12, 90, 0.2);
    expect(times.every((time) => time >= 12)).toBe(true);
    expect(times.length).toBeLessThan(3);
    expect(next.step).toBeGreaterThan(60);
  });
});

// ---------- Жизненный цикл лупа ----------

describe('музыкальный луп', () => {
  /** Сколько нот луп поставит за `ms` при этих параметрах. */
  const notesOver = (ms: number, over: Partial<MusicParams> = {}): number[] => {
    ctx.clearSources();
    updateMusic(music(over));
    advance(ms);
    return ctx.oscillators.flatMap((o) => o.starts);
  };

  it('стартует, планирует ноты только в пределах горизонта и останавливается', () => {
    expect(isMusicPlaying()).toBe(false);
    startMusic(SETTINGS);
    expect(isMusicPlaying()).toBe(true);
    expect(ctx.oscillators).toHaveLength(0);

    advance(1600);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    for (const osc of ctx.oscillators) {
      for (const at of osc.starts) expect(at).toBeLessThanOrEqual(ctx.currentTime + 0.2 + 1e-9);
    }

    stopMusic();
    expect(isMusicPlaying()).toBe(false);
    const before = ctx.oscillators.length;
    advance(2000);
    expect(ctx.oscillators.length).toBe(before);
  });

  it('повторный startMusic не удваивает ноты', () => {
    startMusic(SETTINGS);
    const once = notesOver(2000).length;
    startMusic(SETTINGS);
    startMusic(SETTINGS);
    // Фаза такта сдвигается на ноту туда-сюда; второй луп удвоил бы счёт.
    expect(notesOver(2000).length).toBeLessThan(once * 1.5);
  });

  it('остановка незапущенного лупа и повторная остановка ничего не делают', () => {
    stopMusic();
    startMusic(SETTINGS);
    stopMusic();
    expect(() => stopMusic()).not.toThrow();
    expect(isMusicPlaying()).toBe(false);
  });

  it('музыка не играет, пока AudioContext suspended: жеста ещё не было', () => {
    startMusic(SETTINGS);
    ctx.state = 'suspended';
    advance(1600);
    expect(ctx.oscillators).toHaveLength(0);

    // Первое озвученное касание оживляет контекст, и луп оживает сам.
    ctx.state = 'running';
    advance(1600);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
  });

  it('жар разгоняет луп: на краю шкалы нот за то же время больше, чем в холоде', () => {
    startMusic(SETTINGS);
    const cold = notesOver(4000, { temp01: 0 }).length;
    const hot = notesOver(4000, { temp01: 1 }).length;
    expect(hot).toBeGreaterThan(cold);
  });

  it('третье Поколение звучит иначе, чем первое: слой сверху и выше на четыре полутона', () => {
    startMusic(SETTINGS);
    updateMusic(music({ intensity: 0, generation: 0 }));
    advance(2000);
    const firstGen = ctx.oscillators.map(sourceHz);
    stopMusic();
    ctx.clearSources();

    startMusic(SETTINGS);
    updateMusic(music({ intensity: 0, generation: 2 }));
    advance(2000);
    const thirdGen = ctx.oscillators.map(sourceHz);

    expect(thirdGen.length).toBeGreaterThan(firstGen.length);
    expect(Math.min(...thirdGen)).toBeCloseTo(Math.min(...firstGen) * 2 ** (4 / 12));
  });

  it('приглушение — короткий провал под стингер, а не постоянное состояние', () => {
    startMusic(SETTINGS);
    duckMusic();
    expect(musicNode().gain.points.at(-1)?.value).toBeCloseTo(0.3);

    advance(1000);
    updateMusic(music());
    expect(musicNode().gain.points.at(-1)?.value).toBeCloseTo(0.3);

    advance(1500);
    updateMusic(music());
    expect(musicNode().gain.points.at(-1)?.value).toBeCloseTo(1);
  });

  it('ползунок громкости и мьют доходят до мастера с ближайшего тика', () => {
    startMusic({ muted: false, volume: 0.25, musicVolume: 1, sfxVolume: 1 });
    expect(masterNode().gain.points.at(-1)?.value).toBeCloseTo(0.25);
    updateMusic(music({ settings: { muted: false, volume: 0.7, musicVolume: 1, sfxVolume: 1 } }));
    expect(masterNode().gain.points.at(-1)?.value).toBeCloseTo(0.7);
    updateMusic(music({ settings: { muted: true, volume: 0.7, musicVolume: 1, sfxVolume: 1 } }));
    expect(masterNode().gain.points.at(-1)?.value).toBe(0);
  });

  it('мьют не останавливает луп и не плодит молчащих нот, а снятие мьюта возвращает музыку', () => {
    startMusic(SETTINGS);
    expect(notesOver(2000, { settings: { muted: true, volume: 1, musicVolume: 1, sfxVolume: 1 } })).toHaveLength(0);
    expect(isMusicPlaying()).toBe(true);
    expect(notesOver(2000).length).toBeGreaterThan(0);
  });
});
