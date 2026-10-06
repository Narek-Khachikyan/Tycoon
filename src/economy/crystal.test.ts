import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { buyAgents, offlineIncome, shatterCrystal } from './engine';
import { collectCrystals, CRYSTAL_CYCLE_MS, crystalCycleMs, crystalIncomeMult } from './crystal';
import { newGame, type GameState } from './state';

const T0 = 1_000_000;
const first = CATALOG[0].models[0];
const rich = (s: GameState, tokens = 1e50): GameState => ({ ...s, tokens, runTokens: tokens });

describe('shatterCrystal', () => {
  it('returns the same object without a whole crystal', () => {
    const s = newGame(T0);
    expect(shatterCrystal(s)).toBe(s);
    // Дробного кристалла не бывает: запас — счётчик, а не доля.
    const frac = { ...s, crystals: 0.9 };
    expect(shatterCrystal(frac)).toBe(frac);
  });
  it('spends one crystal and injects max(hourly income, 15% of wallet) into all three counters', () => {
    let s = buyAgents(rich(newGame(T0), 1e6), first.id, 10);
    s = { ...s, tokens: 1000, crystals: 3 };
    const expected = Math.max(offlineIncome(s) * 3600, 1000 * 0.15);
    expect(expected).toBeGreaterThan(0);
    const after = shatterCrystal(s);
    expect(after.crystals).toBe(2);
    expect(after.tokens).toBe(1000 + expected);
    expect(after.runTokens).toBe(s.runTokens + expected);
    expect(after.totalTokens).toBe(s.totalTokens + expected);
  });
  it('pays 15% of the wallet when there is no income yet', () => {
    // Старт забега: Дохода нет, а кристалл с прошлого забега пережил Престиж.
    const s: GameState = { ...newGame(T0), tokens: 1000, crystals: 1 };
    expect(offlineIncome(s)).toBe(0);
    const after = shatterCrystal(s);
    expect(after.crystals).toBe(0);
    expect(after.tokens).toBe(1150);
    expect(after.runTokens).toBe(150);
    expect(after.totalTokens).toBe(150);
  });
  it('drops the forever bonus together with the payout', () => {
    const s: GameState = { ...newGame(T0), crystals: 5 };
    const after = shatterCrystal(s);
    expect(crystalIncomeMult(after)).toBeLessThan(crystalIncomeMult(s));
    expect(crystalIncomeMult(after)).toBeCloseTo(1.04);
  });
  it('still spends the crystal when the payout is zero', () => {
    const s: GameState = { ...newGame(T0), crystals: 1, tokens: 0 };
    const after = shatterCrystal(s);
    expect(after).not.toBe(s);
    expect(after.crystals).toBe(0);
    expect(after.tokens).toBe(0);
  });
});

describe('foreign crystal ids', () => {
  it('keeps the cycle numeric when the upgrade list holds a prototype key', () => {
    // 'toString' с прототипа — truthy-функция без cycleMs: Math.min с undefined ронял цикл
    // в NaN, и кристалл «дозревал» каждый тик. Белый список в save.ts таких id уже режет,
    // но цикл обязан оставаться числом при любом содержимом списка.
    const s: GameState = { ...newGame(T0), crystalUpgrades: ['toString', '__proto__', 'constructor'] };
    expect(crystalCycleMs(s)).toBe(CRYSTAL_CYCLE_MS);
    const planted = { ...s, crystalPlantedAt: T0 };
    // Цикл не прошёл — сбора нет: NaN-цикл собирал бы здесь бесплатный кристалл.
    expect(collectCrystals(planted, T0 + 1000).grown).toBe(0);
  });
});
