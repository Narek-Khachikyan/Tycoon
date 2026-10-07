import { describe, expect, it, vi, afterEach } from 'vitest';
import { CORRUPT_SAVE_KEY, exportSave, importSave, MIGRATIONS, migrate, quarantineStoredSave, readStoredSave, SAVE_KEY } from './save';
import { CRYSTAL_CYCLE_MS, crystalCycleMs } from './crystal';
import { CATALOG } from './catalog';
import { DEFAULT_VOLUME, newGame, SAVE_VERSION } from './state';

const encodeRaw = (raw: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

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
  it('gives a v6 save the default volume and keeps the other settings', () => {
    const s = migrate(v6Save(), T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.settings.volume).toBe(DEFAULT_VOLUME);
    expect(s.settings.notation).toBe('sci');
    expect(s.settings.muted).toBe(true);
    expect(s.settings.reducedMotion).toBe(true);
    expect(s.generation).toBe(3);
    expect(s.tokens).toBe(1e6);
  });

  it('gives the default volume to a save that predates settings entirely', () => {
    expect(migrate({ version: 1, generation: 2, tokens: 5 }, T0).settings.volume).toBe(DEFAULT_VOLUME);
    // Отсутствие settings целиком — обычное дело, а не мусор: разбор обязан достроить блок.
    expect(migrate({ version: 1, settings: null }, T0).settings.volume).toBe(DEFAULT_VOLUME);
  });

  it('clamps a volume from a corrupt or foreign save into 0..1', () => {
    expect(migrate(currentSave({ volume: 9999 }), T0).settings.volume).toBe(1);
    expect(migrate(currentSave({ volume: -5 }), T0).settings.volume).toBe(0);
    // Импорт идёт через base64 чужого файла — зажим обязан работать и на этом пути.
    expect(importSave(exportSave(currentSave({ volume: 9999 })), T0)!.settings.volume).toBe(1);
    expect(importSave(exportSave(currentSave({ volume: -5 })), T0)!.settings.volume).toBe(0);
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
    // Миграция дополняет, а не перезаписывает: даже поле, которого в настоящей
    // v7-записи быть не могло, сохраняется как есть, а не сбрасывается в дефолт.
    expect(migrate(v6Save({ volume: 0.25 }), T0).settings.volume).toBe(0.25);
  });

  it('round-trips through export/import, including a deliberate silence', () => {
    for (const volume of [0.35, 0]) {
      const s = { ...newGame(T0), settings: { ...newGame(T0).settings, volume } };
      expect(importSave(exportSave(s), T0)!.settings).toEqual(s.settings);
    }
  });
});

describe('save effect switches and channel volumes', () => {
  /** Настройки игрока, который успел выбрать всё, что было выбираемо до переключателей. */
  const CHOSEN = { notation: 'sci', muted: true, volume: 0.25, reducedMotion: true };
  const EFFECT_DEFAULTS = { particles: true, floaters: true, shake: true, ticker: true, musicVolume: 1, sfxVolume: 1 };

  it('brings a save of every earlier version to the current one with every effect on and full channels', () => {
    for (let v = 1; v < SAVE_VERSION; v++) {
      const s = migrate({ version: v, generation: 3, tokens: 1e6, settings: CHOSEN }, T0);
      expect(s.version, `v${v}`).toBe(SAVE_VERSION);
      // Каналы на единице, а не на DEFAULT_VOLUME: общий ползунок остаётся мастером, и игрок,
      // не трогавший новых настроек, слышит игру ровно такой, какой слышал вчера.
      expect(s.settings, `v${v}`).toEqual({ ...CHOSEN, ...EFFECT_DEFAULTS });
      expect(s.generation, `v${v}`).toBe(3);
      expect(s.tokens, `v${v}`).toBe(1e6);
    }
  });

  it('builds the whole settings block for a save that predates settings entirely', () => {
    expect(migrate({ version: 1, generation: 2 }, T0).settings).toEqual({
      notation: 'short',
      muted: false,
      volume: DEFAULT_VOLUME,
      reducedMotion: false,
      ...EFFECT_DEFAULTS,
    });
  });

  it('starts a new game with every effect on and both channels full', () => {
    expect(newGame(T0).settings).toEqual({
      notation: 'short',
      muted: false,
      volume: DEFAULT_VOLUME,
      reducedMotion: false,
      ...EFFECT_DEFAULTS,
    });
  });

  it('keeps what the player switched off and the channel levels they chose', () => {
    const chosen = { particles: false, floaters: false, shake: false, ticker: false, musicVolume: 0.3, sfxVolume: 0 };
    expect(migrate(currentSave(chosen), T0).settings).toMatchObject(chosen);
    // Миграция дополняет, а не перезаписывает: поле, уже стоящее в записи, переживает подъём версии.
    expect(migrate({ version: SAVE_VERSION - 1, settings: { ...CHOSEN, ...chosen } }, T0).settings).toEqual({
      ...CHOSEN,
      ...chosen,
    });
  });

  it('falls back to on and full for values that are not a switch or a level', () => {
    const junk = migrate(
      currentSave({ particles: 'нет', floaters: null, shake: 0, ticker: [], musicVolume: 'x', sfxVolume: Infinity }),
      T0,
    );
    expect(junk.settings).toMatchObject(EFFECT_DEFAULTS);
    expect(migrate(currentSave({ musicVolume: NaN, sfxVolume: null }), T0).settings).toMatchObject({
      musicVolume: 1,
      sfxVolume: 1,
    });
  });

  it('clamps a channel level from a corrupt or foreign save into 0..1', () => {
    expect(migrate(currentSave({ musicVolume: 9999, sfxVolume: -5 }), T0).settings).toMatchObject({
      musicVolume: 1,
      sfxVolume: 0,
    });
    const imported = importSave(exportSave(currentSave({ musicVolume: -2, sfxVolume: 40 })), T0)!;
    expect(imported.settings).toMatchObject({ musicVolume: 0, sfxVolume: 1 });
  });

  it('round-trips through export/import, switches and silent channels included', () => {
    const base = newGame(T0);
    const s = {
      ...base,
      settings: { ...base.settings, particles: false, ticker: false, musicVolume: 0, sfxVolume: 0.4 },
    };
    expect(importSave(exportSave(s), T0)!.settings).toEqual(s.settings);
  });
});

describe('migration chain', () => {
  it('covers every version from 1 to SAVE_VERSION without gaps', () => {
    // Пропуск шага молча обрывал цепочку, а сохранение штамповалось текущей версией:
    // этот тест и есть запрет из AGENTS.md, и пропуск роняет его вместе со сборкой.
    for (let v = 1; v < SAVE_VERSION; v++) {
      expect(MIGRATIONS[v], `missing migration for v${v}`).toBeDefined();
    }
  });

  it('migrates a v7 save with crystals, milestones and quips without wiping them', () => {
    // Живая миграция с прошлой версии: всё, что игрок уже собрал, обязано пережить подъём версии.
    const raw = {
      ...newGame(T0),
      version: SAVE_VERSION - 1,
      crystals: 5,
      crystalUpgrades: ['cu:speed1'],
      milestones: ['ms_click'],
      quipsSeen: ['q1'],
      temp: 0.9,
      heat: 0.2,
    };
    const s = migrate(raw, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.crystals).toBe(5);
    expect(s.crystalUpgrades).toEqual(['cu:speed1']);
    expect(s.milestones).toEqual(['ms_click']);
    expect(s.quipsSeen).toEqual(['q1']);
    expect(s.temp).toBe(0.9);
    expect(s.heat).toBe(0.2);
  });

  it('fills only what is missing and never overwrites a present field with a default', () => {
    // Миграции дополняют, а не перезаписывают: сохранение со штампом v1, но с уже
    // заполненными полями обязано сохранить их все до единого.
    const full = {
      ...newGame(T0),
      version: 1,
      crystals: 5,
      crystalUpgrades: ['cu:speed1'],
      milestones: ['ms_click', 'ms_hire'],
      quipsSeen: ['q1'],
      challengesDone: ['no-click'],
      temp: 0.9,
      heat: 0.2,
      settings: { notation: 'sci', muted: true, volume: 0.25, reducedMotion: true },
    };
    const s = migrate(full, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.crystals).toBe(5);
    expect(s.crystalUpgrades).toEqual(['cu:speed1']);
    expect(s.milestones).toEqual(['ms_click', 'ms_hire']);
    expect(s.quipsSeen).toEqual(['q1']);
    expect(s.challengesDone).toEqual(['no-click']);
    expect(s.temp).toBe(0.9);
    expect(s.heat).toBe(0.2);
    expect(s.settings).toEqual({
      notation: 'sci',
      muted: true,
      volume: 0.25,
      reducedMotion: true,
      particles: true,
      floaters: true,
      shake: true,
      ticker: true,
      musicVolume: 1,
      sfxVolume: 1,
    });
  });
});

describe('import rejects non-saves', () => {
  it('rejects an empty object, an empty array and arbitrary JSON without progress fields', () => {
    expect(importSave(encodeRaw({}), T0)).toBeNull();
    expect(importSave(encodeRaw([]), T0)).toBeNull();
    expect(importSave(encodeRaw({ foo: 1, bar: [1, 2] }), T0)).toBeNull();
    expect(importSave(encodeRaw({ version: 8 }), T0)).toBeNull();
    expect(importSave(encodeRaw(42), T0)).toBeNull();
    expect(importSave(encodeRaw('hello'), T0)).toBeNull();
  });

  it('rejects a corrupt version instead of reading it as an old version', () => {
    const base = { ...newGame(T0), crystals: 5, milestones: ['ms_click'], quipsSeen: ['q1'] };
    expect(importSave(encodeRaw({ ...base, version: 'oops' }), T0)).toBeNull();
    expect(importSave(encodeRaw({ ...base, version: 2.5 }), T0)).toBeNull();
    expect(importSave(encodeRaw({ ...base, version: 0 }), T0)).toBeNull();
    expect(importSave(encodeRaw({ ...base, version: NaN }), T0)).toBeNull();
    const { version: _dropped, ...noVersion } = base;
    expect(importSave(encodeRaw(noVersion), T0)).toBeNull();
  });

  it('rejects truncated and non-base64 codes', () => {
    expect(importSave('', T0)).toBeNull();
    expect(importSave('!!!not-base64!!!', T0)).toBeNull();
    expect(importSave(encodeRaw(newGame(T0)).slice(0, 20), T0)).toBeNull();
    expect(importSave('{"tokens":', T0)).toBeNull();
  });

  it('still imports a valid save of the previous version with migrations', () => {
    const prev = { ...newGame(T0), version: SAVE_VERSION - 1, crystals: 3, totalTokens: 1e9 };
    const back = importSave(encodeRaw(prev), T0);
    expect(back).not.toBeNull();
    expect(back!.version).toBe(SAVE_VERSION);
    expect(back!.crystals).toBe(3);
    expect(back!.totalTokens).toBe(1e9);
  });
});

describe('foreign ids', () => {
  const PROTO_IDS = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];
  const modelId = CATALOG[0].models[0].id;

  it('drops prototype keys from every id list', () => {
    const s = migrate(
      {
        ...newGame(T0),
        upgrades: [...PROTO_IDS, `m:${modelId}:0`],
        perks: [...PROTO_IDS, 'click_x2'],
        crystalUpgrades: [...PROTO_IDS, 'cu:speed1'],
        milestones: [...PROTO_IDS, 'ms_click'],
      },
      T0,
    );
    expect(s.upgrades).toEqual([`m:${modelId}:0`]);
    expect(s.perks).toEqual(['click_x2']);
    expect(s.crystalUpgrades).toEqual(['cu:speed1']);
    expect(s.milestones).toEqual(['ms_click']);
  });

  it('drops prototype keys from agents and from the event model', () => {
    const agents: Record<string, unknown> = { [modelId]: 3 };
    for (const id of PROTO_IDS) agents[id] = 5;
    const s = migrate(
      {
        ...newGame(T0),
        agents,
        event: { kind: 'grant', startedAt: T0, red: false, modelId: 'toString' },
      },
      T0,
    );
    expect(s.agents).toEqual({ [modelId]: 3 });
    expect(s.event?.modelId).toBeUndefined();
  });

  it('keeps the crystal cycle numeric after importing a foreign crystal id', () => {
    const back = importSave(encodeRaw({ ...newGame(T0), crystalUpgrades: ['toString', '__proto__'] }), T0)!;
    expect(back.crystalUpgrades).toEqual([]);
    // Чужой id без белого списка давал cycleMs undefined, и цикл уходил в NaN:
    // кристалл «дозревал» каждый тик, раздавая бесплатные кристаллы и Доход.
    expect(crystalCycleMs(back)).toBe(CRYSTAL_CYCLE_MS);
  });
});

describe('corrupt storage', () => {
  const mem = (initial: Record<string, string> = {}) => {
    const cell = new Map(Object.entries(initial));
    return {
      cell,
      storage: {
        getItem: (k: string) => cell.get(k) ?? null,
        setItem: (k: string, v: string) => void cell.set(k, v),
        removeItem: (k: string) => void cell.delete(k),
      },
    };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads an empty storage as a quiet start', () => {
    const { storage } = mem();
    vi.stubGlobal('localStorage', storage);
    expect(readStoredSave()).toEqual({ status: 'empty' });
  });

  it('reads a valid save as ok', () => {
    const text = JSON.stringify(newGame(T0));
    const { storage } = mem({ [SAVE_KEY]: text });
    vi.stubGlobal('localStorage', storage);
    const read = readStoredSave();
    expect(read.status).toBe('ok');
  });

  it('reads truncated JSON as corrupt and quarantines the bytes under a separate key', () => {
    const truncated = '{"version":8,"tokens":12345,"agents":{"m:gpt-4';
    const { cell, storage } = mem({ [SAVE_KEY]: truncated });
    vi.stubGlobal('localStorage', storage);
    const read = readStoredSave();
    expect(read.status).toBe('corrupt');
    if (read.status !== 'corrupt') return;
    expect(read.text).toBe(truncated);
    quarantineStoredSave(read.text);
    // Исходные байты целы под отдельным ключом, а основной ключ свободен под новую игру.
    expect(cell.get(CORRUPT_SAVE_KEY)).toBe(truncated);
    expect(cell.get(SAVE_KEY)).toBeUndefined();
  });
});
