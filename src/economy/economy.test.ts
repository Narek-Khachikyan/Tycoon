import { describe, expect, it } from 'vitest';
import { buildCatalog, CATALOG, genScale, softMod } from './catalog';
import {
  advance, applyOffline, bulkCost, buyAgents, buyPerk, buyUpgrade, canPrestige, click, clickValue,
  isContentFinale, maxAffordable, prestige, prestigeGain, sellAgents, totalIncome,
} from './engine';
import { newGame, type GameState } from './state';
import { exportSave, importSave, migrate } from './save';
import { pickNews } from './news';
import { newlyEarned } from './achievements';
import { availableUpgrades, clickUpgradeId, modelUpgradeId, synergyUpgradeId } from './upgrades';
import { formatNumber } from './format';
import { GENERATIONS } from '../data/generations';

const T0 = 1_000_000;
const g0 = CATALOG[0];
const first = g0.models[0];
const rich = (s: GameState, tokens = 1e50): GameState => ({ ...s, tokens, runTokens: tokens });

describe('catalog', () => {
  it('ranks models by intelligence and makes the smartest the flagship', () => {
    for (const g of CATALOG) {
      for (let i = 1; i < g.models.length; i++) expect(g.models[i].iq).toBeGreaterThanOrEqual(g.models[i - 1].iq);
      expect(g.flagship.isFlagship).toBe(true);
    }
  });
  it('keeps cost and income strictly increasing with rank despite ±30% modifiers', () => {
    for (const g of CATALOG) {
      for (let i = 1; i < g.models.length; i++) {
        expect(g.models[i].baseCost).toBeGreaterThan(g.models[i - 1].baseCost);
        expect(g.models[i].baseIncome).toBeGreaterThan(g.models[i - 1].baseIncome);
      }
    }
  });
  it('bounds modifiers to ±30%', () => {
    expect(softMod(1e9, 1)).toBeLessThanOrEqual(1.3);
    expect(softMod(1e-9, 1)).toBeGreaterThanOrEqual(0.7);
    expect(softMod(5, 5)).toBe(1);
  });
  it('scales each generation by ×1000', () => {
    expect(genScale(2)).toBe(1e6);
    expect(CATALOG[1].scale / CATALOG[0].scale).toBe(1000);
  });
  it('prefers snapshot values over seeds unless pinned', () => {
    const seeds = [{ ...GENERATIONS[0], models: GENERATIONS[0].models.map((m, i) => (i === 0 ? { ...m, pin: ['speed' as const] } : m)) }];
    const id = seeds[0].models[0].aa;
    const cat = buildCatalog(seeds, { [id]: { iq: 99, speed: 1 } });
    const model = cat[0].models.find((m) => m.id === id)!;
    expect(model.iq).toBe(99);
    expect(model.speed).toBe(seeds[0].models[0].speed);
    expect(model.isFlagship).toBe(true);
  });
});

describe('prices', () => {
  it('grows each agent price ×1.15', () => {
    expect(bulkCost(first, 1, 1)).toBeCloseTo(first.baseCost * 1.15);
    expect(bulkCost(first, 0, 2)).toBeCloseTo(first.baseCost * 2.15);
  });
  it('computes max affordable consistently with bulk cost', () => {
    const tokens = 12345 * first.baseCost;
    const n = maxAffordable(first, 3, tokens);
    expect(bulkCost(first, 3, n)).toBeLessThanOrEqual(tokens);
    expect(bulkCost(first, 3, n + 1)).toBeGreaterThan(tokens);
  });
  it('refunds 25% on sell', () => {
    let s = buyAgents(rich(newGame(T0), 10_000), first.id, 10);
    const before = s.tokens;
    s = sellAgents(s, first.id, 10);
    expect(s.agents[first.id]).toBe(0);
    expect(s.tokens - before).toBeCloseTo(bulkCost(first, 0, 10) * 0.25);
  });
  it('refuses purchases the player cannot afford', () => {
    const s = newGame(T0);
    expect(buyAgents(s, first.id, 1)).toBe(s);
  });
});

describe('income and click', () => {
  it('sums agent income and advances tokens over time', () => {
    const s = buyAgents(rich(newGame(T0), 10_000), first.id, 10);
    expect(totalIncome(s)).toBeCloseTo(first.baseIncome * 10);
    const after = advance(s, 10);
    expect(after.tokens - s.tokens).toBeCloseTo(first.baseIncome * 100);
  });
  it('doubles model income per model upgrade', () => {
    let s = buyAgents(rich(newGame(T0)), first.id, 5);
    const base = totalIncome(s);
    s = buyUpgrade(s, modelUpgradeId(first.id, 0));
    s = buyUpgrade(s, modelUpgradeId(first.id, 1));
    expect(totalIncome(s)).toBeCloseTo(base * 4);
  });
  it('locks model upgrades until agent threshold', () => {
    const s = buyAgents(rich(newGame(T0)), first.id, 4);
    expect(buyUpgrade(s, modelUpgradeId(first.id, 1))).toBe(s);
  });
  it('applies lab synergy', () => {
    const lab = 'meta';
    const metaModels = g0.models.filter((m) => m.lab === lab);
    let s = rich(newGame(T0));
    s = buyAgents(s, metaModels[0].id, 10);
    s = buyAgents(s, metaModels[1].id, 10);
    const base = totalIncome(s);
    s = buyUpgrade(s, synergyUpgradeId(0, lab));
    expect(totalIncome(s)).toBeCloseTo(base * 1.2);
  });
  it('click gives 1 token in gen 1 and grows with click upgrades', () => {
    let s = newGame(T0);
    expect(clickValue(s)).toBe(1);
    s = click(s);
    expect(s.tokens).toBe(1);
    s = rich(s);
    s = buyUpgrade(s, clickUpgradeId(0, 0));
    expect(clickValue(s)).toBe(2);
  });
  it('compute adds +1% per unit', () => {
    const s = { ...buyAgents(rich(newGame(T0)), first.id, 10), compute: 50 };
    expect(totalIncome(s)).toBeCloseTo(first.baseIncome * 10 * 1.5);
  });
  it('shows click upgrades progressively', () => {
    const s = { ...newGame(T0), runTokens: 1e300 };
    const clicks = availableUpgrades(s).filter((u) => u.kind === 'click');
    expect(clicks.map((u) => u.id)).toEqual([clickUpgradeId(0, 0)]);
  });
});

describe('offline', () => {
  it('credits income for elapsed time capped at 8h', () => {
    const s = { ...buyAgents(rich(newGame(T0), 1e6), first.id, 1), lastTick: T0 };
    const inc = totalIncome(s);
    const r = applyOffline(s, T0 + 3600_000);
    expect(r.earned).toBeCloseTo(inc * 3600);
    const capped = applyOffline(s, T0 + 100 * 3600_000);
    expect(capped.seconds).toBe(8 * 3600);
  });
  it('extends the cap to 24h with the perk', () => {
    const s = { ...newGame(T0), perks: ['offline_24h'] };
    expect(applyOffline(s, T0 + 100 * 3600_000).seconds).toBe(24 * 3600);
  });
});

describe('prestige', () => {
  it('requires the flagship', () => {
    const s = rich(newGame(T0));
    expect(canPrestige(s)).toBe(false);
    expect(prestige(s, T0)).toBe(s);
  });
  it('moves to the next generation, grants compute and resets the run', () => {
    let s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    s = { ...s, upgrades: ['x'] };
    const gain = prestigeGain(s);
    expect(gain).toBe(Math.floor(Math.cbrt(1e15 / 1e5)));
    const p = prestige(s, T0 + 1);
    expect(p.generation).toBe(1);
    expect(p.compute).toBe(gain);
    expect(p.tokens).toBe(0);
    expect(p.agents).toEqual({});
    expect(p.upgrades).toEqual([]);
    expect(p.prestiges).toBe(1);
  });
  it('gives starting tokens scaled to the new generation with the perk', () => {
    const s = { ...buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1), perks: ['start_tokens'] };
    expect(prestige(s, T0).tokens).toBe(1000 * 1000);
  });
  it('stays in the last generation at the content finale', () => {
    const last = CATALOG.length - 1;
    let s: GameState = { ...newGame(T0), generation: last, maxGeneration: last };
    s = buyAgents(rich(s), CATALOG[last].flagship.id, 1);
    expect(isContentFinale(s)).toBe(true);
    expect(prestige(s, T0).generation).toBe(last);
  });
  it('buys perks with unspent compute only', () => {
    let s = { ...newGame(T0), compute: 4 };
    s = buyPerk(s, 'click_x2');
    expect(s.perks).toEqual(['click_x2']);
    expect(buyPerk(s, 'start_tokens')).toBe(s);
    expect(clickValue(s)).toBeCloseTo(2 * 1.04);
  });
});

describe('save', () => {
  it('round-trips through export/import', () => {
    const s = buyAgents(rich(newGame(T0), 1e9), first.id, 3);
    const back = importSave(exportSave(s), T0)!;
    expect(back.agents).toEqual(s.agents);
    expect(back.tokens).toBe(s.tokens);
  });
  it('drops unknown models and clamps generation', () => {
    const s = migrate({ version: 1, generation: 999, agents: { 'no-such-model': 5 }, upgrades: ['zzz'] }, T0);
    expect(s.generation).toBe(CATALOG.length - 1);
    expect(s.agents).toEqual({});
    expect(s.upgrades).toEqual([]);
  });
  it('returns a new game for garbage', () => {
    expect(migrate('nope', T0).tokens).toBe(0);
    expect(importSave('%%%', T0)).toBeNull();
  });
});

describe('format', () => {
  it('uses short scale suffixes', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1500)).toBe('1.500 K');
    expect(formatNumber(999999)).toBe('1.000 M');
    expect(formatNumber(2.5e9)).toBe('2.500 B');
    expect(formatNumber(1.23e15, 'sci')).toBe('1.23e15');
  });
});
describe('news and achievements', () => {
  it('picks relevant news without crashing', () => {
    const s = newGame(T0);
    const n = pickNews(s);
    expect(typeof n).toBe('string');
    expect(n.length).toBeGreaterThan(5);
  });

  it('triggers achievements when criteria met', () => {
    let s = newGame(T0);
    expect(newlyEarned(s)).toEqual([]);
    s = click(s);
    expect(newlyEarned(s)).toContain('click_1');
    s = { ...s, achievements: ['click_1'] };
    expect(newlyEarned(s)).not.toContain('click_1');
  });
});
