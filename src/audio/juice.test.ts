/**
 * Проверки сигналов `sfx.ts`.
 *
 * В node нет ни `AudioContext`, ни `window`, поэтому звук здесь проверяется не прослушиванием,
 * а расписанием: тест запоминает каждое движение AudioParam и каждое событие источника.
 * Это единственный способ утверждать о звуке то, что важно игроку — щелчок на старте, перегруз
 * от десяти голосов, задержку первого голоса, — не превращая проверку в «функция не упала».
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playCrystalSound, playMilestoneSound, playPrestigeConfirmSound, playToggleSound } from './sfx';
import { audioBus, type AudioBus, type SoundSettings } from './sound';

/**
 * Шина подменена целиком: `sound.ts` в node честно отдаёт `null`, и на настоящем контексте
 * проверять было бы нечего. Модуль обязан брать контекст и мастер отсюда, а не создавать свои.
 */
vi.mock('./sound', () => {
  const audioBus = vi.fn((): AudioBus | null => null);
  // Контекст подделки всегда «звучит», поэтому сигналы из тика ведут себя как от нажатия.
  return { audioBus, runningBus: vi.fn((s: SoundSettings) => (s.muted ? null : audioBus())) };
});

const ON: SoundSettings = { muted: false, volume: 1, musicVolume: 1, sfxVolume: 1 };
const MUTED: SoundSettings = { muted: true, volume: 1, musicVolume: 1, sfxVolume: 1 };

/** Момент контекста, с которого считаются все расписания: ненулевой, чтобы ошибка времени бросалась в глаза. */
const NOW = 100;

/** Рампа разгона, с. Ниже 2 мс щелчок на старте, выше 5 мс нога уже слышна как опоздание. */
const ATTACK_MIN = 0.002;
const ATTACK_MAX = 0.005;

/** Допуск на ошибку представления: расписание во времени считается вычитанием, и разность 100.002 − 100 не равна 0.002. */
const FLOAT_SLACK = 1e-6;

/**
 * Потолок пиков одного сигнала, на который он обязан укладываться.
 *
 * Мастер-шина только масштабирует сумму, поэтому единственная защита от перегруза — арифметика
 * пиков. Считается худший момент, а не сумма голосов: они гаснут
 * по очереди, и сумма голосов завышала бы требование втрое.
 */
const PEAK_CEILING = 0.1;

/** Границы разброса высоты: ±4% — верхняя кромка, при которой повтор ещё не звучит расстроенным. */
const SPREAD = 0.04;

/** Способы, которыми модуль имеет право двигать AudioParam. Присваивание `.value` в список не входит намеренно. */
type RampMethod = 'setValueAtTime' | 'linearRampToValueAtTime' | 'exponentialRampToValueAtTime';

interface Ramp {
  method: RampMethod;
  value: number;
  time: number;
}

/**
 * Заглушка AudioParam.
 *
 * Помнит и расписания, и присваивания `.value` — второе проверяется отдельно, потому что
 * присваивание на живом параметре начинает сигнал с ненулевого значения, и щелчок слышен
 * сильнее тихой ноты.
 */
class RecordedParam {
  readonly ramps: Ramp[] = [];
  readonly assigned: number[] = [];
  #current = 1;
  get value(): number {
    return this.#current;
  }
  set value(next: number) {
    this.assigned.push(next);
    this.#current = next;
  }
  setValueAtTime(value: number, time: number): this {
    this.ramps.push({ method: 'setValueAtTime', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.ramps.push({ method: 'linearRampToValueAtTime', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.ramps.push({ method: 'exponentialRampToValueAtTime', value, time });
    return this;
  }
}

class RecordedOscillator {
  type: OscillatorType = 'sine';
  readonly frequency = new RecordedParam();
  readonly detune = new RecordedParam();
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  /**
   * Все подключения, по порядку: `connect` возвращает цель, иначе цепочкой
   * `osc.connect(g).connect(out)` не собрать. Список, а не последняя цель, — иначе голос,
   * подключённый мимо огибающей прямо в destination, не виден.
   */
  readonly connections: unknown[] = [];
  connect(target: unknown): unknown {
    this.connections.push(target);
    return target;
  }
  start(time = 0): void {
    this.starts.push(time);
  }
  stop(time = 0): void {
    this.stops.push(time);
  }
}

class RecordedGain {
  readonly gain = new RecordedParam();
  readonly connections: unknown[] = [];
  connect(target: unknown): unknown {
    this.connections.push(target);
    return target;
  }
}

interface Recording {
  context: AudioContext;
  /** Канал эффектов: последняя остановка каждого голоса, дальше громкость игрока. */
  sfx: object;
  oscillators: RecordedOscillator[];
  gains: RecordedGain[];
}

/** Свежая запись на каждый сигнал: состояние между вызовами у чистого синтезатора не остаётся. */
function record(): Recording {
  const oscillators: RecordedOscillator[] = [];
  const gains: RecordedGain[] = [];
  const context = {
    currentTime: NOW,
    destination: { id: 'destination' },
    createOscillator: () => {
      const osc = new RecordedOscillator();
      oscillators.push(osc);
      return osc;
    },
    createGain: () => {
      const gain = new RecordedGain();
      gains.push(gain);
      return gain;
    },
  } as unknown as AudioContext;
  return { context, sfx: { id: 'sfx' }, oscillators, gains };
}

const use = (rec: Recording): void => {
  vi.mocked(audioBus).mockReturnValue({ ctx: rec.context, sfx: rec.sfx } as unknown as AudioBus);
};

/** Прогон сигнала без заглушения и его запись. */
const run = (play: (settings: SoundSettings) => void): Recording => {
  const rec = record();
  use(rec);
  play(ON);
  return rec;
};

/** Высоты, на которые голос реально поставлен: старт плюс цель свипа, если он есть. */
const pitches = (rec: Recording): number[] =>
  rec.oscillators.flatMap((osc) => osc.frequency.ramps.map((ramp) => ramp.value));

/** Пик голоса: линейный подъём в огибающей — это разгон, и он единственный. */
const peakOf = (gain: RecordedGain): number =>
  gain.gain.ramps.find((ramp) => ramp.method === 'linearRampToValueAtTime')?.value ?? 0;

/**
 * Громкость сигнала в худший момент.
 *
 * Сумма записанных пиков бесполезна: голоса гаснут по очереди, и их пики не совпадают.
 * Здесь огибающая каждого голоса восстанавливается по расписанию — линейный разгон и
 * экспоненциальный спад — и складывается по общей шкале времени.
 */
const simultaneousPeak = (rec: Recording): number => {
  const step = 0.0005;
  const last = Math.max(...rec.gains.map((gain) => gain.gain.ramps[gain.gain.ramps.length - 1].time));
  let worst = 0;
  for (let t = NOW; t <= last; t += step) {
    let sum = 0;
    for (const gain of rec.gains) {
      const [start, attack] = gain.gain.ramps;
      const tail = gain.gain.ramps[gain.gain.ramps.length - 1];
      const elapsed = t - start.time;
      if (elapsed < 0) continue;
      const peak = attack.value;
      if (elapsed < attack.time - start.time) sum += (peak * elapsed) / (attack.time - start.time);
      else sum += peak * Math.pow(0.001 / peak, Math.min((elapsed - (attack.time - start.time)) / (tail.time - attack.time), 1));
    }
    worst = Math.max(worst, sum);
  }
  return worst;
};

/**
 * Отпечаток сигнала: форма волны, высоты и расстройка каждого голоса.
 *
 * Это то, что игрок различает на слух. Имя сигнала в отпечаток не входит намеренно — иначе
 * проверка на неповторимые строки прошла бы и для одинаковых звуков.
 */
const fingerprint = (rec: Recording): string =>
  rec.oscillators
    .map(
      (osc) =>
        `${osc.type}@${osc.frequency.ramps.map((ramp) => ramp.value.toFixed(1)).join('>')}` +
        `[${osc.detune.ramps.map((ramp) => ramp.value).join(',')}]`,
    )
    .sort()
    .join(' | ');

/**
 * Диапазон, в котором сигнал вообще слышен.
 *
 * Проверка не про синтез, а про игрока: нота ниже 20 Гц или выше 16 кГц не слышна на типичных
 * наушниках, а такой сигнал молчал бы, оставив игрока с кнопкой, которая «не работает».
 */
const AUDIBLE = { min: 20, max: 16_000 } as const;

/** Все сигналы модуля: тест обязан знать их все, иначе пропуск нового останется незамеченным. */
const SOUNDS: readonly (readonly [string, (settings: SoundSettings) => void])[] = [
  ['playToggleSound', playToggleSound],
  ['playMilestoneSound', playMilestoneSound],
  ['playPrestigeConfirmSound', playPrestigeConfirmSound],
  ['playCrystalSound', playCrystalSound],
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mute', () => {
  it('does not create a single node for any signal', () => {
    for (const [name, play] of SOUNDS) {
      const rec = record();
      use(rec);
      play(MUTED);
      // Ни одного узла, а не «узлы есть, но с нулевой громкостью»: заглушенный звук не должен
      // даже доходить до графа, иначе десять заглушенных Кликов держали бы осцилляторы.
      expect([rec.oscillators.length, rec.gains.length], name).toEqual([0, 0]);
    }
  });
});

describe('огибающая', () => {
  it('starts every voice at exactly zero, or the quietest signal clicks before its note', () => {
    for (const [name, play] of SOUNDS) {
      const rec = run(play);
      expect(rec.gains.length, name).toBeGreaterThan(0);
      for (const gain of rec.gains) {
        const first = gain.gain.ramps[0];
        expect(first.method, name).toBe('setValueAtTime');
        expect(first.value, name).toBe(0);
      }
    }
  });

  it('never assigns .value to a live AudioParam', () => {
    for (const [name, play] of SOUNDS) {
      const rec = run(play);
      const assigned = [
        ...rec.gains.flatMap((gain) => gain.gain.assigned),
        ...rec.oscillators.flatMap((osc) => [...osc.frequency.assigned, ...osc.detune.assigned]),
      ];
      // Присваивание начинает сигнал с текущего значения параметра, то есть не с нуля.
      expect(assigned, name).toEqual([]);
    }
  });

  it('ramps up over 2–5 ms and dies into silence before the source stops', () => {
    for (const [name, play] of SOUNDS) {
      const rec = run(play);
      for (const gain of rec.gains) {
        const [, attack] = gain.gain.ramps;
        const rise = attack.time - gain.gain.ramps[0].time;
        expect(attack.method, name).toBe('linearRampToValueAtTime');
        // Допуск на вычитание: `100.002 - 100` в двоичной дроби даёт 0.001999999999995, и без
        // допуска проверка спорила бы с представлением чисел, а не с огибающей.
        expect(rise, name).toBeGreaterThanOrEqual(ATTACK_MIN - FLOAT_SLACK);
        expect(rise, name).toBeLessThanOrEqual(ATTACK_MAX + FLOAT_SLACK);
        const last = gain.gain.ramps[gain.gain.ramps.length - 1];
        expect(last.method, name).toBe('exponentialRampToValueAtTime');
        expect(last.value, name).toBeGreaterThan(0);
        // Остановка после конца огибающей: обрыв ровно в тишине слышно как щелчок, а у Вехи
        // хвост длинный. Голос и его огибающая связаны через граф, а не через
        // порядок создания: перестановка узлов не должна ломать проверку.
        const owner = rec.oscillators.filter((osc) => osc.connections.includes(gain));
        expect(owner, name).toHaveLength(1);
        expect(owner[0].stops[0], name).toBeGreaterThan(last.time);
      }
    }
  });

  it('keeps the summed peaks under the ceiling, so ten simultaneous signals cannot clip', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    for (const [name, play] of SOUNDS) {
      const rec = run(play);
      const sum = rec.gains.reduce((total, gain) => total + peakOf(gain), 0);
      expect(sum, name).toBeGreaterThan(0);
      // Голоса одного сигнала складываются на мастере, поэтому потолок считается на сумму.
      expect(sum, name).toBeLessThanOrEqual(PEAK_CEILING);
    }
  });

  it('leaves the summed headroom for ten of the same signal, not ten different ones', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // Настоящий предел перегруз — сумма пиков, взятых в один момент, а не сумма записанных
    // значений: голоса одного сигнала гаснут по очереди и не складываются все сразу. Пик
    // огибающей честно считается по форме, иначе проверка на сумму `peak` пропускала бы
    // сигнал, чьи голоса бьют одновременно.
    //
    // Запас делится между всеми сигналами: десять кристаллов разом должны помещаться
    // под 1.0, и это ограничение на КАЖДЫЙ сигнал, а не на набор. Отсюда 0.09, а не 0.1 —
    // при десяти копиях остаётся запас на то, что игрок нажал две разные кнопки.
    for (const [name, play] of SOUNDS) {
      const rec = run(play);
      const instant = simultaneousPeak(rec);
      expect(instant, name).toBeGreaterThan(0);
      expect(instant * 10, `${name} x10`).toBeLessThanOrEqual(0.9);
    }
  });

  it('varies the waveform instead of living on one timbre', () => {
    const waveforms = new Set(SOUNDS.flatMap(([, play]) => run(play).oscillators.map((osc) => osc.type)));
    // Квадрат слышно как «чип», треугольник как «мягкий», синус как «стекло», пила как «жар».
    // Один тип на все сигналы означал бы, что различает их только высота.
    expect(waveforms.size).toBeGreaterThanOrEqual(3);
  });

  it('detunes a layered pair, or the chime is one bare oscillator', () => {
    const detuned = SOUNDS.filter(([, play]) =>
      run(play).oscillators.some((osc) => Math.abs(osc.detune.ramps[0]?.value ?? 0) >= 5),
    ).length;
    // Расстройка снимает «призрак одного осциллятора»; без неё хор звучит как калибровочный тон.
    expect(detuned).toBeGreaterThanOrEqual(2);
  });
});

describe('различимость', () => {
  it('gives every signal its own length, because a chord is told from a tick by its tail', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // Длина — ось, по которой сигнал узнаётся, даже когда высоты совпадают: 30-миллисекундный
    // щелчок и секундную Веху перепутать невозможно.
    const lengths = SOUNDS.map(([, play]) => {
      const rec = run(play);
      return Math.max(...rec.oscillators.map((osc) => osc.stops[0])) - NOW;
    });
    for (let i = 0; i < lengths.length; i++) {
      for (let j = i + 1; j < lengths.length; j++) {
        // Разница меньше 20 мс неразличима на слух и означала бы два одинаковых сигнала.
        expect(Math.abs(lengths[i] - lengths[j]), `${SOUNDS[i][0]} vs ${SOUNDS[j][0]}`).toBeGreaterThan(0.02);
      }
    }
  });

  it('keeps every scheduled pitch inside the audible band', () => {
    // Каждая высота, включая цель свипа: неразличимый голос всё равно стоит узлов и задержки.
    for (const [name, play] of SOUNDS) {
      const rec = record();
      use(rec);
      const heard: number[] = [];
      // Разброс узкий, поэтому хватает двух кромок диапазона, а не сотни розыгрышей.
      for (const edge of [0, 1]) {
        vi.spyOn(Math, 'random').mockReturnValue(edge);
        use(rec);
        play(ON);
        heard.push(...pitches(rec));
      }
      vi.restoreAllMocks();
      for (const pitch of heard) {
        expect(pitch, `${name} @${pitch.toFixed(1)}Hz`).toBeGreaterThan(AUDIBLE.min);
        expect(pitch, `${name} @${pitch.toFixed(1)}Hz`).toBeLessThan(AUDIBLE.max);
      }
    }
  });

  it('gives every signal a signature no ear could confuse', () => {
    // Ровно середина диапазона: разброса нет, и отпечаток — это чистый замысел, а не случайность.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const prints = SOUNDS.map(([, play]) => fingerprint(run(play)));
    expect(new Set(prints).size).toBe(SOUNDS.length);
  });

  it('never reuses one set of pitches across two signals', () => {
    // Сравнение наборов высот отдельно от отпечатка: звук с той же мелодией в другом тембре всё
    // равно спутал бы игрока, а отпечаток такую пару различает.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const sets = SOUNDS.map(([, play]) => pitches(run(play)).sort((a, b) => a - b));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const label = `${SOUNDS[i][0]} vs ${SOUNDS[j][0]}`;
        // Мультимножества равны, если у обоих одинаковый набор уникальных высот и длины.
        expect([...new Set(sets[i])].sort((a, b) => a - b), label).not.toEqual(
          [...new Set(sets[j])].sort((a, b) => a - b),
        );
      }
    }
  });
});

describe('разброс высоты', () => {
  it('moves the pitch on every call, or the hundredth repeat sounds like one machine', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mid = SOUNDS.map(([, play]) => pitches(run(play)).sort((a, b) => a - b));
    // Нижняя кромка диапазона: разница со серединой гарантирована любым разбросом.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = SOUNDS.map(([, play]) => pitches(run(play)).sort((a, b) => a - b));
    for (let i = 0; i < SOUNDS.length; i++) {
      expect(low[i].join(','), SOUNDS[i][0]).not.toBe(mid[i].join(','));
    }
  });

  it('keeps the spread inside ±4%, or a repeat starts reading as an out-of-tune instrument', () => {
    // Порядок высот внутри сигнала детерминирован, поэтому розыгрыш в кромках диапазона
    // сравнивается поэлементно с тем же сигналом без разброса.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const neutral = SOUNDS.map(([, play]) => pitches(run(play)));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const low = SOUNDS.map(([, play]) => pitches(run(play)));
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const high = SOUNDS.map(([, play]) => pitches(run(play)));
    for (let s = 0; s < SOUNDS.length; s++) {
      expect(neutral[s], SOUNDS[s][0]).toHaveLength(low[s].length);
      for (let v = 0; v < neutral[s].length; v++) {
        expect(low[s][v] / neutral[s][v], `${SOUNDS[s][0]} #${v}`).toBeGreaterThan(1 - SPREAD);
        expect(high[s][v] / neutral[s][v], `${SOUNDS[s][0]} #${v}`).toBeLessThan(1 + SPREAD);
      }
    }
  });
});

describe('задержка', () => {
  it('starts the first voice at the current context time', () => {
    for (const [name, play] of SOUNDS) {
      const rec = run(play);
      // Первый голос в будущем — это ровно та задержка, которую игрок слышит как лаг; всё
      // остальное расписание может отставать, начало — нет.
      expect(Math.min(...rec.oscillators.flatMap((osc) => osc.starts)), name).toBe(NOW);
    }
  });

  it('plays every voice through a gain into the effects channel, so nothing bypasses the envelope or the volume', () => {
    for (const [name, play] of SOUNDS) {
      const rec = run(play);
      // Один голос — одна огибающая, и голос подключается ровно к ней: подключение мимо
      // огибающей играло бы на полной амплитуде и вернуло бы щелчок на старте.
      expect(rec.oscillators, name).toHaveLength(rec.gains.length);
      for (const [index, osc] of rec.oscillators.entries()) {
        expect(osc.connections, name).toEqual([rec.gains[index]]);
        expect(rec.gains[index].gain.ramps.length, name).toBeGreaterThan(0);
      }
      // Огибающая уходит в канал эффектов, а не мимо него в колонки: иначе громкость игрока не дошла бы.
      for (const gain of rec.gains) {
        expect(gain.connections, name).toEqual([rec.sfx]);
      }
    }
  });
});
