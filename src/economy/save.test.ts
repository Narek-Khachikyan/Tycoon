import { describe, expect, it } from 'vitest';
import { exportSave, importSave, migrate } from './save';
import { DEFAULT_VOLUME, newGame, SAVE_VERSION } from './state';

const T0 = 1_700_000_000_000;

/** Сохранение версии 6: поля громкости в нём ещё не существует. */
const v6Save = (settings?: Record<string, unknown>) => ({
  version: 6,
  generation: 3,
  tokens: 1e6,
  totalTokens: 1e6,
  lastTick: T0,
  settings: settings ?? { notation: 'sci', muted: true, reducedMotion: true },
});

/** Сохранение текущей версии — то, что реально пишет игра, и форма чужого/битого файла. */
const currentSave = (settings?: Record<string, unknown>) => {
  const base = newGame(T0);
  return { ...base, settings: { ...base.settings, ...settings } };
};

describe('save volume', () => {
  it('bumps the save version so the new field has a migration', () => {
    expect(SAVE_VERSION).toBe(7);
  });

  it('gives a v6 save the default volume and keeps the other settings', () => {
    const s = migrate(v6Save(), T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.settings.volume).toBe(DEFAULT_VOLUME);
    expect(s.settings.notation).toBe('sci');
    expect(s.settings.muted).toBe(true);
    expect(s.settings.reducedMotion).toBe(true);
  });

  it('gives the default volume to a save that predates settings entirely', () => {
    expect(migrate({ version: 1, generation: 2, tokens: 5 }, T0).settings.volume).toBe(DEFAULT_VOLUME);
    // Отсутствие settings целиком — обычное дело, а не мусор: разбор обязан достроить блок.
    expect(migrate({ version: 1, settings: null }, T0).settings.volume).toBe(DEFAULT_VOLUME);
  });

  it('leaves progress alone while adding the volume', () => {
    const s = migrate(v6Save(), T0);
    expect(s.generation).toBe(3);
    expect(s.tokens).toBe(1e6);
  });

  it('clamps a volume from a corrupt or foreign save into 0..1', () => {
    expect(migrate(currentSave({ volume: 9999 }), T0).settings.volume).toBe(1);
    expect(migrate(currentSave({ volume: -5 }), T0).settings.volume).toBe(0);
    // Импорт идёт через base64 чужого файла — зажим обязан работать и на этом пути.
    expect(importSave(btoa(JSON.stringify(currentSave({ volume: 9999 }))), T0)!.settings.volume).toBe(1);
    expect(importSave(btoa(JSON.stringify(currentSave({ volume: -5 }))), T0)!.settings.volume).toBe(0);
  });

  it('falls back to the default when the volume is not a number', () => {
    expect(migrate(currentSave({ volume: 'x' }), T0).settings.volume).toBe(DEFAULT_VOLUME);
    expect(migrate(currentSave({ volume: null }), T0).settings.volume).toBe(DEFAULT_VOLUME);
    expect(migrate(currentSave({ volume: Infinity }), T0).settings.volume).toBe(DEFAULT_VOLUME);
    expect(migrate(currentSave({ volume: NaN }), T0).settings.volume).toBe(DEFAULT_VOLUME);
  });

  it('keeps a volume the player actually chose', () => {
    expect(migrate(currentSave({ volume: 0.25 }), T0).settings.volume).toBe(0.25);
    expect(migrate(currentSave({ volume: 0 }), T0).settings.volume).toBe(0);
    expect(migrate(currentSave({ volume: 1 }), T0).settings.volume).toBe(1);
    // Миграция v6 обязана перекрыть чужое поле, которого в v7-записи ещё не могло быть.
    expect(migrate(v6Save({ volume: 0.25 }), T0).settings.volume).toBe(DEFAULT_VOLUME);
  });

  it('starts a new game at the default volume', () => {
    expect(newGame(T0).settings.volume).toBe(DEFAULT_VOLUME);
    // Мьют и громкость независимы: выключенный звук не значит нулевую громкость.
    expect(newGame(T0).settings).toMatchObject({ muted: false, reducedMotion: false });
  });

  it('round-trips through export/import', () => {
    const s = { ...newGame(T0), settings: { ...newGame(T0).settings, volume: 0.35 } };
    const back = importSave(exportSave(s), T0)!;
    expect(back.settings.volume).toBe(0.35);
    expect(back.settings).toEqual(s.settings);
  });

  it('round-trips a silent volume, so a deliberate silence survives a reload', () => {
    const s = { ...newGame(T0), settings: { ...newGame(T0).settings, volume: 0 } };
    expect(importSave(exportSave(s), T0)!.settings.volume).toBe(0);
  });
});
