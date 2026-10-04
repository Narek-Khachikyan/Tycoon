import { describe, expect, it } from 'vitest';
import { buildCatalog, CATALOG, genScale, softMod } from './catalog';
import {
  advance, advanceTime, applyOffline, bulkCost, buyAgents, buyPerk, buyUpgrade, canPrestige, click, clickValue,
  incomeGain, isContentFinale, labIncomeShare, maxAffordable, modelIncome, prestige, prestigeGain, sellAgents, totalIncome,
} from './engine';
import { newGame, SAVE_VERSION, type GameState } from './state';
import { exportSave, importSave, migrate } from './save';
import { pickNews } from './news';
import { ACHIEVEMENTS, awardAchievements, newlyEarned } from './achievements';
import {
  availableUpgrades, clickUpgradeId, labTopTier, labWork, modelUpgradeId, MODEL_TIERS, synergyUpgradeId,
} from './upgrades';
import { formatCount, formatNumber } from './format';
import { GENERATIONS } from '../data/generations';
import { LAB_IDS } from '../data/labs';

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
  // Инвариант перехода: Флагман следующего Поколения бьёт Флагмана текущего. Масштаб ×1000
  // перевешивает лестницу Ранга ×6.5 ровно на три ступени, поэтому разница числа Моделей
  // между соседними Поколениями не может быть меньше −3: 5 Моделей против 9 как раз ломали
  // переход 6→7.
  it('makes each generation flagship strictly stronger than the previous', () => {
    for (let i = 0; i < CATALOG.length - 1; i++) {
      expect(CATALOG[i + 1].flagship.baseIncome).toBeGreaterThan(CATALOG[i].flagship.baseIncome);
    }
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
  it('reports the marginal income of a purchase as the total income it actually adds', () => {
    const s = buyAgents(rich(newGame(T0)), first.id, 10);
    const after = buyAgents(s, first.id, 5);
    // Подпись обязана совпадать с тем, что сделает покупка, поэтому сверяем её с настоящей
    // разницей общего Дохода, а не с отдельной формулой.
    expect(incomeGain(s, first.id, 5)).toBeCloseTo(totalIncome(after) - totalIncome(s));
  });
  it('reports a marginal income that includes synergy across the whole lab', () => {
    const lab = 'meta';
    const metaModels = g0.models.filter((m) => m.lab === lab);
    let s = buyAgents(rich(newGame(T0)), metaModels[0].id, 10);
    s = buyAgents(s, metaModels[1].id, 10);
    s = buyUpgrade(s, synergyUpgradeId(0, lab));
    const after = buyAgents(s, metaModels[0].id, 5);
    const gain = incomeGain(s, metaModels[0].id, 5);
    expect(gain).toBeCloseTo(totalIncome(after) - totalIncome(s));
    // Соседняя Модель той же Лаборатории тоже дорожает: её Доход умножается на общий счётчик
    // Агентов, поэтому прирост больше вклада только купленных Агентов.
    const own = modelIncome(after, metaModels[0]) - modelIncome(s, metaModels[0]);
    expect(modelIncome(after, metaModels[1])).toBeGreaterThan(modelIncome(s, metaModels[1]));
    expect(gain).toBeGreaterThan(own);
  });
  it('scales the marginal income with the purchase amount and ignores empty ones', () => {
    const s = buyAgents(rich(newGame(T0)), first.id, 10);
    expect(incomeGain(s, first.id, 10)).toBeCloseTo(10 * incomeGain(s, first.id, 1));
    expect(incomeGain(s, first.id, 0)).toBe(0);
    // Модель не из текущего Поколения в общий Доход не входит, поэтому и подписи у неё нет.
    expect(incomeGain(s, CATALOG[1].models[0].id, 3)).toBe(0);
    expect(incomeGain(s, 'no-such-model', 3)).toBe(0);
  });
  it('leaves the input state untouched when measuring a marginal income', () => {
    const s = buyAgents(rich(newGame(T0)), first.id, 10);
    const before = { ...s.agents };
    incomeGain(s, first.id, 7);
    expect(s.agents).toEqual(before);
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

describe('lab readout', () => {
  it('splits the income of every generation so the roster covers all of it', () => {
    // Доли обязаны дать единицу в каждом Поколении, иначе строка ростера показывала бы
    // Лабораторию, будто она не приносит Доход. Нулевая доля допустима только у
    // Лаборатории, у которой в этом Поколении нет ни одной Модели.
    for (let g = 0; g < CATALOG.length; g++) {
      let s = rich({ ...newGame(T0), generation: g }, 1e300);
      for (const m of CATALOG[g].models) s = buyAgents(s, m.id, 1);
      const shares = LAB_IDS.map((l) => labIncomeShare(s, l));
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
      for (const l of LAB_IDS) {
        const inRoster = CATALOG[g].models.some((m) => m.lab === l);
        expect(shares[LAB_IDS.indexOf(l)] > 0).toBe(inRoster);
      }
    }
  });
  it('reads a lab without agents as zero rather than NaN', () => {
    const s = newGame(T0);
    for (const l of LAB_IDS) {
      expect(labIncomeShare(s, l)).toBe(0);
      expect(Number.isNaN(labIncomeShare(s, l))).toBe(false);
    }
  });
  it('reports the highest model upgrade bought in a lab', () => {
    const meta = g0.models.filter((m) => m.lab === 'meta');
    let s = buyAgents(rich(newGame(T0)), meta[0].id, 5);
    s = buyAgents(s, meta[1].id, 5);
    // Агенты есть, но Апгрейда Модели ещё нет: работа Лаборатории не начата.
    expect(labTopTier(s, 'meta')).toBe(-1);
    expect(labWork(s, 'meta')).toBe('');
    s = buyUpgrade(s, modelUpgradeId(meta[0].id, 0));
    s = buyUpgrade(s, modelUpgradeId(meta[1].id, 1));
    expect(labTopTier(s, 'meta')).toBe(1);
    expect(labWork(s, 'meta')).toBe(MODEL_TIERS[1].name);
    // Агенты без Апгрейда Модели остаются без работы.
    const google = g0.models.find((m) => m.lab === 'google')!;
    s = buyAgents(s, google.id, 3);
    expect(labTopTier(s, 'google')).toBe(-1);
    expect(labWork(s, 'google')).toBe('');
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
  it('advance moves lastTick so the same interval is never paid twice', () => {
    const s = { ...buyAgents(rich(newGame(T0), 1e6), first.id, 1), lastTick: T0 };
    const after = advance(s, 600);
    expect(after.lastTick).toBe(T0 + 600_000);
    // Активный интервал уже учтён в advance — оффлайн-начисление за него обязано быть нулевым.
    expect(applyOffline(after, after.lastTick).earned).toBe(0);
  });
  it('counts autoclicks in click statistics', () => {
    const s = { ...rich(newGame(T0), 1e6), lastTick: T0, perks: ['autoclick'] };
    const after = advance(s, 10);
    expect(after.clicks - s.clicks).toBeCloseTo(10);
    expect(after.runClicks - s.runClicks).toBeCloseTo(10);
  });
  it('caps a background pause with a backgrounded tab or sleep', () => {
    const s = { ...buyAgents(rich(newGame(T0), 1e6), first.id, 1), lastTick: T0 };
    const inc = totalIncome(s);
    // 48ч простоя не должны начислиться как активная игра: срабатывает лимит оффлайна.
    const after = advanceTime(s, 48 * 3600);
    expect(after.tokens - s.tokens).toBeCloseTo(inc * 8 * 3600);
    // lastTick синхронизирован с реальным временем, поэтому простой
    // нельзя доначислить повторно ни в этом тике, ни при следующей перезагрузке.
    expect(after.lastTick).toBe(T0 + 48 * 3600_000);
    expect(applyOffline(after, after.lastTick).seconds).toBe(0);
  });
  it('honours the raised offline cap after a long pause', () => {
    const s = {
      ...buyAgents(rich({ ...newGame(T0), perks: ['offline_24h'] }, 1e6), first.id, 1),
      lastTick: T0,
    };
    const inc = totalIncome(s);
    expect(advanceTime(s, 48 * 3600).tokens - s.tokens).toBeCloseTo(inc * 24 * 3600);
  });
  it('still advances normally on short frames', () => {
    const s = buyAgents(rich(newGame(T0), 1e6), first.id, 1);
    const after = advanceTime(s, 0.05);
    expect(after.tokens - s.tokens).toBeCloseTo(totalIncome(s) * 0.05);
    expect(advanceTime(s, -1)).toBe(s);
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
  it('does not wipe the run at the content finale', () => {
    const last = CATALOG.length - 1;
    let s: GameState = { ...newGame(T0), generation: last, maxGeneration: last, runTokens: 1e12 };
    s = buyAgents(rich(s), CATALOG[last].flagship.id, 1);
    expect(prestige(s, T0)).toBe(s);
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
  it('rejects fractional generation indexes on import', () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o));
    expect(importSave(b64({ version: 1, generation: 0.5 }), T0)).toBeNull();
    expect(importSave(b64({ version: 1, generation: 0, maxGeneration: 0.5 }), T0)).toBeNull();
    expect(importSave(b64({ version: 1, generation: 0, maxGeneration: 99 }), T0)).toBeNull();
    expect(importSave(b64({ version: 1, generation: 0, maxGeneration: 0 }), T0)).not.toBeNull();
  });
  it('always produces whole generation indexes, even from a corrupt save', () => {
    const s = migrate({ version: 1, generation: 0.5, maxGeneration: 1.5 }, T0);
    expect(Number.isInteger(s.generation)).toBe(true);
    expect(Number.isInteger(s.maxGeneration)).toBe(true);
    expect(CATALOG[s.maxGeneration]).toBeDefined();
  });
  it('deduplicates perks so an import cannot double-apply them', () => {
    const s = migrate({ version: 1, perks: ['click_x2', 'click_x2'] }, T0);
    expect(s.perks).toEqual(['click_x2']);
    // ×2, а не ×4 из-за двух одинаковых записей.
    expect(clickValue(s)).toBeCloseTo(2);
  });
  it('drops unknown and duplicate upgrade ids', () => {
    const s = migrate({ version: 1, upgrades: ['zzz', 'c:0:0', 'c:0:0'] }, T0);
    expect(s.upgrades).toEqual(['c:0:0']);
  });
  it('upgrades a v1 save to the current version without touching progress', () => {
    const s = migrate(
      {
        version: 1,
        tokens: 1234,
        totalTokens: 5678,
        agents: { [first.id]: 7 },
        upgrades: ['c:0:0'],
        compute: 3,
        lastTick: T0 - 5000,
        settings: { notation: 'sci', muted: true },
      },
      T0,
    );
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.settings).toEqual({ notation: 'sci', muted: true, reducedMotion: false });
    expect(s.tokens).toBe(1234);
    expect(s.totalTokens).toBe(5678);
    expect(s.agents).toEqual({ [first.id]: 7 });
    expect(s.upgrades).toEqual(['c:0:0']);
    expect(s.compute).toBe(3);
    expect(s.lastTick).toBe(T0 - 5000);
  });
  it('defaults reduced motion to off for a new game and for a save without settings', () => {
    expect(newGame(T0).settings.reducedMotion).toBe(false);
    expect(migrate({ version: 1 }, T0).settings.reducedMotion).toBe(false);
  });
  it('keeps the reduced motion preference through export/import', () => {
    const s = newGame(T0);
    const back = importSave(exportSave({ ...s, settings: { ...s.settings, reducedMotion: true } }), T0)!;
    expect(back.settings.reducedMotion).toBe(true);
  });
  it('coerces a corrupt reduced motion value to a boolean', () => {
    expect(migrate({ version: 2, settings: { reducedMotion: 'да' } }, T0).settings.reducedMotion).toBe(true);
    expect(migrate({ version: 2, settings: { reducedMotion: 0 } }, T0).settings.reducedMotion).toBe(false);
  });
});

describe('format', () => {
  it('uses short scale suffixes with a Russian decimal comma', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(0.5)).toBe('0,5');
    expect(formatNumber(1500)).toBe('1,50 K');
    expect(formatNumber(1729)).toBe('1,73 K');
    expect(formatNumber(999999)).toBe('1,00 M');
    expect(formatNumber(2.5e9)).toBe('2,50 B');
    expect(formatNumber(1.23e15, 'sci')).toBe('1.23e15');
  });

  it('keeps sci notation with a dot while short uses a comma', () => {
    expect(formatNumber(1729, 'sci')).toBe('1.73e3');
    expect(formatNumber(1500, 'sci')).toContain('.');
    expect(formatNumber(1500)).not.toContain('.');
    // Выход «меньше тысячи» стоит до ветвления по нотации, поэтому запятая не должна
    // просачиваться в научную запись и на нём.
    expect(formatNumber(0.5, 'sci')).toBe('0.5');
    expect(formatNumber(0.5)).toBe('0,5');
  });

  it('never uses a dot as a decimal separator and keeps at most two decimals', () => {
    // Значения внутри лестницы суффиксов: за её пределом формат возвращается к sci,
    // где точка обязательна.
    const values = [0.5, 9.9, 999, 1000, 1500, 1729, 12345, 999999, 2.5e9, 1.23e15, 1e27, 4.567e60];
    for (const v of values) {
      const out = formatNumber(v);
      expect(out).not.toContain('.');
      const frac = out.split(',')[1];
      if (frac !== undefined) expect(frac.split(' ')[0].length).toBeLessThanOrEqual(2);
    }
  });

  it('declines agent counts in Russian', () => {
    const agent = (n: number) => formatCount(n, 'Агент', 'Агента', 'Агентов');
    expect(agent(0)).toBe('Агентов');
    expect(agent(1)).toBe('Агент');
    expect(agent(2)).toBe('Агента');
    expect(agent(4)).toBe('Агента');
    expect(agent(5)).toBe('Агентов');
    // 11–14 живут по правилу десятков, а не хвоста: «11 Агентов», но «21 Агент».
    expect(agent(11)).toBe('Агентов');
    expect(agent(12)).toBe('Агентов');
    expect(agent(14)).toBe('Агентов');
    expect(agent(21)).toBe('Агент');
    expect(agent(22)).toBe('Агента');
    expect(agent(25)).toBe('Агентов');
    expect(agent(101)).toBe('Агент');
    expect(agent(111)).toBe('Агентов');
    expect(agent(-1)).toBe('Агент');
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

  it('awards achievements into the state exactly once', () => {
    const clicked = click(newGame(T0));
    const first = awardAchievements(clicked);
    expect(first.awarded).toContain('click_1');
    expect(first.state.achievements).toContain('click_1');
    // Повторный переход не должен начислять то же Достижение второй раз.
    const second = awardAchievements(first.state);
    expect(second.awarded).toEqual([]);
    expect(second.state).toBe(first.state);
  });

  it('awards agent achievements from a purchase transition', () => {
    const hired = buyAgents(rich(newGame(T0), 1e6), first.id, 1);
    expect(newlyEarned(hired)).toContain('agents_1');
    expect(awardAchievements(hired).state.achievements).toContain('agents_1');
  });

  it('awards every achievement from a single maximal run, and nothing on a second pass', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    // id Достижения входит в поверхность сохранения: дубль осиротит запись, пустое имя — экран.
    expect(new Set(ids).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.filter((a) => a.name.length === 0)).toEqual([]);

    // Прогон до последнего Поколения: Престиж требует Агента-флагмана того Поколения, откуда уходит.
    let s = newGame(T0);
    for (let g = 0; g < CATALOG.length - 1; g++) s = prestige(buyAgents(rich(s), CATALOG[g].flagship.id, 1), T0);
    expect(s.generation).toBe(CATALOG.length - 1);

    // Финальный Забег: Агент каждой Модели («Полный зоопарк») и 250 Агентов флагмана,
    // плюс Апгрейд, Перк и 10 000 Кликов — остальные условия. Бюджет берётся с запасом:
    // пачка растёт как 1.15^n, и 250 Агентов флагмана последнего Поколения стоят дороже
    // прежнего 1e50.
    s = rich(s, 1e300);
    for (const m of CATALOG[s.generation].models) s = buyAgents(s, m.id, m.isFlagship ? 250 : 1);
    s = buyUpgrade(s, clickUpgradeId(s.generation, 0));
    s = buyPerk(s, 'click_x2');
    for (let i = 0; i < 10_000; i++) s = click(s);

    expect([...newlyEarned(s)].sort()).toEqual([...ids].sort());
    const first = awardAchievements(s);
    expect([...first.awarded].sort()).toEqual([...ids].sort());

    // Второй проход — тоже контракт стор-а: не только пустой список, но и тот же самый объект.
    const second = awardAchievements(first.state);
    expect(second.awarded).toEqual([]);
    expect(second.state).toBe(first.state);

    const firstAgent = ACHIEVEMENTS.find((a) => a.id === 'agents_1')!;
    expect(firstAgent.name).toContain('Агент');
    expect(firstAgent.name).not.toContain('сотрудник');
  });
});
