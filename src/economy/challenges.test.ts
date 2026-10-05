import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import {
  CHALLENGES,
  canStartChallenge,
  challengeIncomeMult,
  startChallenge,
} from './challenges';
import {
  advance,
  buyAgents,
  buyUpgrade,
  click,
  clickValue,
  globalMult,
  modelIncome,
  prestige,
  totalIncome,
} from './engine';
import { migrate } from './save';
import { newGame, SAVE_VERSION, type GameState } from './state';
import {
  SYNERGY_MIN_AGENTS,
  labAgents,
  modelUpgradeId,
  synergyUpgradeId,
  UPGRADES_BY_GEN,
  type Upgrade,
} from './upgrades';

const T0 = 1_000_000;
const g0 = CATALOG[0];
const first = g0.models[0];
const rich = (s: GameState, tokens = 1e50): GameState => ({ ...s, tokens, runTokens: tokens });
/** Свежий забег с выбранным Испытанием: стартовать можно только до первой покупки и клика. */
const challenged = (id: 'no-synergy' | 'no-click'): GameState =>
  startChallenge(newGame(T0), id);

describe('challenges table', () => {
  it('holds exactly two challenges with a +10% forever reward each', () => {
    expect(CHALLENGES.map((c) => c.id)).toEqual(['no-synergy', 'no-click']);
    for (const c of CHALLENGES) expect(c.rewardPct).toBe(10);
  });
});

describe('canStartChallenge', () => {
  it('allows a challenge only on a fresh run: no agents, no upgrades, no clicks', () => {
    expect(canStartChallenge(newGame(T0))).toBe(true);
    // Клик — уже не свежий забег, даже без покупок.
    expect(canStartChallenge(click(newGame(T0)))).toBe(false);
    // Агент — уже не свежий забег.
    expect(canStartChallenge(buyAgents(rich(newGame(T0)), first.id, 1))).toBe(false);
    // Апгрейд — уже не свежий забег.
    let s = buyAgents(rich(newGame(T0)), first.id, 10);
    s = buyUpgrade(s, modelUpgradeId(first.id, 0));
    expect(s.upgrades.length).toBe(1);
    expect(canStartChallenge(s)).toBe(false);
  });
});

describe('startChallenge', () => {
  it('sets the active challenge on a fresh run', () => {
    const s = startChallenge(newGame(T0), 'no-synergy');
    expect(s.activeChallenge).toBe('no-synergy');
  });
  it('returns the same object when the run is no longer fresh', () => {
    const s = click(newGame(T0));
    expect(startChallenge(s, 'no-click')).toBe(s);
    const hired = buyAgents(rich(newGame(T0)), first.id, 1);
    expect(startChallenge(hired, 'no-click')).toBe(hired);
  });
  it('returns the same object for an unknown id and for a no-op снять', () => {
    const fresh = newGame(T0);
    expect(startChallenge(fresh, 'unknown' as never)).toBe(fresh);
    // Снимать нечего: активного Испытания нет, и новый объект не нужен.
    expect(startChallenge(fresh, null)).toBe(fresh);
  });
});

describe('no-click enforcement', () => {
  it('pays zero for clicks but keeps counting them', () => {
    let s = buyAgents(rich(challenged('no-click')), first.id, 10);
    const before = s.tokens;
    expect(clickValue(s)).toBe(0);
    s = click(s);
    // Выплаты нет, а счётчики растут — по ним стор выдаёт реплики и пишет Переписку.
    expect(s.tokens).toBe(before);
    expect(s.clicks).toBe(1);
    expect(s.runClicks).toBe(1);
  });
  it('keeps passive income flowing while clicks pay nothing', () => {
    const s = buyAgents(rich(challenged('no-click')), first.id, 10);
    expect(totalIncome(s)).toBeGreaterThan(0);
    expect(clickValue(s)).toBe(0);
  });
  it('gives autoclicks no income while still counting them', () => {
    const hired = buyAgents(rich(challenged('no-click')), first.id, 10);
    const withBot: GameState = { ...hired, perks: ['autoclick'] };
    const plain = advance({ ...hired, perks: [] }, 1);
    const auto = advance(withBot, 1);
    // Автоклик в Испытании не доплачивает: Токенов ровно столько же, сколько без него.
    expect(auto.tokens).toBe(plain.tokens);
    expect(auto.runClicks).toBe(1);
    expect(plain.runClicks).toBe(0);
  });
});

describe('no-synergy enforcement', () => {
  it('holds the lab synergy multiplier at 1 while model upgrades still apply', () => {
    const lab = first.lab;
    let s = buyAgents(rich(challenged('no-synergy')), first.id, SYNERGY_MIN_AGENTS);
    const plain = modelIncome(s, first);
    s = buyUpgrade(s, synergyUpgradeId(0, lab));
    expect(s.upgrades.length).toBe(1);
    // Апгрейд куплен, но в Испытании он молчит: Доход тот же, что без него.
    expect(modelIncome(s, first)).toBe(plain);
    // А обычный Апгрейд Модели ×2 в Испытании работает: испытание отменяет Синергии, а не всё.
    const doubled = buyUpgrade(s, modelUpgradeId(first.id, 0));
    expect(modelIncome(doubled, first)).toBe(plain * 2);
  });
  it('holds the pair synergy multiplier at 1', () => {
    type PairSynergy = Extract<Upgrade, { kind: 'synergy' }> & { pairLab: NonNullable<Extract<Upgrade, { kind: 'synergy' }>['pairLab']> };
    const pair = UPGRADES_BY_GEN[0].find(
      (u): u is PairSynergy => u.kind === 'synergy' && u.pairLab !== undefined,
    )!;
    const cheapest = (lab: string) =>
      g0.models.filter((m) => m.lab === lab).sort((a, b) => a.baseCost - b.baseCost)[0];
    const a = cheapest(pair.lab);
    const b = cheapest(pair.pairLab);
    let s = challenged('no-synergy');
    s = buyAgents(rich(s), a.id, SYNERGY_MIN_AGENTS);
    s = buyAgents(s, b.id, SYNERGY_MIN_AGENTS);
    expect(labAgents(s, pair.lab)).toBeGreaterThanOrEqual(SYNERGY_MIN_AGENTS);
    const plain = modelIncome(s, a);
    s = buyUpgrade(s, pair.id);
    expect(s.upgrades.length).toBe(1);
    expect(modelIncome(s, a)).toBe(plain);
  });
});

describe('challengeIncomeMult', () => {
  it('pays +10% per closed challenge, deduplicated', () => {
    expect(challengeIncomeMult(newGame(T0))).toBe(1);
    expect(challengeIncomeMult({ ...newGame(T0), challengesDone: ['no-synergy'] })).toBeCloseTo(1.1);
    expect(challengeIncomeMult({ ...newGame(T0), challengesDone: ['no-synergy', 'no-click'] })).toBeCloseTo(1.2);
    // Дубль не платит дважды.
    expect(challengeIncomeMult({ ...newGame(T0), challengesDone: ['no-click', 'no-click'] })).toBeCloseTo(1.1);
  });
  it('is wired into globalMult next to the compute and crystal multipliers', () => {
    const s = newGame(T0);
    expect(globalMult({ ...s, challengesDone: ['no-synergy'] })).toBeCloseTo(globalMult(s) * 1.1);
    expect(globalMult({ ...s, challengesDone: ['no-synergy', 'no-click'] })).toBeCloseTo(globalMult(s) * 1.2);
  });
});

describe('prestige closes challenges', () => {
  it('writes the active challenge into challengesDone and clears it', () => {
    let s = buyAgents(rich(challenged('no-click')), g0.flagship.id, 1);
    const p = prestige(s, T0 + 1);
    expect(p.challengesDone).toEqual(['no-click']);
    expect(p.activeChallenge).toBe(null);
  });
  it('never pays the same challenge twice', () => {
    let s: GameState = {
      ...buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1),
      activeChallenge: 'no-click',
      challengesDone: ['no-click'],
    };
    expect(prestige(s, T0 + 1).challengesDone).toEqual(['no-click']);
  });
  it('leaves challengesDone alone without an active challenge', () => {
    const s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    const p = prestige(s, T0 + 1);
    expect(p.challengesDone).toEqual([]);
    expect(p.activeChallenge).toBe(null);
  });
  it('kills the live event with the run but keeps the quips collection', () => {
    let s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    s = {
      ...s,
      event: { kind: 'hype', startedAt: T0, red: true },
      eventCaughtAt: T0,
      nextEventAt: T0 + 600_000,
      combo: 3,
      quipsSeen: ['q1'],
    };
    const p = prestige(s, T0 + 1);
    // Живое событие прошлого забега в новый не переезжает: иначе новый забег стартовал бы
    // с чужим бонусом или красным штрафом. Переписка переживает — коллекция на всю игру.
    expect(p.event).toBe(null);
    expect(p.eventCaughtAt).toBe(0);
    expect(p.nextEventAt).toBe(0);
    expect(p.combo).toBe(0);
    expect(p.quipsSeen).toEqual(['q1']);
  });
});

describe('challenges save contract', () => {
  it('upgrades a v5 save to v6 with challenge defaults', () => {
    const s = migrate({ version: 5, tokens: 500 }, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.tokens).toBe(500);
    expect(s.activeChallenge).toBe(null);
    expect(s.challengesDone).toEqual([]);
  });
  it('keeps challenge ids like achievements: strings only, no catalog check, deduped', () => {
    const s = migrate(
      { version: 6, activeChallenge: 'no-click', challengesDone: ['no-click', 'no-click', 'custom'] },
      T0,
    );
    expect(s.activeChallenge).toBe('no-click');
    expect(s.challengesDone).toEqual(['no-click', 'custom']);
    // Мусор вместо полей читается как «обычный забег без закрытых», а не как ограничение.
    expect(migrate({ version: 6, activeChallenge: 42, challengesDone: 'nope' }, T0).activeChallenge).toBe(null);
    expect(migrate({ version: 6, challengesDone: 'nope' }, T0).challengesDone).toEqual([]);
  });
});
