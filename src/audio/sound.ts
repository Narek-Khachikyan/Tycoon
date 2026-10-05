/**
 * 8-битный звуковой синтезатор на Web Audio API.
 * Работает без внешних mp3/wav файлов, нулевая задержка.
 */

let audioCtx: AudioContext | null = null;

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

const getAudioContext = audioContext;

export function playClickSound(muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(740, now + 0.04);

  gain.gain.setValueAtTime(0.08, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.05);
}

export function playBuySound(muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.setValueAtTime(659.25, now + 0.05);

  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.12);
}

export function playUpgradeSound(muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + idx * 0.04;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.1, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + 0.09);
  });
}

export function playPrestigeSound(muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.35);

  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.4);

  // Второй слой-арпеджио — мост от удара к тиканью счётчика: свип умирал на 0.4с,
  // а оверлей живёт 2.6с, и хвост оставался немым. Мажорный треугольник вместо
  // квадратного минора Достижения, чтобы два торжества не звучали одинаково.
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, idx) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const start = now + 0.35 + idx * 0.13;

    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, start);

    g.gain.setValueAtTime(0.1, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);

    o.connect(g);
    g.connect(ctx.destination);

    o.start(start);
    o.stop(start + 0.21);
  });
}

export function playAchievementSound(muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + idx * 0.07;

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.08, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + 0.15);
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
export function playEventAlertSound(muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  // E5, B5, E6: последняя нота тянется вдвое дольше предыдущих — окно короткое, и хвост нужен,
  // чтобы сигнал не оборвался на полуфразе.
  [659.25, 987.77, 1318.51].forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + idx * 0.06;
    const hold = idx === 2 ? 0.22 : 0.07;

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.09, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + hold);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + hold);
  });
}

// Отказ по недоступной покупке — низкий короткий buzz, а не высокий тик: высокий тик
// совпал бы по тембру с покупкой и читался бы как подтверждение, а не как отказ.
export function playDenySound(muted: boolean): void {
  if (muted) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.12);

  gain.gain.setValueAtTime(0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.12);
}
