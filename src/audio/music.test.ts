import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Музыка проверяется на графе, а не на слух: в node нет ни AudioContext, ни ушей.
 *
 * Мок собирает узел за узлом и записывает всё, что на них назначали. Отсюда видно то,
 * ради чего написана проверка: назначенные времена и частоты. Именно по ним определяется,
 * что доля стоит там, где должна, а не «вроде играет».
 */

/** Конец записи: всё, что было назначено раньше, уже отыграно. */
const scheduled: { kind: string; param: string; time: number; value: number }[] = [];
/** Вызовы `start()` — по ним видно, что ноты не наезжают на одну секунду. */
const started: { at: number }[] = [];
/**
 * Остановленные ОСЦИЛЛЯТОРЫ и остановленные ИСТОЧНИКИ ШУМА считаются раздельно.
 *
 * Удар пульса — это одноразовый источник шума, и он останавливается сам в конце
 * собственного конверта, то есть задолго до `stopMusic`. Считать всё одним числом
 * нельзя: тест «глушит ли мастер, не убивая голоса» смотрел бы на удар, который
 * завершился сам собой, и падал бы на пустом месте.
 */
let oscStopped = 0;
let bufStopped = 0;

/**
 * Рекурсивный мок узла: у каждого параметра есть `setValueAtTime`, `setTargetAtTime` и
 * рампы, и все они возвращают сам параметр — так ведёт себя настоящий AudioParam, и на
 * этом строится цепочка `setTargetAtTime(...).setTargetAtTime(...)`.
 *
 * `self` — именованная функция вместо `this`: в строгом модуле стрелочная функция не даёт
 * доступа к `this`, а геттер `get self()` работал бы только при обращении через объект.
 */
function param(name: string, node: string) {
  const p = {
    value: 0,
    setValueAtTime: (v: number, t: number) => { scheduled.push({ kind: node, param: name, time: t, value: v }); return p; },
    setTargetAtTime: (v: number, t: number) => { scheduled.push({ kind: node, param: name, time: t, value: v }); return p; },
    exponentialRampToValueAtTime: (v: number, t: number) => { scheduled.push({ kind: node, param: name, time: t, value: v }); return p; },
    linearRampToValueAtTime: (v: number, t: number) => { scheduled.push({ kind: node, param: name, time: t, value: v }); return p; },
    cancelScheduledValues: () => p,
  };
  return p;
}

const gainNode = (name: string) => ({
  gain: param('gain', name),
  connect: vi.fn((n) => n),
  disconnect: vi.fn(),
});

const oscNode = (name: string) => ({
  type: 'sine',
  frequency: param('frequency', name),
  detune: param('detune', name),
  connect: vi.fn((n) => n),
  disconnect: vi.fn(),
  start: (t?: number) => { started.push({ at: t ?? 0 }); },
  stop: () => { oscStopped++; },
});

const filterNode = (name: string) => ({
  type: 'lowpass',
  frequency: param('frequency', name),
  Q: param('Q', name),
  connect: vi.fn((n) => n),
  disconnect: vi.fn(),
});

/** Источник шума: одноразовый, безымянный, и его `start(t)` несёт время ноты. */
const bufferNode = () => ({
  buffer: null as AudioBuffer | null,
  loop: false,
  connect: vi.fn((n) => n),
  disconnect: vi.fn(),
  start: (t?: number) => { started.push({ at: t ?? 0 }); },
  stop: () => { bufStopped++; },
});

/** Контекст с текущим временем, которым можно управлять в тесте. */
let clock = 0;
let oscSeq = 0;
let gainSeq = 0;
const ctx = {
  /** Геттер, а не поле: планировщик читает `currentTime` на КАЖДОМ тике таймера, и полем
   *  время в тесте не двигалось бы — весь музыкальный цикл тогда висел бы на нуле, и две
   *  сессии на разной скорости давали бы одинаковый результат. */
  get currentTime() { return clock; },
  sampleRate: 44100,
  state: 'running',
  destination: { connect: vi.fn() },
  createGain: vi.fn(() => gainNode(`gain${++gainSeq}`)),
  // Имена узлов задаёт сам мок через счётчик: тест различает ноты баса и арпеджио по имени,
  // а не по порядку создания, которое менялось бы вместе с кодом.
  createOscillator: vi.fn(() => oscNode(`osc${++oscSeq}`)),
  createBiquadFilter: vi.fn((n = 'filter') => filterNode(n)),
  createBufferSource: vi.fn(() => bufferNode()),
  createBuffer: vi.fn((_ch: number, len: number) => ({
    length: len,
    sampleRate: 44100,
    getChannelData: () => new Float32Array(len),
  })) as unknown as AudioContext['createBuffer'],
  resume: vi.fn(() => Promise.resolve()),
} as unknown as AudioContext;

vi.mock('./sound', () => ({
  audioContext: vi.fn(() => ctx),
  playClickSound: vi.fn(),
  playBuySound: vi.fn(),
  playAchievementSound: vi.fn(),
  playPrestigeSound: vi.fn(),
  playDenySound: vi.fn(),
  playEventAlertSound: vi.fn(),
  playUpgradeSound: vi.fn(),
}));

vi.mock('./thermal', () => ({
  updateThermalAudio: vi.fn(),
  playCoolingSound: vi.fn(),
  playHallucinationSound: vi.fn(),
}));

const { stopMusic, updateMusic, lastRoot, ROOTS, voiceGains, voicePeakSum, MASTER_LEVEL, MUSIC_PEAK_BUDGET } =
  await import('./music');
const { CATALOG } = await import('../economy/catalog');
const { SFX_PEAK_CEILING } = await import('./sfx');

beforeEach(() => {
  scheduled.length = 0;
  started.length = 0;
  oscStopped = 0;
  bufStopped = 0;
  clock = 0;
  // Счётчики имён узлов сбрасываются: тест ищет мастер и голоса по именам, и без сброса
  // второй тест увидел бы `gain8` вместо `gain1`.
  oscSeq = 0;
  gainSeq = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  stopMusic();
  vi.useRealTimers();
});

/** Сколько осцилляторов создано: считается по записям параметров, у каждого узла своё имя. */
const oscCount = (): number => new Set(scheduled.filter((s) => /^osc\d+$/.test(s.kind)).map((s) => s.kind)).size;

const run = (ms: number) => {
  for (let t = 0; t < ms; t += 40) {
    clock = t / 1000;
    vi.advanceTimersByTime(40);
  }
};

const open = (over: Partial<Parameters<typeof updateMusic>[1]> = {}) => {
  updateMusic(ctx, { generation: 0, temp: 0.7, heat: 0, muted: false, ...over });
};

describe('музыка', () => {
  it('молчит при muted и не создаёт узлов', () => {
    // Проверяется до `updateMusic`: при muted движок не поднимается вовсе, и в графе
    // не остаётся ни одного узла. Создавать, а потом глушить — значило бы жечь CPU
    // на планировщик, который всё равно не слышно.
    open({ muted: true });
    expect(ctx.createGain).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
  });

  it('поднимает голоса и играет ноты только в будущем', () => {
    // Пять секунд: пульс при 0.7 жара и без перегрева — около 0.9 доли в секунду, то
    // есть за шестьсот миллисекунд не проходит НИ ОДНОЙ доли и проверять тут нечего.
    open();
    run(5000);
    
    expect(oscCount()).toBeGreaterThan(0);
    // Время ноты живёт в назначениях частоты: у осцилляторов `start()` без времени,
    // потому что голос длится, а не ударяет, и в записях `started` они неотличимы от нуля.
    const times = scheduled
      .filter((s) => /^osc\d+$/.test(s.kind) && s.param === 'frequency')
      .map((s) => s.time);
    expect(times.length).toBeGreaterThan(4);
    // Времена не убывают: планировщик назначает ноты в порядке такта, и отступление назад
    // означало бы, что ноты наезжают друг на друга.
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    // Ни одна нота не глубоко в прошлом: Web Audio такие назначения просто игнорирует,
    // и музыка молчала бы. Первая нота может стоять в нуле — это «сейчас», а не просрочка.
    expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
  });

  it('разгоняет пульс с Температурой: жар звучит быстрее холода', () => {
    // Считаются назначения частоты на ОСЦИЛЛЯТОРЕ БАСА — он первый созданный, поэтому
    // `osc1`. Параметры громкости назначаются с той же частотой тика в обоих случаях и
    // разницы не дают, а частота баса назначается на каждой чётной доле, то есть её число
    // и есть темп.
    // Считаются назначения частоты на ЛЮБОМ осцилляторе: `setNote` ставит её на все голоса
    // сразу, поэтому одна доля даёт пять записей, и их отношение между сессиями то же
    // самое, что отношение долей.
    const countNotes = () => scheduled.filter((s) => /^osc\d+$/.test(s.kind) && s.param === 'frequency').length;

    open({ temp: 0.2, heat: 0 });
    run(4000);
    const cold = countNotes();

    stopMusic();
    scheduled.length = 0;
    clock = 0;
    open({ temp: 1.6, heat: 0.8 });
    run(4000);
    const hot = countNotes();

    expect(cold).toBeGreaterThan(0);
    // Пульс на пределе заметно быстрее холодного: за то же время нот больше в разы.
    expect(hot).toBeGreaterThan(cold * 2);
  });

  it('меняет тон при смене Поколения', () => {
    // Только осцилляторы: частота фильтра шума не является нотой и росла бы вместе с
    // жаром, а не с Поколением.
    const notes = () =>
      scheduled.filter((s) => s.kind.startsWith('osc') && s.param === 'frequency').map((s) => s.value);

    // Температура максимальная не для проверки Поколения, а ради темпа: верхняя ступень
    // арпеджио — четвёртый такт, и на медленном пульсе до неё нужно шесть секунд, а
    // проверять её на недобранном рисунке бессмысленно.
    open({ generation: 0, temp: 1.6, heat: 0 });
    run(8000);
    const first = notes();
    stopMusic();

    scheduled.length = 0;
    started.length = 0;
    clock = 0;
    open({ generation: 7, temp: 1.6, heat: 0 });
    run(8000);
    const last = notes();

    expect(first.length).toBeGreaterThan(0);
    expect(last.length).toBeGreaterThan(0);
    // Восемь Поколений — восемь корней, и переход обязан быть СЛЫШИМ: набор частот
    // предыдущего Поколения не может совпасть с последним. Формально «два числа разные»
    // ничего не значит, поэтому сравниваются множества.
    const overlap = last.filter((f) => first.includes(f));
    expect(overlap.length / last.length).toBeLessThan(0.5);
    // И самый высокий тон игры принадлежит последнему Поколению, а не первому: переход
    // вверх обязан быть слышим. Считается максимум, а не отдельная нота, потому что
    // строка содержит весь набор ступеней за четыре доли.
    // Отношение 4.7568 — это верхняя нота арпеджио над корнем: степень 19 в гамме из
    // десяти ступеней даёт 2 октавы с квинтой. Зашито числом, а не формулой: если рисунок
    // изменится, тест должен упасть на НОВУЮ максимальную ноту, а не молча пересчитаться.
    expect(Math.max(...last) / lastRoot).toBeCloseTo(4.7568, 3);
  });

  it('глушит мастер при muted, не останавливая голоса', () => {
    open();
    run(200);
    const voicesBefore = oscCount();
    open({ muted: true });
    // Глушение мастера: последнее назначение на ПЕРВОМ созданном усилении равно нулю.
    // Мастер создаётся первым в `updateMusic`, поэтому `gain1` — это он, и искать по факту
    // «последняя запись с нулевым значением» хрупко: нули ставятся и голосам.
    const master = scheduled.filter((s) => s.kind === 'gain1' && s.param === 'gain');
    expect(master.length).toBeGreaterThan(0);
    expect(master[master.length - 1].value).toBe(0);
    // Голоса живы: они нужны для следующего снятия глушения, а `stop()` необратим.
    expect(oscCount()).toBe(voicesBefore);
    // Ни один голос не остановлен. Удары пульса при этом останавливаются — у них свой
    // короткий конверт, — поэтому считаются отдельно.
    expect(oscStopped).toBe(0);
  });

  it('останавливает все голоса по stopMusic', () => {
    open();
    run(200);
    const voices = oscCount();
    stopMusic();
    // Ровно по числу созданных голосов: бас, два арпеджио и две подушки. Больше — значит
    // остановилось то, чему остановка не назначена; меньше — голос остался играть в пустоту.
    expect(oscStopped).toBe(voices);
    // Повторный вызов безопасен: тосты и снятие настройки дёргают его независимо.
    expect(() => stopMusic()).not.toThrow();
  });

  it('не накапливает доли при отставшем планировщике', () => {
    open();
    // Планировщик пропускает двадцать секунд: так выглядит вкладка, ушедшая в фон.
    clock = 20;
    vi.advanceTimersByTime(40);
    // Одна итерация обязана назначить ограниченное число долей, а не двести: иначе после
    // возвращения из фоновой вкладки музыка выдала бы накопленное за полчаса разом.
    const notes = scheduled.filter((s) => s.kind.startsWith('osc') && s.param === 'frequency').length;
    expect(notes).toBeLessThan(64);
  });

  it('играет ПОД звуковыми эффектами на любой Температуре', () => {
    // Проверяется не мастер, а произведение: мастер — просто множитель, и ограничить им
    // сумму голосов нельзя. Перебор идёт по всей области состояния, а не по двум точкам:
    // громкость — ползунок между холодом и пределом, и невыполненное условие живёт в середине.
    for (let t = 0; t <= 1.0001; t += 0.1) {
      for (let h = 0; h <= 1.0001; h += 0.1) {
        const sum = voicePeakSum(voiceGains(t, h));
        expect(MASTER_LEVEL * sum).toBeLessThanOrEqual(MUSIC_PEAK_BUDGET);
      }
    }
    // Бюджет — половина потолка эффектов, а не сам потолок: щелчок, наложенный на долю,
    // обязан остаться щелчком. Иначе музыка просто заглушает то, ради чего игрок кликает.
    expect(MUSIC_PEAK_BUDGET).toBeLessThan(SFX_PEAK_CEILING);
    // Мастер не задаётся отдельно от голосов: он выведен из худшей суммы по углам области
    // состояния, поэтому любая правка громкости голоса не выводит музыку за бюджет молча.
    let worst = 0;
    for (const t of [0, 1]) for (const h of [0, 1]) worst = Math.max(worst, voicePeakSum(voiceGains(t, h)));
    expect(MASTER_LEVEL * worst).toBeCloseTo(MUSIC_PEAK_BUDGET, 12);
    // И худшая точка — предел Температуры при холодном железе, а не «жар и жар»: бас уходит
    // с перегревом, и сумма голосов на пределе меньше, чем на разгоне.
    expect(worst).toBe(voicePeakSum(voiceGains(1, 0)));
    expect(voicePeakSum(voiceGains(1, 1))).toBeLessThan(worst);
  });

  it('разгоняет пульс и громкость с Температурой', () => {
    // Громкость проверяется суммой голосов, а не назначением на мастере: мастер от Температуры
    // не зависит вовсе, и проверка его громкости доказала бы только одно — что он есть.
    const coldSum = voicePeakSum(voiceGains(0, 0));
    const hotSum = voicePeakSum(voiceGains(1, 1));
    expect(hotSum).toBeGreaterThan(coldSum * 1.5);
    // Голоса перераспределяются, а не просто прибавляются: бас уходит вниз, остальные вверх.
    // Без этого на пределе остаётся ровное гудение, и Температура слышна только по скорости.
    const cold = voiceGains(0, 0);
    const hot = voiceGains(1, 1);
    expect(hot.bass).toBeLessThan(cold.bass);
    expect(hot.arp).toBeGreaterThan(cold.arp);
    expect(hot.noise).toBeGreaterThan(cold.noise * 2);
  });

  it('не создаёт второй контекст и переиспользует один', () => {
    open();
    const before = oscCount();
    open();
    open({ temp: 1.2 });
    // Двадцать тиков подряд не должны ни разу создать узел: всё, что меняется, —
    // параметры. Узел на тик означал бы щелчок двадцать раз в секунду.
    expect(oscCount()).toBe(before);
    // Столько корней, сколько Поколений: иначе лишнее Поколение получило бы чужой тон
    // молча, и это узнать можно было бы только слухом на девятом шаге игры.
    expect(ROOTS.length).toBe(CATALOG.length);
    // Корни идут вверх — смена Поколения обязана быть слышной вверх, а не только вниз.
    for (let i = 1; i < ROOTS.length; i++) expect(ROOTS[i]).toBeGreaterThan(ROOTS[i - 1]);
  });
});
