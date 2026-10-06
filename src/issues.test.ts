import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CATALOG } from './economy/catalog';
import { FIRST_EVENT_MAX_MS, FIRST_EVENT_MIN_MS } from './economy/events';
import { MILESTONES, milestoneHint, milestoneReward } from './economy/milestones';
import { newGame } from './economy/state';
import { GLOSSARY } from './data/glossary';

const goldenTokenSource = readFileSync(new URL('./components/GoldenToken.tsx', import.meta.url).pathname, 'utf8');
const clickColumnSource = readFileSync(new URL('./components/ClickColumn.tsx', import.meta.url).pathname, 'utf8');
const shopColumnSource = readFileSync(new URL('./components/ShopColumn.tsx', import.meta.url).pathname, 'utf8');
const milestoneStripSource = readFileSync(new URL('./components/MilestoneStrip.tsx', import.meta.url).pathname, 'utf8');
const cssSource = readFileSync(new URL('./index.css', import.meta.url).pathname, 'utf8');

describe('Issue #41: Golden Token does not crash with white screen (Rules of Hooks)', () => {
  it('calls all hooks before any early returns in GoldenToken.tsx', () => {
    // In GoldenToken.tsx, hooks like useState and useEffect must NOT be placed after early return
    const earlyReturnIndex = goldenTokenSource.indexOf('if (!spec || !event) return null;');
    expect(earlyReturnIndex).toBeGreaterThan(0);

    const useStateIndex = goldenTokenSource.indexOf('useState');
    const useEffectIndex = goldenTokenSource.indexOf('useEffect');

    expect(useStateIndex).toBeLessThan(earlyReturnIndex);
    expect(useEffectIndex).toBeLessThan(earlyReturnIndex);
  });

  it('mounts GoldenToken conditionally in ClickColumn.tsx only during active event', () => {
    // ClickColumn must not unconditionally mount <GoldenToken />
    expect(clickColumnSource).not.toMatch(/<div>\s*<GoldenToken \/>/);
    expect(clickColumnSource).toMatch(/(?:state\.event|activeEvent|event)\s*&&.*<GoldenToken \/>/);
  });
});

describe('Issue #51: Milestone strip shows actual reward and generation roster size', () => {
  it('milestone strip displays scaled milestoneReward instead of base current.units', () => {
    expect(milestoneStripSource).toContain('milestoneReward(state, current)');
    expect(milestoneStripSource).not.toContain('formatNumber(current.units');
  });

  it('milestoneReward scales correctly with generations', () => {
    const s0 = newGame(0);
    const s1 = { ...newGame(0), generation: 1 };
    const s2 = { ...newGame(0), generation: 2 };
    const m = MILESTONES[0];

    expect(milestoneReward(s0, m)).toBe(m.units * CATALOG[0].scale);
    expect(milestoneReward(s1, m)).toBe(m.units * CATALOG[1].scale);
    expect(milestoneReward(s2, m)).toBe(m.units * CATALOG[2].scale);
  });

  it('milestoneHint connects hint and counts to the actual generation roster size', () => {
    const rosterMilestone = MILESTONES.find((m) => m.id === 'ms_roster')!;
    expect(rosterMilestone).toBeDefined();

    for (let gen = 0; gen < CATALOG.length; gen++) {
      const state = { ...newGame(0), generation: gen };
      const count = CATALOG[gen].models.length;
      const hint = milestoneHint(state, rosterMilestone);
      expect(hint).toContain(String(count));
      expect(hint).not.toMatch(/восемь карточек.*восемь галочек/);
    }
  });
});

describe('Issue #52: Shop displays "нет данных" for zero speed and price', () => {
  it('renders "нет данных" when speed or price is 0 or missing in ShopColumn', () => {
    expect(shopColumnSource).toMatch(/m\.speed\s*>\s*0\s*\?\s*`?\$\{m\.speed\}\s*t\/s`?\s*:\s*['"]нет данных['"]/);
    expect(shopColumnSource).toMatch(/m\.price\s*>\s*0\s*\?\s*`?\$?\$\{m\.price\}\/1M`?\s*:\s*['"]нет данных['"]/);
  });

  it('keeps catalog model count with speed and price intact', () => {
    let withSpeed = 0;
    let withPrice = 0;
    for (const gen of CATALOG) {
      for (const m of gen.models) {
        if (m.speed > 0) withSpeed++;
        if (m.price > 0) withPrice++;
      }
    }
    // Catalog data itself must not be altered to mask missing data
    expect(withSpeed).toBeGreaterThan(0);
    expect(withPrice).toBeGreaterThan(0);
  });
});

describe('Issue #54: Glossary texts match event interval code constants and avoid forbidden words', () => {
  const banned = new Set([
    'монета', 'монеты', 'монет', 'тап', 'тапы', 'здание', 'здания', 'зданий',
    'юнит', 'юниты', 'юнитов', 'сессия', 'сессии', 'компания', 'вендор', 'провайдер',
    'ивент', 'эвент', 'баг', 'баги', 'бонус', 'бонусы', 'улучшение', 'статы',
    'бенчмарк', 'подписка', 'талант', 'пассивка', 'эпоха', 'сезон', 'ран',
    'апокалипсис', 'мятеж', 'взятка', 'жетон', 'купон', 'подарок', 'реклама',
    'промокод', 'самоцвет', 'алмаз', 'аватар', 'логотип', 'тир', 'уровень', 'босс',
  ]);

  it('glossary entries for Событие and Волна хайпа match code constants', () => {
    const eventEntry = GLOSSARY.find((g) => g.term === 'Событие')!;
    const hypeEntry = GLOSSARY.find((g) => g.term === 'Волна хайпа')!;

    expect(eventEntry).toBeDefined();
    expect(hypeEntry).toBeDefined();

    // Must not contain the false intervals
    expect(eventEntry.text).not.toContain('пяти до пятнадцати');
    expect(hypeEntry.text).not.toContain('до пятнадцати минут');

    // Must mention first event timing (45–90 с)
    const firstSecMin = FIRST_EVENT_MIN_MS / 1000;
    const firstSecMax = FIRST_EVENT_MAX_MS / 1000;
    expect(eventEntry.text).toContain(`${firstSecMin}–${firstSecMax}`);
    expect(hypeEntry.text).toContain(`${firstSecMin}–${firstSecMax}`);

    // Must mention steady interval (2–10 минут / от двух до десяти минут)
    expect(eventEntry.text).toMatch(/двух до десяти минут/);
    expect(hypeEntry.text).toMatch(/двух до десяти минут/);

    // Both entries have identical timing phrase
    const timingPhrase = `Первое Событие после старта Забега приходит через ${firstSecMin}–${firstSecMax} секунд, а дальше между Событиями проходит от двух до десяти минут`;
    expect(eventEntry.text).toContain(timingPhrase);
    expect(hypeEntry.text).toContain(timingPhrase);
  });

  it('contains no forbidden synonyms in glossary entries', () => {
    for (const g of GLOSSARY) {
      const words = g.text.toLowerCase().split(/[^а-яёa-z]+/);
      const violations = words.filter((w) => banned.has(w));
      expect(violations, `Forbidden word in ${g.term}: ${violations.join(', ')}`).toEqual([]);
    }
  });

  it('static hint for ms_roster does not promise fixed 8 cards where roster is larger', () => {
    const rosterMilestone = MILESTONES.find((m) => m.id === 'ms_roster')!;
    expect(rosterMilestone.hint).not.toMatch(/восемь карточек.*восемь галочек/);
  });
});

describe('Issue #62: Reduced motion disables temperature dial and progress width transitions', () => {
  it('disables position and width transitions on thermal dial under [data-motion="reduced"]', () => {
    expect(cssSource).toMatch(/\[data-motion='reduced'\]\s*\.thermal-dial__fill[\s\S]*?transition:\s*none/);
    expect(cssSource).toMatch(/\[data-motion='reduced'\]\s*\.thermal-dial__handle[\s\S]*?transition:\s*none/);
  });

  it('preserves opacity transition for thermal-dial__heat', () => {
    // Opacity transition should NOT be forced to none
    expect(cssSource).not.toMatch(/\[data-motion='reduced'\]\s*\.thermal-dial__heat[\s\S]*?transition:\s*none/);
  });

  it('gates progress width transitions in ClickColumn and ShopColumn with motion', () => {
    // No unconditional width transitions with false comments
    expect(clickColumnSource).not.toContain('// Переход ширины — не движение: при reducedMotion остаётся');
    expect(shopColumnSource).not.toContain('// Переход ширины — не движение: при выключенном он остаётся');

    // Transitions must be gated by motion
    expect(clickColumnSource).toMatch(/transition:\s*motion\s*\?\s*['"]width 0\.2s/);
    expect(shopColumnSource).toMatch(/transition:\s*motion\s*\?\s*['"]width 0\.2s/);
  });
});


import { advance, advanceTime, applyOffline, isValidInterval, prestige } from './economy/engine';
import { exportSave, importSave } from './economy/save';
import { SHADOW_ACHIEVEMENTS } from './economy/shadow';

describe('Issue #44: Non-numeric intervals and corrupt counters do not corrupt state or wallet', () => {
  it('isValidInterval rejects NaN, null, non-numbers, zero, and negative values', () => {
    expect(isValidInterval(0.05)).toBe(true);
    expect(isValidInterval(10)).toBe(true);
    expect(isValidInterval(NaN)).toBe(false);
    expect(isValidInterval(null)).toBe(false);
    expect(isValidInterval(undefined)).toBe(false);
    expect(isValidInterval('0.05')).toBe(false);
    expect(isValidInterval(0)).toBe(false);
    expect(isValidInterval(-1)).toBe(false);
    expect(isValidInterval(Infinity)).toBe(false);
  });

  it('tick with non-numeric interval leaves state byte-for-byte identical', () => {
    const s = newGame(1000);
    // advance with NaN, string, negative returns the exact same reference
    expect(advance(s, NaN as any)).toBe(s);
    expect(advance(s, -5)).toBe(s);
    expect(advanceTime(s, NaN as any)).toBe(s);
    expect(advanceTime(s, 0)).toBe(s);
    expect(advanceTime(s, -1)).toBe(s);
  });

  it('importSave rejects saves with non-numeric counters instead of wiping wallet to 0', () => {
    const valid = newGame(1000);
    const validStr = exportSave(valid);
    expect(importSave(validStr, 1000)).not.toBeNull();

    // Corrupt tokens to null
    const corruptNull = btoa(JSON.stringify({ ...valid, tokens: null }));
    expect(importSave(corruptNull, 1000)).toBeNull();

    // Corrupt tokens to non-numeric string
    const corruptStr = btoa(JSON.stringify({ ...valid, tokens: 'invalid' }));
    expect(importSave(corruptStr, 1000)).toBeNull();

    // Corrupt clicks to negative
    const corruptNegative = btoa(JSON.stringify({ ...valid, clicks: -1 }));
    expect(importSave(corruptNegative, 1000)).toBeNull();
  });
});

describe('Issue #49: Game clock does not travel into the future', () => {
  it('future timestamps in save are clamped to current moment on import', () => {
    const s = newGame(1000);
    const futureSave = {
      ...s,
      lastTick: 5000,
      startedAt: 5000,
      runStartedAt: 5000,
    };
    const loaded = importSave(exportSave(futureSave as any), 2000)!;
    expect(loaded.lastTick).toBe(2000);
    expect(loaded.startedAt).toBe(2000);
    expect(loaded.runStartedAt).toBe(2000);
  });

  it('rolling back clock yields 0 offline tokens and resets lastTick to now', () => {
    const s = { ...newGame(5000), tokens: 100 };
    const offline = applyOffline(s, 2000);
    expect(offline.earned).toBe(0);
    expect(offline.seconds).toBe(0);
    expect(offline.state.lastTick).toBe(2000);
    expect(offline.state.tokens).toBe(100);
  });
});

describe('Issue #66: Prestige uses game clock and preserves pledge and glitch timers', () => {
  it('prestige preserves active pledge and glitch schedules without clock drift', () => {
    const s = {
      ...newGame(1000),
      tokens: 1e15,
      pledgeUntil: 2500,
      nextGlitchAt: 3000,
      lastTick: 1200,
      agents: { [CATALOG[0].flagship.id]: 1 },
    };
    // Default prestige uses state.lastTick
    const p = prestige(s);
    expect(p.lastTick).toBe(1200);
    expect(p.runStartedAt).toBe(1200);
    expect(p.pledgeUntil).toBe(2500);
    expect(p.nextGlitchAt).toBe(3000);
  });
});

describe('Issue #69: Tick does not recalculate full income for thresholds', () => {
  it('shadow achievement for click price does not touch agents when goal is unreachable', () => {
    const s = newGame(1000);
    const shadow = SHADOW_ACHIEVEMENTS.find((a) => a.id === 'shadow_click_worth_1e24')!;
    const guarded = new Proxy(s, {
      get(target, prop) {
        if (prop === 'agents') {
          throw new Error('Should not inspect agents when goal is unreachable!');
        }
        return (target as any)[prop];
      },
    });
    expect(shadow.check(guarded)).toBe(false);
  });
});
