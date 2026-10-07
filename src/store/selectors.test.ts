import { describe, expect, it } from 'vitest';
import { shallow } from 'zustand/shallow';
import { CATALOG, LAST_GENERATION } from '../economy/catalog';
import {
  advanceTime,
  bulkCost,
  buyAgents,
  buyUpgrade,
  clickValue,
  maxAffordable,
  nextAgentCost,
  prestige,
  sellRefund,
  totalIncome,
} from '../economy/engine';
import { formatCount, formatDuration, formatNumber } from '../economy/format';
import { canPrestige, isContentFinale, labIncomeShare, prestigeGain } from '../economy/engine';
import { LAB_IDS } from '../data/labs';
import { CRYSTAL_UPGRADES, crystalCycleMs, crystalIncomeMult } from '../economy/crystal';
import {
  canLicense,
  canPledge,
  glitchDrainMult,
  licenseCost,
  pledgeCost,
  revokeCost,
} from '../economy/glitches';
import { newGame, type GameState } from '../economy/state';
import { availableUpgrades } from '../economy/upgrades';
import { OVERHEAT_STUN_SEC, TEMP_MAX, thermalRead } from '../economy/thermal';
import { MILESTONES } from '../economy/milestones';
import {
  availableUpgradesOf,
  clickButtonView,
  crystalGrowthView,
  crystalStockView,
  crystalUpgradeView,
  droneView,
  glitchBandView,
  glitchesOf,
  incomeView,
  labShareView,
  milestoneView,
  modelView,
  pledgeView,
  prestigeCardView,
  purchaseProgressView,
  sparksView,
  thermalTone,
  thermalView,
  upgradeView,
} from './selectors';

const T0 = 1_700_000_000_000;
const FAR = 4e12;

const rich = (s: GameState, tokens: number): GameState => ({ ...s, tokens, runTokens: tokens });

/**
 * Позднее Поколение, каким его видит игрок: все Поколения пройдены Престижами, у каждой Модели
 * Поколения 7 по 300 Агентов, куплено всё доступное. Температура на нуле, а Событий и Глюков в
 * окне замера нет: тест проверяет, что тик сам по себе ничего не меняет на экране.
 */
const buildLateGame = (): GameState => {
  const gen = LAST_GENERATION - 1;
  let s = newGame(T0);
  for (let g = 0; g < gen; g++) {
    s = prestige(buyAgents(rich(s, 1e50), CATALOG[g].flagship.id, 1), T0 + g * 1000);
  }
  for (const m of CATALOG[gen].models) s = buyAgents(rich(s, 1e300), m.id, 300);
  for (let pass = 0; pass < 4; pass++) {
    for (const u of availableUpgrades(s)) s = buyUpgrade(rich(s, 1e300), u.id);
  }
  return { ...rich(s, 3e30), temp: 0, heat: 0, nextEventAt: FAR, nextGlitchAt: FAR };
};

/** Состояния неизменяемы, поэтому собранный Забег переиспользуется: сборка идёт через Престиж на каждое Поколение. */
let lateCache: GameState | null = null;
const lateGame = (): GameState => (lateCache ??= buildLateGame());

/** Простой: тики по 50 мс без единого действия игрока, как их гоняет App.tsx. */
const idle = (from: GameState, ticks: number): GameState[] => {
  const states: GameState[] = [from];
  let s = from;
  for (let i = 0; i < ticks; i++) {
    s = advanceTime(s, 0.05, () => 0.99);
    states.push(s);
  }
  return states;
};

/** Сколько раз срез изменился бы для подписчика: ровно так считает useShallow в React. */
const changes = <T>(states: GameState[], view: (s: GameState) => T): number => {
  let n = 0;
  let prev = view(states[0]);
  for (const s of states.slice(1)) {
    const next = view(s);
    if (!shallow(prev, next)) n++;
    prev = next;
  }
  return n;
};

describe('click column slices', () => {
  it('shows the income the engine pays, in the player notation', () => {
    const late = lateGame();
    expect(incomeView(late).text).toBe(formatNumber(totalIncome(late), 'short'));
    const sci = { ...late, settings: { ...late.settings, notation: 'sci' as const } };
    expect(incomeView(sci).text).toBe(formatNumber(totalIncome(sci), 'sci'));
  });

  it('knows a run with no income yet', () => {
    expect(incomeView(newGame(T0)).zero).toBe(true);
    expect(incomeView(lateGame()).zero).toBe(false);
  });

  it('prints the click reward and its noun the way the button always did', () => {
    for (const s of [newGame(T0), lateGame()]) {
      const reward = clickValue(s, totalIncome(s));
      const view = clickButtonView(s);
      expect(view.value).toBe(formatNumber(reward, 'short', 'price'));
      expect(view.word).toBe(formatCount(reward, 'Токен', 'Токена', 'Токенов', 'short', 'price'));
    }
  });

  it('grows the click halo with the office', () => {
    expect(clickButtonView(newGame(T0)).tier).toBe(0);
    expect(clickButtonView(newGame(T0)).power).toBe('0.00');
    expect(clickButtonView(lateGame()).tier).toBe(4);
  });

  it('shows how far the next hire is, from the engine price', () => {
    const s = rich(newGame(T0), nextAgentCost(newGame(T0)) / 2);
    const view = purchaseProgressView(s);
    expect(view.canHire).toBe(false);
    expect(view.now).toBe(50);
    expect(view.missingText).toBe(formatNumber(Math.ceil(nextAgentCost(s) - s.tokens), 'short'));
    const ready = purchaseProgressView(rich(newGame(T0), 1e9));
    expect(ready.canHire).toBe(true);
    expect(ready.now).toBe(100);
    expect(ready.missingText).toBe('');
  });

  it('leaves every click column slice alone while nothing happens in a late run', () => {
    const states = idle(lateGame(), 200);
    expect(changes(states, incomeView)).toBe(0);
    expect(changes(states, clickButtonView)).toBe(0);
    expect(changes(states, purchaseProgressView)).toBeLessThanOrEqual(1);
  });

  it('does not repaint the progress bar for a sub-pixel move', () => {
    const base = rich(newGame(T0), nextAgentCost(newGame(T0)) * 0.4);
    const nudged = rich(newGame(T0), nextAgentCost(newGame(T0)) * 0.4 + 1e-6);
    expect(shallow(purchaseProgressView(base), purchaseProgressView(nudged))).toBe(true);
    const moved = rich(newGame(T0), nextAgentCost(newGame(T0)) * 0.5);
    expect(shallow(purchaseProgressView(base), purchaseProgressView(moved))).toBe(false);
  });
});

describe('temperature slices', () => {
  const heated = (heat: number, temp = 0.9): GameState => ({ ...lateGame(), temp, heat });

  it('reads the dial from the same numbers the engine pays by', () => {
    for (const s of [lateGame(), heated(0.3), heated(0.8, TEMP_MAX)]) {
      const read = thermalRead(s);
      const view = thermalView(s);
      expect(view.temp).toBe(read.temp);
      expect(view.mult).toBe(formatNumber(read.mult, 'short'));
      expect(view.valueText).toBe(
        `${read.temp.toFixed(2)} из ${TEMP_MAX}, Доход ×${read.mult.toFixed(2)}, ${view.status}`,
      );
    }
  });

  it('names the heat state in words, not only in colour', () => {
    expect(thermalView(heated(0)).status).toBe('Стабильно');
    expect(thermalView(heated(0.5)).status).toBe('Копится перегрев');
    expect(thermalView(heated(0.8)).status).toBe('Почти перегрев');
    const stunned = { ...heated(0), overheatedAt: T0 + 1_000, lastTick: T0 + 2_000 };
    expect(thermalView(stunned).status).toBe('Перегрев: Доход падает');
  });

  it('tells what the player risks at this heat', () => {
    expect(thermalView(heated(0, 0)).risk).toBe('риска нет');
    expect(thermalView(heated(0.2, 1)).risk).toMatch(/^галлюцинации \d+\/мин$/);
    expect(thermalView(heated(0.7)).risk).toBe('перегрев 70%');
    expect(thermalView(heated(0.7)).riskHot).toBe(true);
    expect(thermalView(heated(0.5)).riskHot).toBe(false);
  });

  it('sets the root tone from heat and from the stun after an overheat', () => {
    expect(thermalTone(heated(0))).toBe('calm');
    expect(thermalTone(heated(0.6))).toBe('hot');
    const justOverheated = { ...heated(0), overheatedAt: T0 + 1_000, lastTick: T0 + 1_000 + 100 };
    expect(thermalTone(justOverheated)).toBe('stunned');
    const recovered = { ...justOverheated, lastTick: T0 + 1_000 + OVERHEAT_STUN_SEC * 1000 + 1 };
    expect(thermalTone(recovered)).toBe('calm');
  });

  it('shows sparks in three steps and none while the office is cool', () => {
    expect(sparksView(heated(0.1)).count).toBe(0);
    expect(sparksView(heated(0.3)).count).toBe(4);
    expect(sparksView(heated(0.7)).count).toBe(9);
    expect(sparksView(heated(0.7)).hot).toBe(true);
    expect(sparksView(heated(0.3)).hot).toBe(false);
  });

  it('keeps the dial and sparks still while the scale rests', () => {
    const states = idle(lateGame(), 200);
    expect(changes(states, thermalView)).toBe(0);
    expect(changes(states, sparksView)).toBe(0);
    expect(changes(states, thermalTone)).toBe(0);
  });

  it('moves the heat bar only as fast as the player can see it move', () => {
    const states = idle({ ...lateGame(), temp: 0.45 }, 100);
    const moved = changes(states, thermalView);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(20);
  });
});

describe('milestone strip slice', () => {
  it('points at the first goal that is not claimed and prints its reward', () => {
    const view = milestoneView(newGame(T0));
    expect(view.current?.id).toBe(MILESTONES[0].id);
    expect(view.reward).toBe(formatNumber(MILESTONES[0].units * CATALOG[0].scale, 'short'));
    expect(milestoneView({ ...newGame(T0), milestones: MILESTONES.map((m) => m.id) }).current).toBeNull();
  });

  it('stays put while the run idles', () => {
    expect(changes(idle(lateGame(), 100), milestoneView)).toBe(0);
  });
});

describe('shop model card slice', () => {
  const g0 = CATALOG[0];
  const first = g0.models[0];
  const START_DISCOUNT = 0.7;

  it('offers the first Agent at the opening discount', () => {
    const view = modelView(rich(newGame(T0), 100), first, 1, false);
    expect(view.owned).toBe(0);
    expect(view.count).toBe(1);
    expect(view.canAfford).toBe(true);
    expect(view.costText).toBe(formatNumber(first.baseCost * START_DISCOUNT));
    expect(view.missingText).toBe('');
  });

  it('names what is missing when the wallet is short', () => {
    const view = modelView(rich(newGame(T0), 3), first, 1, false);
    expect(view.canAfford).toBe(false);
    expect(view.missingText).toBe(formatNumber(first.baseCost * START_DISCOUNT - 3));
  });

  it('shows the income an Agent adds, from the engine, before the purchase', () => {
    const s = rich(newGame(T0), 1e6);
    const hired = buyAgents(s, first.id, 1);
    const view = modelView(s, first, 1, false);
    expect(view.showsGain).toBe(true);
    expect(view.gainText).toBe(formatNumber(totalIncome(hired) - totalIncome(s)));
  });

  it('buys as many as the wallet allows in Max mode and none when it allows none', () => {
    const wallet = bulkCost(first, 0, 5, START_DISCOUNT);
    const s = rich(newGame(T0), wallet);
    expect(modelView(s, first, 'max', false).count).toBe(maxAffordable(first, 0, wallet, START_DISCOUNT));
    expect(modelView(s, first, 'max', false).count).toBe(5);
    const broke = modelView(rich(newGame(T0), 1), first, 'max', false);
    expect(broke.count).toBe(0);
    expect(broke.canAfford).toBe(false);
    expect(broke.showsGain).toBe(false);
  });

  it('sells what the player owns and says what comes back', () => {
    const s = buyAgents(rich(newGame(T0), 1e6), first.id, 30);
    const view = modelView(s, first, 10, true);
    expect(view.sell).toBe(true);
    expect(view.owned).toBe(30);
    expect(view.count).toBe(10);
    expect(view.canAfford).toBe(true);
    expect(view.refundText).toBe(formatNumber(sellRefund(first, 30, 10)));
    expect(modelView(s, first, 100, true).canAfford).toBe(false);
    expect(modelView(newGame(T0), first, 1, true).showsGain).toBe(false);
  });

  it('fills the goal rail in twelfths of the price', () => {
    const cost = nextAgentCost(newGame(T0));
    const half = modelView(rich(newGame(T0), cost / 2), first, 1, false);
    expect(half.goalTicks).toBe(6);
    expect(half.goalPct).toBe(50);
    expect(modelView(rich(newGame(T0), cost), first, 1, false).goalTicks).toBe(12);
  });

  it('agrees on the noun with the printed number of Agents', () => {
    const s = buyAgents(rich(newGame(T0), 1e6), first.id, 2);
    expect(modelView(s, first, 1, false).ownedWord).toBe(formatCount(2, 'Агент', 'Агента', 'Агентов', 'short'));
    expect(modelView(newGame(T0), first, 1, false).ownedWord).toBe('Агентов');
  });

  it('leaves every card alone while a rich late run idles', () => {
    const states = idle(rich(lateGame(), 1e300), 40);
    for (const m of CATALOG[LAST_GENERATION - 1].models) {
      for (const [amount, sell] of [[1, false], ['max', false], [10, true]] as const) {
        expect(changes(states, (s) => modelView(s, m, amount, sell))).toBe(0);
      }
    }
  });

  it('moves a card in deficit only when its printed numbers move', () => {
    const states = idle(lateGame(), 100);
    const dearest = CATALOG[LAST_GENERATION - 1].models.at(-1)!;
    expect(changes(states, (s) => modelView(s, dearest, 1, false))).toBeLessThan(20);
  });
});

describe('shop upgrades slice', () => {
  const mid = (): GameState => {
    let s = rich(newGame(T0), 1e9);
    s = buyAgents(s, CATALOG[0].models[0].id, 30);
    return s;
  };

  it('lists the same upgrades the engine unlocks, once per state', () => {
    const s = mid();
    expect(availableUpgradesOf(s).map((u) => u.id)).toEqual(availableUpgrades(s).map((u) => u.id));
    expect(availableUpgradesOf(s)).toBe(availableUpgradesOf(s));
    expect(availableUpgradesOf(s).length).toBeGreaterThan(0);
  });

  it('says what an upgrade costs and what the wallet lacks', () => {
    const s = mid();
    const u = availableUpgradesOf(s)[0];
    const broke = upgradeView({ ...s, tokens: u.cost / 2 }, u);
    expect(broke.canAfford).toBe(false);
    expect(broke.costText).toBe(formatNumber(u.cost));
    expect(broke.missingText).toBe(formatNumber(u.cost / 2));
    expect(broke.missingWord).toBe(formatCount(u.cost / 2, 'Токен', 'Токена', 'Токенов', 'short'));
    const enough = upgradeView({ ...s, tokens: u.cost }, u);
    expect(enough.canAfford).toBe(true);
    expect(enough.missingText).toBe('');
  });

  it('keeps the upgrade list and its cards still while a late run idles', () => {
    const states = idle(rich(lateGame(), 1e300), 100);
    expect(changes(states, availableUpgradesOf)).toBe(0);
    for (const u of availableUpgradesOf(states[0])) {
      expect(changes(states, (s) => upgradeView(s, u))).toBe(0);
    }
  });
});

describe('prestige tab slices', () => {
  const flagship = (g: number) => CATALOG[g].flagship;

  it('opens Prestige with the Flagship and shows the Compute it pays', () => {
    const fresh = newGame(T0);
    expect(prestigeCardView(fresh).ready).toBe(false);
    const ready = buyAgents(rich(fresh, 1e12), flagship(0).id, 1);
    expect(canPrestige(ready)).toBe(true);
    const view = prestigeCardView(ready);
    expect(view.ready).toBe(true);
    expect(view.finale).toBe(false);
    expect(view.gain).toBe(formatNumber(prestigeGain(ready)));
  });

  it('closes Prestige at the content finale', () => {
    const last = buyAgents(
      { ...rich(newGame(T0), 1e300), generation: LAST_GENERATION, maxGeneration: LAST_GENERATION },
      flagship(LAST_GENERATION).id,
      1,
    );
    expect(isContentFinale(last)).toBe(true);
    expect(prestigeCardView(last).finale).toBe(true);
  });

  it('prices the pledge and the license from the engine and counts the time left', () => {
    const s: GameState = {
      ...rich(lateGame(), 1e300),
      uprising: 2,
      pledgeBought: 1,
      pledgeUntil: lateGame().lastTick + 90_000,
    };
    const view = pledgeView(s);
    expect(view.uprising).toBe(2);
    expect(view.pledgeCostText).toBe(formatNumber(pledgeCost(s)));
    expect(view.canPledge).toBe(canPledge(s));
    expect(view.licenseCostText).toBe(formatNumber(licenseCost(s)));
    expect(view.canLicense).toBe(canLicense(s));
    expect(view.revokeCostText).toBe(formatNumber(revokeCost(s)));
    expect(view.leftText).toBe(formatDuration(90));
    expect(pledgeView({ ...s, pledgeUntil: 0 }).leftText).toBe('');
  });

  it('shows the crystal stock and the bonus it gives', () => {
    const s = { ...lateGame(), crystals: 7 };
    const view = crystalStockView(s);
    expect(view.stock).toBe('7');
    expect(view.bonus).toBe(formatNumber(Math.round((crystalIncomeMult(s) - 1) * 100)));
  });

  it('shows how long the next crystal grows', () => {
    const s = lateGame();
    expect(crystalGrowthView({ ...s, crystalPlantedAt: 0 }).planted).toBe(false);
    const cycle = crystalCycleMs(s);
    const half = crystalGrowthView({ ...s, crystalPlantedAt: s.lastTick - cycle / 2 });
    expect(half.planted).toBe(true);
    expect(half.now).toBe(50);
    expect(half.width).toBe(50);
    expect(half.leftText).toBe(formatDuration(cycle / 2 / 1000));
  });

  it('prices a crystal upgrade by the bonus it takes and the crystals it costs', () => {
    const u = CRYSTAL_UPGRADES[0];
    const s = { ...lateGame(), crystals: u.cost };
    const view = crystalUpgradeView(s, u);
    const lost = Math.round(
      (crystalIncomeMult({ ...s, crystals: u.cost }) - crystalIncomeMult({ ...s, crystals: 0 })) * 100,
    );
    expect(view.owned).toBe(false);
    expect(view.canAfford).toBe(true);
    expect(view.lostText).toBe(formatNumber(lost));
    expect(crystalUpgradeView({ ...s, crystals: u.cost - 1 }, u).canAfford).toBe(false);
    expect(crystalUpgradeView({ ...s, crystalUpgrades: [u.id] }, u).owned).toBe(true);
  });

  it('repaints the prestige tab only for what changed while a late run idles', () => {
    const states = idle({ ...rich(lateGame(), 1e300), uprising: 2, crystalPlantedAt: T0 }, 200);
    expect(changes(states, prestigeCardView)).toBe(0);
    expect(changes(states, pledgeView)).toBeLessThanOrEqual(1);
    expect(changes(states, crystalStockView)).toBe(0);
    expect(changes(states, (s) => crystalUpgradeView(s, CRYSTAL_UPGRADES[0]))).toBe(0);
    // Часы кристалла идут сами: подпись «зреет ещё …» меняется раз в секунду, а не на каждом тике.
    expect(changes(states, crystalGrowthView)).toBeLessThan(25);
  });
});

describe('scene slices', () => {
  const glitched = (): GameState => ({
    ...lateGame(),
    glitches: [
      { id: 1, stolen: 120, clicks: 0 },
      { id: 2, stolen: 30, clicks: 1 },
    ],
  });

  it('shows no glitch band on a clean office', () => {
    expect(glitchBandView(lateGame())).toBeNull();
  });

  it('prints how much income the glitches take and how much they have stolen', () => {
    const s = glitched();
    const band = glitchBandView(s)!;
    expect(band.drain).toBe(formatNumber(Math.round((1 - glitchDrainMult(s)) * 100)));
    expect(band.stolen).toBe(formatNumber(150));
    expect(band.stolenWord).toBe(formatCount(150, 'Токен', 'Токена', 'Токенов', 'short'));
  });

  it('hands over the same empty list while no glitch lives', () => {
    const states = idle(lateGame(), 20);
    expect(glitchesOf(states[0])).toBe(glitchesOf(states[20]));
    expect(glitchesOf(glitched())).toHaveLength(2);
  });

  it('flies the drone only through the window of the event, and only then', () => {
    const FLIGHT = 2600;
    const s = lateGame();
    const event = { kind: 'hype' as const, startedAt: s.lastTick - 1_000, red: false };
    expect(droneView({ ...s, event: null }, FLIGHT)).toBeNull();
    expect(droneView({ ...s, event }, FLIGHT)?.elapsed).toBe(1_000);
    expect(droneView({ ...s, event: { ...event, startedAt: s.lastTick - FLIGHT } }, FLIGHT)).toBeNull();
    expect(droneView({ ...s, event: { ...event, startedAt: s.lastTick + 500 } }, FLIGHT)).toBeNull();
  });

  it('keeps the scene quiet while a late run idles without events', () => {
    const states = idle(lateGame(), 100);
    expect(changes(states, glitchBandView)).toBe(0);
    expect(changes(states, glitchesOf)).toBe(0);
    expect(changes(states, (s) => droneView(s, 2600))).toBe(0);
  });
});

describe('roster slice', () => {
  it('gives each lab its share of the income as a whole percent', () => {
    const s = lateGame();
    const shares = LAB_IDS.map((lab) => labShareView(s, lab)).filter((v) => v >= 0);
    expect(shares.length).toBeGreaterThan(1);
    for (const lab of LAB_IDS) {
      const share = labIncomeShare(s, lab);
      expect(labShareView(s, lab)).toBe(share >= 0.01 ? Math.round(share * 100) : -1);
    }
  });

  it('says nothing for a lab that is not in the office or earns under a percent', () => {
    const empty = newGame(T0);
    for (const lab of LAB_IDS) expect(labShareView(empty, lab)).toBe(-1);
  });

  it('keeps every lab share steady while a late run idles', () => {
    const states = idle(lateGame(), 50);
    for (const lab of LAB_IDS) expect(changes(states, (s) => labShareView(s, lab))).toBe(0);
  });
});
