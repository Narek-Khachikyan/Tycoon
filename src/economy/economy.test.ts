import { describe, expect, it } from 'vitest';
import { buildCatalog, CATALOG, computeGain, genScale, PRESTIGE_DIVISOR_UNITS, prestigeDivisor, softMod } from './catalog';
import {
  advance, advanceTime, applyOffline, assistClickBonus, BASE_OFFLINE_HOURS, bulkCost, buyAgents, buyPerk, buyUpgrade, canPrestige, click,
  clickValue, computeShortfall, datasetMult, datasetValue, discountMult, earnTokens, flagshipMult, generationBoostMult, incomeGain, isContentFinale,
  labIncomeShare, maxAffordable, modelIncome, offlineCapHours, offlineIncome, offlineRateMult, prestige, prestigeGain, prestigePreview,
  progressToNextAgent, sellAgents, START_PRICE_MULT, totalIncome,
} from './engine';
import {
  collectCrystals, buyCrystalUpgrade, CRYSTAL_CYCLE_MS, CRYSTAL_PER_STOCK_BONUS, CRYSTAL_STOCK_CAP, CRYSTAL_UPGRADES,
  crystalCycleMs, crystalIncomeMult,
} from './crystal';
import {
  activeSpec, catchUpClick, clickMultiplierFor, COMBO_CAP, COMBO_WINDOW_MS, comboMultFor, downtimeIncomeMult, ENCORE_CHANCE, ENCORE_MAX_MS,
  ENCORE_MIN_MS, EVENT_MAX_MS, EVENT_MIN_MS, EVENT_TABLES, eventMultiplierFor, eventWindowMs, FIRST_EVENT_MAX_MS, FIRST_EVENT_MIN_MS,
  grantAmount, GRANT_FLOOR_WALLET_CAP, isEventActive, pickEncoreWindow, pickEventWindow, pickFirstEventWindow, pickSurgeModel, rollEventKind,
  RUMOR_MIN_PAYOUT, surgeMultFor,
} from './events';
import {
  advanceGlitches, buyLicense, buyPledge, canLicense, canPledge, covenantIncomeMult, crashAmount, glitchDrainMult, glitchPayout,
  GLITCH_CLICKS, GLITCH_FIRST_GENERATION, GLITCH_MAX_MS, GLITCH_MIN_MS, GLITCH_PAYOUT, GLITCH_PER_GLYCH, GLITCH_SLOTS, hitGlitch,
  isPledgeActive, LICENSE_FLAGSHIP_MULT, LICENSE_INCOME_TAX, PLEDGE_GROWTH, PLEDGE_MAX, PLEDGE_UNITS, pledgeCost, popGlitch,
  licenseCost, redEventChance, RED_TABLES, REVOKE_FLAGSHIP_MULT, revokeCost, revokeLicense, spawnGlitch, uprisingStage,
} from './glitches';
import { GEN_PERK_BASE_COST, GEN_PERK_STEP_COST, genPerkId, isGenPerkId, PERK_BY_ID, type PerkEffect } from './perks';
import { DEFAULT_VOLUME, EVENT_KINDS, newGame, SAVE_VERSION, type ActiveEvent, type EventKind, type GameState } from './state';
import { exportSave, importSave, migrate } from './save';
import { pickNews } from './news';
import { ACHIEVEMENTS, awardAchievements, newlyEarned, nonShadowCount, shadowEarned } from './achievements';
import { SHADOW_ACHIEVEMENTS } from './shadow';
import {
  ASSIST1_THRESHOLD, ASSIST1_UNITS, ASSIST2_THRESHOLD, ASSIST2_UNITS, assistUpgradeId, availableUpgrades, clickUpgradeId, DATASET_THRESHOLDS, DATASET_UNITS,
  datasetUpgradeId, FLAGSHIP_COST_MULT, FLAGSHIP_MULT_CAP, flagshipUpgradeId, isUpgradeUnlocked, juniorAgents, labFlagship, labTopTier, labWork,
  modelUpgradeId, MODEL_TIERS, PAIR_SYNERGY_MULT, pairSynergyUpgradeId, SYNERGY_MIN_AGENTS, synergyUpgradeId, totalAgents, UPGRADE_BY_ID,
  UPGRADES_BY_GEN, type Upgrade,
} from './upgrades';
import { formatCount, formatNumber } from './format';
import { GENERATIONS } from '../data/generations';
import { LAB_IDS, type LabId } from '../data/labs';

const T0 = 1_000_000;
const g0 = CATALOG[0];
const first = g0.models[0];
const rich = (s: GameState, tokens = 1e50): GameState => ({ ...s, tokens, runTokens: tokens });
/** Обычных Достижений в игре: потолок для порогов Датасета и знаменатель «N / 21». */
const NON_SHADOW_TOTAL = ACHIEVEMENTS.length;
const HOUR = 3600_000;

/**
 * Детерминированный rnd для проверки розыгрыша: тест, который зависит от Math.random, падает
 * один раз из двадцати и потому ничего не проверяет.
 */
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
};

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
  // Инвариант, который держал деньги, а не стиль: окупаемость (цена ÷ доход) не должна расти
  // по Рангу. Пока росла — верхний Ранг был худшей сделкой Поколения, а верхний Ранг это
  // Флагман, то есть единственный ключ к Престижу. Замерено на исходной лестнице
  // (COST_STEP 11,5 против INCOME_STEP 6,5): окупаемость Флагмана 2,9 часа в Поколении 1 и
  // 55 дней в Поколении 8, где Ранг ~19; шесть часов непрерывной игры не давали первого Престижа
  // ни одной стратегией, то есть прогрессия была недостижима в принципе.
  //
  // Порция 3× — не точность, а запас: сам модификатор ±30% растягивает окупаемость внутри
  // Поколения до 1,86×, и место для осознанной настройки лестницы должно остаться. Ловит
  // именно возврат к расходящимся лестницам, а не конкретное число.
  it('never lets a rank pay back materially worse than the cheapest model', () => {
    for (const g of CATALOG) {
      const payback = g.models.map((m) => m.baseCost / m.baseIncome);
      const cheapest = Math.min(...payback);
      for (const p of payback) expect(p).toBeLessThanOrEqual(cheapest * 3);
    }
  });
  // Обратная сторона той же правды: если окупаемость падает по Рангу, верхняя Модель
  // окупается мгновенно и становится единственной разумной покупкой, а остальные Модели —
  // деньгами в никуда. Проверено на лестнице с COST_STEP 4: окупаемость Флагмана 7 секунд в
  // Поколении 1 и ноль в Поколении 8.
  it('never lets a rank pay back so fast that the rest of the generation is waste', () => {
    for (const g of CATALOG) {
      const payback = g.models.map((m) => m.baseCost / m.baseIncome);
      const dearest = Math.max(...payback);
      for (const p of payback) expect(p).toBeGreaterThanOrEqual(dearest / 3);
    }
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
  it('measures progress to the next agent as the missing share of its price', () => {
    const s = newGame(T0);
    const cost = bulkCost(first, 0, 1);
    // Кошелёк пуст: не хватает всей цены, то есть доли 1.
    expect(progressToNextAgent(s, first)).toBe(1);
    // Ровно половина чистой цены — но полоса считает цену со стартовой скидкой, поэтому доля
    // меньше половины: скидка действует и на кнопку, и на полосу, иначе они бы разошлись.
    expect(progressToNextAgent({ ...s, tokens: cost / 2 }, first)).toBeCloseTo(1 - 1 / (2 * START_PRICE_MULT));
    expect(progressToNextAgent({ ...s, tokens: cost }, first)).toBe(0);
    expect(progressToNextAgent({ ...s, tokens: cost * 10 }, first)).toBe(0);
    // Скидка Перка уменьшает цену, а полоса считает ровно ту же цену, что и кнопка покупки.
    const withDiscount = { ...s, tokens: cost / 2, perks: ['discount'] };
    const sale = cost * 0.95 * START_PRICE_MULT; // «Оптовые GPU» снимают 5% поверх стартовых 30%
    expect(progressToNextAgent(withDiscount, first)).toBeCloseTo((sale - cost / 2) / sale);
    // Уже купленные Агенты подняли цену, поэтому полоса считается от следующей, а не от первой.
    const hired = buyAgents(rich(s), first.id, 10);
    const nextCost = bulkCost(first, 10, 1);
    expect(nextCost).toBeGreaterThan(cost);
    expect(progressToNextAgent({ ...hired, tokens: nextCost / 2 }, first)).toBeCloseTo(0.5);
    expect(progressToNextAgent({ ...hired, tokens: 0 }, first)).toBe(1);
  });
});

describe('early game prices', () => {
  it('discounts the first two agents by thirty percent and charges full price after', () => {
    expect(START_PRICE_MULT).toBe(0.7);
    const s = newGame(T0);
    expect(discountMult(s)).toBe(START_PRICE_MULT);
    // Кошелёк — миллион, а не 1e50: на порядке 1e50 разница в десятки Токенов тонет в мантиссе.
    const wallet = (x: GameState, tokens = 1e6): GameState => ({ ...x, tokens, runTokens: tokens });
    // Первый Агент обошёлся в 0,7 чистой цены — яма 2–5 минут начинается раньше.
    const one = buyAgents(wallet(s), first.id, 1);
    expect(one.agents[first.id]).toBe(1);
    expect(wallet(s).tokens - one.tokens).toBeCloseTo(bulkCost(first, 0, 1) * START_PRICE_MULT);
    // Второй — тоже: скидка держится, пока Агентов меньше двух.
    expect(discountMult(one)).toBe(START_PRICE_MULT);
    const two = buyAgents(one, first.id, 1);
    expect(one.tokens - two.tokens).toBeCloseTo(bulkCost(first, 1, 1) * START_PRICE_MULT);
    // Третий — уже полный: скидка только стартовая, а не вечная.
    expect(discountMult(two)).toBe(1);
    const three = buyAgents(two, first.id, 1);
    expect(two.tokens - three.tokens).toBeCloseTo(bulkCost(first, 2, 1));
  });

  it('keeps the rank order under the uniform discount', () => {
    // Множитель общий для всех Моделей, поэтому дешёвая Модель не обгоняет дорогую:
    // порядок цен — тот же, что в каталоге, и монотонность по Рангу не ломается.
    const s = rich(newGame(T0));
    for (let i = 1; i < g0.models.length; i++) {
      const cheap = bulkCost(g0.models[i - 1], 0, 1, discountMult(s));
      const pricey = bulkCost(g0.models[i], 0, 1, discountMult(s));
      expect(pricey).toBeGreaterThan(cheap);
    }
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
  it('extends the cap to 24h with the first offline perk', () => {
    const s = { ...newGame(T0), perks: ['offline_rate_1'] };
    expect(offlineCapHours(s)).toBe(24);
    expect(applyOffline(s, T0 + 100 * HOUR).seconds).toBe(24 * 3600);
  });
  it('pays three quarters of the income with the rate perk, up to its window', () => {
    const base = buyAgents(rich(newGame(T0), 1e6), first.id, 1);
    const s = { ...base, perks: ['offline_rate_1'], lastTick: T0 };
    const inc = totalIncome(s);
    expect(offlineRateMult(s)).toBe(0.75);
    const hour = applyOffline(s, T0 + HOUR);
    expect(hour.seconds).toBe(3600);
    expect(hour.earned).toBeCloseTo(inc * 3600 * 0.75);
    // Перк не сужает окно до своих часов: сутки простоя он оплачивает целиком.
    expect(applyOffline(s, T0 + 24 * HOUR).seconds).toBe(24 * 3600);
    // Активный интервал Перк не режет: до порога оффлайна Доход идёт как обычно.
    expect(advanceTime({ ...s, lastTick: T0 }, 5).tokens - s.tokens).toBeCloseTo(inc * 5);
  });
  it('keeps the previous offline behaviour without the perk', () => {
    const s = { ...buyAgents(rich(newGame(T0), 1e6), first.id, 1), lastTick: T0 };
    expect(offlineRateMult(s)).toBe(1);
    expect(applyOffline(s, T0 + HOUR).earned).toBeCloseTo(totalIncome(s) * 3600);
    expect(applyOffline(s, T0 + 100 * HOUR).seconds).toBe(8 * 3600);
  });
  it('never pays the same interval twice with the rate perk on', () => {
    const s = { ...buyAgents(rich(newGame(T0), 1e6), first.id, 1), perks: ['offline_rate_1'], lastTick: T0 };
    const after = advanceTime(s, 48 * 3600);
    const inc = totalIncome(s);
    // Ровно сутки по 0,75, а не двое суток: активного тика на этом интервале не было, и оплачен
    // один простой, а не он плюс оффлайн за ту же пауту. lastTick уехал вместе с начислением.
    expect(after.tokens - s.tokens).toBeCloseTo(inc * 24 * 3600 * 0.75);
    expect(after.lastTick).toBe(T0 + 48 * 3600_000);
  });
  it('advance moves lastTick with the income, so the same interval is never paid twice', () => {
    // Ровно кадр тика, а не минуты: advance — это активный шаг, который зовёт advanceTime, и большой
    // dt через него не проходит. Оффлайн-ветка advanceTime и её кэп разобраны отдельно выше.
    const s = { ...buyAgents(rich(newGame(T0), 1e6), first.id, 1), lastTick: T0 };
    const after = advance(s, 5);
    expect(after.tokens - s.tokens).toBeCloseTo(totalIncome(s) * 5);
    expect(after.lastTick).toBe(T0 + 5_000);
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
    expect(advanceTime(s, 48 * 3600).tokens - s.tokens).toBeCloseTo(inc * 48 * 3600 * 0.9);
  });
  it('still advances normally on short frames', () => {
    const s = buyAgents(rich(newGame(T0), 1e6), first.id, 1);
    const after = advanceTime(s, 0.05);
    expect(after.tokens - s.tokens).toBeCloseTo(totalIncome(s) * 0.05);
    expect(advanceTime(s, -1)).toBe(s);
  });
});

describe('offline ladder', () => {
  /** Эффект Перка оффлайна по id: падение здесь означает, что Перк переименовали или сменили вид. */
  const step = (id: string): Extract<PerkEffect, { kind: 'offlineRate' }> => {
    const p = PERK_BY_ID[id];
    if (!p || p.effect.kind !== 'offlineRate') throw new Error(`перк ${id} должен быть оффлайн-Перком`);
    return p.effect;
  };
  const withPerks = (perks: string[]): GameState => ({
    ...buyAgents(rich({ ...newGame(T0), perks }, 1e6), first.id, 1),
    lastTick: T0,
  });

  it('steps rate and window strictly up, so no perk can ever be the dead one', () => {
    const steps = [step('offline_rate_1'), step('offline_24h')];
    expect(steps.map((e) => ({ rate: e.rate, hours: e.hours }))).toEqual([
      { rate: 0.75, hours: 24 },
      { rate: 0.9, hours: 72 },
    ]);
    // Ступени сравниваются по насыщенному заработку rate × hours: именно он решает, мёртвый
    // Перк или нет. Один только рост доли такой лестницы не гарантирует — Перк, который
    // одновременно режет долю и окно, проиграл бы базовым 8 часам и был бы ловушкой.
    // Базовая ступень — полный Доход за восемь часов.
    let saturated = BASE_OFFLINE_HOURS;
    for (const e of steps) {
      expect(e.rate).toBeLessThanOrEqual(1);
      expect(e.hours).toBeGreaterThan(BASE_OFFLINE_HOURS);
      expect(e.rate * e.hours).toBeGreaterThan(saturated);
      saturated = e.rate * e.hours;
    }
    // Доля между Перками не падает: вторая ступень не отбирает то, что дала первая.
    for (let i = 1; i < steps.length; i++) expect(steps[i].rate).toBeGreaterThan(steps[i - 1].rate);
  });
  it('resolves rate and window from the purchased perks, in any order', () => {
    expect(offlineRateMult(withPerks([]))).toBe(1);
    expect(offlineCapHours(withPerks([]))).toBe(BASE_OFFLINE_HOURS);
    const rate1 = withPerks(['offline_rate_1']);
    expect(offlineRateMult(rate1)).toBe(0.75);
    expect(offlineCapHours(rate1)).toBe(24);
    const second = withPerks(['offline_24h']);
    expect(offlineRateMult(second)).toBe(0.9);
    expect(offlineCapHours(second)).toBe(72);
    // Вместе берётся лучшее по каждому числу, поэтому порядок покупки не важен.
    for (const perks of [
      ['offline_rate_1', 'offline_24h'],
      ['offline_24h', 'offline_rate_1'],
    ]) {
      expect(offlineRateMult(withPerks(perks))).toBe(0.9);
      expect(offlineCapHours(withPerks(perks))).toBe(72);
    }
  });
  it('keeps the pricier perk never worse than the cheaper one at any idle length', () => {
    const cheap = withPerks(['offline_rate_1']);
    const pricey = withPerks(['offline_24h']);
    const inc = totalIncome(cheap);
    for (const hours of [1, 8, 24, 48, 72, 100, 200]) {
      const a = applyOffline(cheap, T0 + hours * HOUR).earned;
      expect(applyOffline(pricey, T0 + hours * HOUR).earned).toBeGreaterThanOrEqual(a);
    }
    // За окном дешёвого Перка разница обязана стать строгой, иначе Перк действительно мёртвый.
    expect(applyOffline(pricey, T0 + 30 * HOUR).earned).toBeGreaterThan(applyOffline(cheap, T0 + 30 * HOUR).earned);
    expect(applyOffline(pricey, T0 + 100 * HOUR).earned).toBeGreaterThan(applyOffline(cheap, T0 + 100 * HOUR).earned);
    // Оффлайн-доход отличается от активного ровно долей Перка: в нём не осталось ничего другого.
    expect(applyOffline(cheap, T0 + HOUR).earned).toBeCloseTo(inc * (HOUR / 1000) * 0.75);
    expect(advanceTime({ ...cheap, lastTick: T0 }, 5).tokens - cheap.tokens).toBeCloseTo(inc * 5);
  });
});

// ---------- События, Глюки и откуп ----------

/** Игрок с Агентами и без событий: база, от которой считаются все временные множители. */
const hired = (agents = 10): GameState => ({
  ...buyAgents(rich(newGame(T0), 1e6), first.id, agents),
  lastTick: T0,
});

/** Тот же игрок с живым событием нужного вида: окно открыто прямо в lastTick. */
const withEvent = (kind: EventKind, red = false, modelId?: string): GameState => ({
  ...hired(),
  event: { kind, startedAt: T0, red, modelId },
});

/** Один 50-миллисекундный тик, заканчивающийся в момент `now`. */
const tickTo = (s: GameState, now: number) => advance({ ...s, lastTick: now - 50 }, 0.05);

describe('transient modifiers', () => {
  it('reads an event and live glitches from the state, not from an argument', () => {
    const s = hired(1);
    const inc = totalIncome(s);
    const busy: GameState = {
      ...s,
      event: { kind: 'hype', startedAt: T0, red: false },
      glitches: [{ id: 1, stolen: 0.5, clicks: 0 }],
    };
    // Активный тик читает оба: событие ×7 и Глюк, укравший 5% Дохода.
    expect(totalIncome(busy)).toBeCloseTo(inc * 7 * 0.95);
    expect(advance(busy, 1).tokens - busy.tokens).toBeCloseTo(inc * 7 * 0.95);
    // Часы берутся из lastTick, поэтому подпись магазина и тик считают один и тот же Доход.
    expect(totalIncome(busy, T0)).toBeCloseTo(totalIncome(busy));
  });

  it('never pays an event or a glitch backwards, offline included', () => {
    const s = hired(1);
    const inc = totalIncome(s);
    const busy: GameState = {
      ...s,
      event: { kind: 'hype', startedAt: T0, red: false },
      glitches: [{ id: 1, stolen: 0.5, clicks: 0 }],
    };
    // Оффлайн идёт по базовой скорости: игрок получает бонус за минуты, а простой длится часы,
    // и Глюк за это время просто спит.
    expect(offlineIncome(busy)).toBeCloseTo(inc);
    expect(applyOffline(busy, T0 + HOUR).earned).toBeCloseTo(inc * 3600);
    expect(advanceTime(busy, HOUR / 1000).tokens - busy.tokens).toBeCloseTo(inc * 3600);
    // Глюки при этом не растут: выплата за лопнувшего остаётся прежней.
    expect(advanceTime(busy, HOUR / 1000).glitches[0].stolen).toBe(0.5);
  });
});

describe('events', () => {
  it('pays the multiplier inside the window and drops it strictly on the boundary', () => {
    const s = withEvent('hype');
    const spec = EVENT_TABLES.hype;
    const inc = totalIncome(hired());
    expect(eventMultiplierFor(s, T0)).toBe(spec.incomeMult);
    expect(eventMultiplierFor(s, T0 + spec.durationMs - 1)).toBe(spec.incomeMult);
    expect(eventMultiplierFor(s, T0 + spec.durationMs)).toBe(1);
    // Тот же счёт в тике: последняя миллисекунда окна ещё платит, первая за его пределами — нет.
    expect(tickTo(s, T0 + spec.durationMs - 1).tokens - s.tokens).toBeCloseTo(inc * spec.incomeMult * 0.05, 6);
    expect(tickTo(s, T0 + spec.durationMs).tokens - s.tokens).toBeCloseTo(inc * 0.05, 6);
  });

  it('moves the whole income with «Волна хайпа» and leaves the click alone', () => {
    const s = withEvent('hype');
    const inc = totalIncome(hired());
    expect(totalIncome(s)).toBeCloseTo(inc * EVENT_TABLES.hype.incomeMult);
    // Клик без Апгрейдов Клика состоит только из своей части, и событие её не трогает.
    expect(clickValue(s)).toBeCloseTo(clickValue(hired()));
    expect(clickMultiplierFor(s)).toBe(1);
  });

  it('moves the click with «Клик-рывок» and leaves the income alone', () => {
    const s = withEvent('clickRush');
    expect(clickMultiplierFor(s)).toBe(EVENT_TABLES.clickRush.clickMult);
    expect(clickValue(s)).toBeCloseTo(clickValue(hired()) * EVENT_TABLES.clickRush.clickMult);
    expect(totalIncome(s)).toBeCloseTo(totalIncome(hired()));
  });

  it('moves only its own model with «Прорыв», and a stale id from another generation moves nothing', () => {
    const plain = hired();
    const surged = withEvent('surge', false, first.id);
    expect(modelIncome(surged, first)).toBeCloseTo(modelIncome(plain, first) * EVENT_TABLES.surge.incomeMult);
    // Общий Доход растёт ровно на вклад этой Модели: остальные Агентов не имеют.
    expect(totalIncome(surged)).toBeCloseTo(modelIncome(surged, first));
    // Соседняя Модель и Модель ушедшего Поколения бонуса не получают.
    expect(surgeMultFor(surged, g0.models[1].id)).toBe(1);
    expect(surgeMultFor(surged, CATALOG[1].models[0].id)).toBe(1);
    const stale = withEvent('surge', false, CATALOG[1].models[0].id);
    expect(totalIncome(stale)).toBeCloseTo(totalIncome(plain));
  });

  it('keeps the surge model through a reload, or the bonus lands on someone else', () => {
    const surged = withEvent('surge', false, first.id);
    const back = importSave(exportSave(surged), T0)!;
    expect(back.event).toEqual({ kind: 'surge', startedAt: T0, red: false, modelId: first.id });
    expect(surgeMultFor(back, first.id)).toBe(EVENT_TABLES.surge.incomeMult);
    expect(modelIncome(back, first)).toBeCloseTo(modelIncome(hired(), first) * EVENT_TABLES.surge.incomeMult);
  });

  it('picks the surge model among the models the player actually hired', () => {
    const s = buyAgents(hired(), g0.models[1].id, 1);
    expect(pickSurgeModel(s, () => 0.999)).toBe(g0.models[1].id);
    expect(pickSurgeModel(s, () => 0)).toBe(first.id);
    // Без Агентов остаётся флагман: случайная Модель из каталога выглядела бы сломанной.
    expect(pickSurgeModel(newGame(T0), () => 0)).toBe(g0.flagship.id);
    // Единица на верхней границе rnd не должна уводить индекс за список.
    expect(pickSurgeModel(s, () => 1)).toBe(g0.models[1].id);
  });

  it('charges the red click rush its own window and gives the whole window back on one click', () => {
    const s = withEvent('clickRush', true);
    const before = totalIncome(hired());
    expect(downtimeIncomeMult(s)).toBe(0);
    expect(totalIncome(s)).toBe(0);
    // Клик возвращает ровно те секунды, которые стоило окно, — из скорости ДО глушения.
    expect(catchUpClick(s, before)).toBeCloseTo(before * RED_TABLES.clickRush.catchUpSec);
    expect(clickValue(s)).toBeCloseTo(clickValue(hired()) + before * RED_TABLES.clickRush.catchUpSec);
    expect(clickMultiplierFor(s)).toBe(1);
    // Потолок возврата виден сразу же: после одного Клика окно уже погашено. Проверка только «за
    // один клик платится объём окна» обошлась бы и на старой ошибке, платившей объём за каждый клик.
    const paid = click(s);
    expect(catchUpClick(paid, before)).toBe(0);
    expect(clickValue(paid)).toBeCloseTo(clickValue(hired()));
  });

  it('returns the window once for any number of clicks, and again only in the next window', () => {
    const plain = hired();
    const rate = totalIncome(plain);
    const room = rate * RED_TABLES.clickRush.catchUpSec;
    let s = withEvent('clickRush', true);
    const perClick = clickValue(plain);
    let earned = 0;
    for (let i = 0; i < 10; i++) {
      const before = s.tokens;
      s = click(s);
      earned += s.tokens - before;
    }
    // Возврат — весь объём окна, а не объём за каждый Клик: десять кликов раньше давали десять окон
    // (в 10,9 раза больше заявленного здесь), и наказание было выгоднее бездействия — тем более с
    // Перком на автоклик, где клики идут вообще без игрока.
    expect(earned).toBeLessThanOrEqual(10 * perClick + room);
    expect(earned).toBeCloseTo(10 * perClick + room);
    // Один Клик покрыл убыток окна, поэтому дальше Клик стоит только себя.
    expect(clickValue(s)).toBeCloseTo(clickValue(plain));
    expect(s.catchUpPaid).toBeCloseTo(room);
    // Котёл принадлежит окну: следующее «Ночной кодинг» возвращает полный объём заново.
    const next = advanceTime({ ...s, nextEventAt: T0, event: null, uprising: 3 }, 0.05, () => 0.5);
    expect(next.event).toEqual({ kind: 'clickRush', startedAt: T0 + 50, red: true, modelId: undefined });
    expect(next.catchUpPaid).toBe(0);
    expect(catchUpClick(next, rate)).toBeCloseTo(room);
  });

  it('caps the window for the autoclicker too, who never touches the token', () => {
    const withPerk = (s: GameState): GameState => ({ ...s, perks: ['autoclick'] });
    const plain = withPerk(hired());
    const room = totalIncome(hired()) * RED_TABLES.clickRush.catchUpSec;
    const downtime = withPerk(withEvent('clickRush', true));
    const after = advance(downtime, 5);
    // Пять автокликов за пять секунд: окно глушит Доход, но Клики остаются Кликами, и сверх них
    // возвращается ровно объём окна. Без потолка тик отдал бы пять объёмов сразу, а автокликер —
    // самый частый «клик» в игре — превращал бы наказание в доход.
    expect(after.tokens - downtime.tokens).toBeCloseTo(5 * clickValue(plain) + room);
    expect(after.catchUpPaid).toBeCloseTo(room);
  });

  it('pays the window back after a reload, because the pot is in the state', () => {
    const s = withEvent('clickRush', true);
    const back = importSave(exportSave(s), T0)!;
    expect(catchUpClick(back, totalIncome(hired()))).toBeCloseTo(
      totalIncome(hired()) * RED_TABLES.clickRush.catchUpSec,
    );
    // Выплаченное не восстанавливается: перезагрузка не должна удваивать объём окна.
    const paid = click(s);
    const reloaded = importSave(exportSave(paid), T0)!;
    expect(catchUpClick(reloaded, totalIncome(hired()))).toBe(0);
  });

  it('names the two hypes differently and keys both tables by kind, not by name', () => {
    expect(EVENT_TABLES.hype.name).toBe('Волна хайпа');
    expect(RED_TABLES.hype.name).toBe('Ажиотаж');
    const names = [...Object.values(EVENT_TABLES), ...Object.values(RED_TABLES)].map((s) => s.name);
    // «Эпоха» — запрещённый синоним Поколения, а не название события.
    expect(names.some((n) => n.includes('Эпоха'))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(EVENT_TABLES)).toEqual([...EVENT_KINDS]);
    expect(Object.keys(RED_TABLES)).toEqual([...EVENT_KINDS]);
  });
});

describe('red events', () => {
  /** Одно окно события: `nextEventAt` уже наступил, поэтому тик заводит ровно одно событие. */
  const spawn = (uprising: GameState['uprising'], rnd: () => number): ActiveEvent | null =>
    advanceTime({ ...newGame(T0), lastTick: T0, nextEventAt: T0, uprising }, 0.05, rnd).event;

  it('reads the red share of events, not of windows', () => {
    expect(([0, 1, 2, 3] as const).map(redEventChance)).toEqual([0, 1 / 3, 2 / 3, 1]);
    const rnd = rng(42);
    const sample = 600;
    let red = 0;
    for (let i = 0; i < sample; i++) if (spawn(1, rnd)?.red) red++;
    // Около трети, а не около нуля и не около ста: иначе красные либо вытесняли бы обычные, либо
    // не появлялись вовсе.
    expect(red / sample).toBeGreaterThan(0.28);
    expect(red / sample).toBeLessThan(0.4);
  });

  it('makes every event red at the last stage without stopping ordinary ones', () => {
    for (const roll of [0, 0.25, 0.99]) {
      expect(spawn(3, () => roll)?.red).toBe(true);
    }
    const rnd = rng(11);
    let ordinary = 0;
    for (let i = 0; i < 200; i++) if (spawn(2, rnd)?.red === false) ordinary++;
    expect(ordinary).toBeGreaterThan(0);
    // Событие выпадает в любом случае: при Восстании третьем красным становится любое из них,
    // а не «красных нет».
    expect(spawn(3, () => 0)?.kind).toBeTruthy();
  });

  it('picks the table by the red flag, not by the uprising', () => {
    // Восстание третьей стадии при обычном событии не показывает красные числа: у них другие и
    // множитель, и длительность.
    const ordinary: GameState = { ...newGame(T0), uprising: 3, event: { kind: 'hype', startedAt: T0, red: false } };
    const red: GameState = { ...newGame(T0), event: { kind: 'hype', startedAt: T0, red: true } };
    expect(activeSpec(ordinary)?.name).toBe(EVENT_TABLES.hype.name);
    expect(activeSpec(red)?.name).toBe(RED_TABLES.hype.name);
    expect(eventMultiplierFor(ordinary)).toBe(EVENT_TABLES.hype.incomeMult);
    expect(eventMultiplierFor(red)).toBe(RED_TABLES.hype.incomeMult);
    expect(isEventActive(ordinary.event, T0 + EVENT_TABLES.hype.durationMs)).toBe(false);
    expect(isEventActive(red.event, T0 + RED_TABLES.hype.durationMs)).toBe(false);
    expect(isEventActive(ordinary.event, T0 + RED_TABLES.hype.durationMs)).toBe(true);
  });

  it('silences red events under a pledge and a license, without cancelling the event', () => {
    const due = { ...newGame(T0), nextEventAt: T0, uprising: 3 as const };
    const silenced = advanceTime({ ...due, pledgeUntil: T0 + 60_000 }, 0.05, () => 0.99);
    expect(silenced.event?.red).toBe(false);
    expect(isPledgeActive({ ...due, pledgeUntil: T0 + 60_000 }, T0)).toBe(true);
    const licensed = advanceTime({ ...due, covenant: true }, 0.05, () => 0.99);
    expect(licensed.event?.red).toBe(false);
    expect(licensed.event?.kind).toBeTruthy();
    // Без откупа то же окно даёт красное событие.
    expect(advanceTime(due, 0.05, () => 0.99).event?.red).toBe(true);
  });
});

describe('event schedule', () => {
  it('plans the first window short and spawns one event into it', () => {
    const planned = advanceTime(hired(), 0.05, () => 0);
    expect(planned.nextEventAt).toBe(T0 + 50 + FIRST_EVENT_MIN_MS);
    expect(planned.event).toBeNull();
    expect(planned.combo).toBe(0);
    // Через 30 с окно ещё не наступило: первое Событие приходит не мгновенно, а в первую минуту.
    expect(advanceTime(planned, 30, () => 0).event).toBeNull();
    const spawned = advanceTime(planned, FIRST_EVENT_MIN_MS / 1000, () => 0);
    expect(spawned.eventsSeen).toBe(1);
    expect(spawned.event).not.toBeNull();
    expect(spawned.nextEventAt).toBeGreaterThan(spawned.lastTick);
    // Окно берётся из таблицы коротких пауз, а не из случайного числа: иначе розыгрыш был бы
    // непроверяем. Верхняя граница — 90 с: новичок видит Золотой Токен в первую минуту.
    expect(FIRST_EVENT_MAX_MS).toBeLessThanOrEqual(90_000);
    expect(advanceTime(hired(), 0.05, () => 1).nextEventAt).toBe(T0 + 50 + FIRST_EVENT_MAX_MS);
    expect(pickFirstEventWindow(() => 0)).toBe(FIRST_EVENT_MIN_MS);
    expect(pickFirstEventWindow(() => 0.999)).toBeLessThanOrEqual(FIRST_EVENT_MAX_MS);
  });

  it('spaces later windows two to ten minutes apart', () => {
    // Пропущенное окно: Событие было, но его не поймали, — следующее идёт в устоявшемся режиме.
    const missed: GameState = {
      ...hired(),
      nextEventAt: T0,
      event: { kind: 'hype', startedAt: T0 - 600_000, red: false },
    };
    const low = advanceTime(missed, 0.05, () => 0);
    expect(low.eventsSeen).toBe(1);
    expect(low.combo).toBe(0);
    expect(low.nextEventAt - low.lastTick).toBe(EVENT_MIN_MS);
    // Пауза берётся из таблицы пауз, а не из случайного числа: иначе розыгрыш был бы непроверяем.
    const high = advanceTime(missed, 0.05, () => 1);
    expect(high.nextEventAt - high.lastTick).toBe(EVENT_MAX_MS);
    expect(EVENT_MIN_MS).toBe(2 * 60_000);
    expect(EVENT_MAX_MS).toBe(10 * 60_000);
    expect(pickEventWindow(() => 0)).toBe(EVENT_MIN_MS);
  });

  it('schedules a quick encore after a caught event, but only by chance', () => {
    // «Грант» поймали минуту назад: окно протухло, отметка о поимке на месте.
    const caught: GameState = {
      ...hired(),
      nextEventAt: T0,
      event: { kind: 'grant', startedAt: T0 - 60_000, red: false },
      eventCaughtAt: T0 - 60_000,
    };
    const quick = advanceTime(caught, 0.05, () => 0);
    expect(quick.eventsSeen).toBe(1);
    expect(quick.nextEventAt - quick.lastTick).toBe(ENCORE_MIN_MS);
    expect(pickEncoreWindow(() => 1)).toBe(ENCORE_MAX_MS);
    expect(ENCORE_MIN_MS).toBeLessThan(COMBO_WINDOW_MS);
    expect(ENCORE_CHANCE).toBeGreaterThan(0);
    expect(ENCORE_CHANCE).toBeLessThan(1);
    // Не повезло с шансом — обычное окно в устоявшемся режиме, а не серия.
    const slow = advanceTime(caught, 0.05, () => 0.99);
    expect(slow.nextEventAt - slow.lastTick).toBeGreaterThan(ENCORE_MAX_MS);
    expect(slow.nextEventAt - slow.lastTick).toBeLessThanOrEqual(EVENT_MAX_MS);
  });

  it('never displaces a live event, even if the schedule says the window is due', () => {
    const live: GameState = { ...hired(), event: { kind: 'hype', startedAt: T0, red: false } };
    const clash = advanceTime({ ...live, nextEventAt: T0 + 1000 }, 1, () => 0.5);
    expect(clash.event).toBe(live.event);
    expect(clash.eventsSeen).toBe(0);
    // Истёкшее событие доживает в состоянии до своего окна — из него берётся запрет на повтор.
    const lingers = advanceTime({ ...live, nextEventAt: T0 + 600_000 }, 80, () => 0.5);
    expect(lingers.event).toBe(live.event);
    expect(isEventActive(lingers.event!, lingers.lastTick)).toBe(false);
    expect(activeSpec(lingers)).toBeNull();
    expect(lingers.eventsSeen).toBe(0);
    // Окно наступило — событие сменилось, и его счётчик выпадений вырос.
    const again = advanceTime(lingers, 600, () => 0);
    expect(again.eventsSeen).toBe(1);
    expect(again.event).not.toBe(live.event);
  });

  it('spawns one event for a whole absence, not one per missed window', () => {
    // Десять часов простоя — это десятки пропущенных окон: заспавнить их все разом значило бы
    // начислить игроку столько случайных бонусов, сколько он провёл без игры.
    const away = advanceTime({ ...hired(), nextEventAt: T0 }, 10 * 3600, rng(3));
    expect(away.eventsSeen).toBe(1);
  });

  it('repeats the same kind under 15% of the time over a long sample', () => {
    const rnd = rng(7);
    const sample = 2000;
    let last = rollEventKind([], rnd);
    let repeats = 0;
    for (let i = 0; i < sample; i++) {
      const kind = rollEventKind([last], rnd);
      if (kind === last) repeats++;
      last = kind;
    }
    expect(repeats / sample).toBeLessThan(0.15);
  });
});

describe('event combo', () => {
  /** Окно, наступившее в `at`, чьё предыдущее окно поймали: «Грант» 15 с, протух заведомо. */
  const dueAfterCatch = (at: number, prevStart: number, combo = 0): GameState => ({
    ...hired(),
    nextEventAt: at,
    event: { kind: 'grant', startedAt: prevStart, red: false },
    eventCaughtAt: prevStart,
    combo,
  });

  it('grows while caught windows land within thirty seconds of the previous end', () => {
    const aStart = T0;
    // B стартует через 20 с после конца A: цепочка из одного пойманного продолжается.
    const bStart = aStart + EVENT_TABLES.grant.durationMs + 20_000;
    const b = advanceTime(dueAfterCatch(bStart, aStart), (bStart - T0) / 1000, () => 0.99);
    expect(b.eventsSeen).toBe(1);
    expect(b.combo).toBe(1);
    // Цепочка из одного — ещё не комбо: живой эффект платит без множителя.
    expect(comboMultFor(b)).toBe(1);
    // C стартует через 20 с после конца B, и B тоже поймали: второе подряд даёт ×2.
    const bEnd = bStart + eventWindowMs(b.event!);
    const cStart = bEnd + 20_000;
    const cState: GameState = { ...b, nextEventAt: cStart, eventCaughtAt: b.event!.startedAt };
    const c = advanceTime(cState, (cStart - b.lastTick) / 1000, () => 0.99);
    expect(c.combo).toBe(2);
    expect(comboMultFor(c)).toBe(2);
    // Живой эффект умножается на комбо — на «Волне хайпа», «Клик-рывке» и «Прорыве».
    const hyped: GameState = { ...c, event: { kind: 'hype', startedAt: c.lastTick, red: false } };
    expect(eventMultiplierFor(hyped)).toBe(EVENT_TABLES.hype.incomeMult * 2);
    const rushed: GameState = { ...c, event: { kind: 'clickRush', startedAt: c.lastTick, red: false } };
    expect(clickMultiplierFor(rushed)).toBe(EVENT_TABLES.clickRush.clickMult * 2);
    const surged: GameState = { ...c, event: { kind: 'surge', startedAt: c.lastTick, red: false, modelId: first.id } };
    expect(surgeMultFor(surged, first.id)).toBe(EVENT_TABLES.surge.incomeMult * 2);
  });

  it('restarts the chain on a stale catch and resets it on a miss', () => {
    const aStart = T0;
    // B стартует через минуту после конца A: A поймали, но цепочка не сложилась — B начинает заново.
    const bStart = aStart + EVENT_TABLES.grant.durationMs + 60_000;
    const b = advanceTime(dueAfterCatch(bStart, aStart), (bStart - T0) / 1000, () => 0.99);
    expect(b.combo).toBe(1);
    // A вовсе не поймали: цепочки нет.
    const missed = advanceTime({ ...dueAfterCatch(bStart, aStart), eventCaughtAt: 0 }, (bStart - T0) / 1000, () => 0.99);
    expect(missed.combo).toBe(0);
    expect(comboMultFor(missed)).toBe(1);
  });

  it('caps the multiplier at eight, however long the chain', () => {
    expect(COMBO_CAP).toBe(8);
    const eighth: GameState = {
      ...hired(),
      combo: 8,
      event: { kind: 'hype', startedAt: T0, red: false },
    };
    expect(comboMultFor(eighth)).toBe(8);
    expect(eventMultiplierFor(eighth)).toBe(EVENT_TABLES.hype.incomeMult * 8);
    // Девятое пойманное подряд не поднимает выше потолка.
    const ninth = advanceTime(dueAfterCatch(T0 + 20_000, T0, 8), 20, () => 0.99);
    expect(ninth.combo).toBe(8);
    expect(comboMultFor(ninth)).toBe(8);
  });

  it('never multiplies a lump payout, only income and click', () => {
    // Разовые суммы считаются без комбо: «Грант» делит запас, а не умножает Доход.
    expect(grantAmount(1000, 60)).toBeCloseTo(150);
    const comboState: GameState = { ...hired(), combo: 5, event: null };
    expect(comboMultFor(comboState)).toBe(5);
    // Но платить ему нечего: без живого эффекта все множители — единицы.
    expect(eventMultiplierFor(comboState)).toBe(1);
    expect(clickMultiplierFor(comboState)).toBe(1);
    expect(surgeMultFor(comboState, first.id)).toBe(1);
  });
});

describe('glitches', () => {
  /** Состояние с `n` Глюками, каждый пожирающий по 5% Дохода. */
  const robbed = (n: number): GameState => {
    let s = hired();
    for (let i = 0; i < n; i++) s = spawnGlitch(s);
    return s;
  };

  it('takes 5% of the income each, up to ten of them', () => {
    const clean = hired();
    expect(glitchDrainMult(clean)).toBe(1);
    expect(GLITCH_PER_GLYCH).toBe(0.05);
    expect(GLITCH_SLOTS).toBe(10);
    expect(glitchDrainMult(robbed(1))).toBeCloseTo(0.95);
    expect(glitchDrainMult(robbed(3))).toBeCloseTo(0.85);
    expect(glitchDrainMult(robbed(10))).toBeCloseTo(0.5);
    // Потолок держится и на живом списке: завести одиннадцатый нельзя, и импорт не обходит правило.
    expect(spawnGlitch(robbed(10))).toEqual(robbed(10));
    expect(glitchDrainMult({ ...robbed(10), glitches: [...robbed(10).glitches, { id: 99, stolen: 0, clicks: 0 }] })).toBeCloseTo(0.5);
    // Тик действительно платит половину, а не «почти половину».
    const ten = robbed(10);
    expect(advance(ten, 1).tokens - ten.tokens).toBeCloseTo(totalIncome(clean) * 0.5);
  });

  it('pops only on the third hit and pays 1.1 of what that one glitch stole', () => {
    const s = advance(robbed(2), 10);
    expect(s.glitches.reduce((sum, g) => sum + g.stolen, 0)).toBeGreaterThan(0);
    const firstHit = hitGlitch(s, 1);
    expect(firstHit.popped).toBe(false);
    expect(firstHit.payout).toBe(0);
    expect(firstHit.state.glitches[0].clicks).toBe(1);
    const secondHit = hitGlitch(firstHit.state, 1);
    expect(secondHit.popped).toBe(false);
    expect(secondHit.state.glitches[0].clicks).toBe(GLITCH_CLICKS - 1);
    const thirdHit = hitGlitch(secondHit.state, 1);
    expect(thirdHit.popped).toBe(true);
    expect(thirdHit.state.glitches.map((g) => g.id)).toEqual([2]);
    // Платёж за одного, а не за весь список: у остальных Глюков своё `stolen`, и общий котёл здесь
    // платил бы каждому за всех — выплата выходила бы втрое выше заявленной.
    expect(thirdHit.payout).toBeCloseTo(GLITCH_PAYOUT * s.glitches[0].stolen);
    expect(hitGlitch(thirdHit.state, 1).state).toBe(thirdHit.state);
    expect(popGlitch(thirdHit.state, 1).popped).toBe(false);
  });

  it('pays one shared pot for ten popped one by one, never more', () => {
    const ten = advance(robbed(GLITCH_SLOTS), 10);
    let paid = 0;
    let cur = ten;
    while (cur.glitches.length > 0) {
      const { state, popped, payout } = popGlitch(cur, cur.glitches[0].id);
      expect(popped).toBe(true);
      paid += payout;
      cur = state;
    }
    // Инвариант сдачи: сумма выплат по одному равна ровно 1,1 × всё украденное. Раньше каждый
    // лопнувший забирал котёл целиком, и десять Глюков платили в 5,5 раза больше заявленного —
    // тогда лопнуть их по очереди было выгоднее, чем купить «Лицензию», которая платит тот же котёл.
    expect(paid).toBeCloseTo(GLITCH_PAYOUT * ten.glitches.reduce((sum, g) => sum + g.stolen, 0));
    expect(paid).toBeCloseTo(glitchPayout(ten));
  });

  it('grows the shared payout faster than the loss it costs the player', () => {
    const bitten = advance(robbed(10), 10);
    const single = advance(robbed(1), 10);
    expect(glitchPayout(bitten)).toBeCloseTo(10 * glitchPayout(single));
    // Десять воров крадут в десять раз больше, но обрезают Доход с 5% всего до половины: общий котёл
    // растёт сверхлинейно относительно потерянного, и это ровно то, что делает «Лицензию» откупом,
    // который стоит своих денег. Лопнув по одному, столько не получить — см. инвариант выше.
    expect(1 / glitchDrainMult(bitten)).toBeLessThan(2 * (1 / glitchDrainMult(single)));
    expect(advance(robbed(10), 0).glitches[0].stolen).toBe(0);
  });

  it('keeps the hit counter through a reload, or the glitch could never be popped', () => {
    const s = hitGlitch(hitGlitch(robbed(1), 1).state, 1).state;
    const back = importSave(exportSave(s), T0)!;
    expect(back.glitches[0].clicks).toBe(GLITCH_CLICKS - 1);
    expect(hitGlitch(back, 1).popped).toBe(true);
    expect(importSave(exportSave(robbed(1)), T0)!.glitches[0].clicks).toBe(0);
  });
});

describe('glitch schedule', () => {
  /** Игрок на нужном Поколении: расписание ниже третьего экрана не назначается вовсе. */
  const player = (generation: number): GameState => ({ ...newGame(T0), generation, lastTick: T0 });

  it('plans the first window itself and holds it off until the third screen', () => {
    const quiet = advanceGlitches(player(0), T0, () => 0);
    expect(quiet.nextGlitchAt).toBe(0);
    expect(quiet.glitches).toEqual([]);
    expect(advanceGlitches(quiet, T0 + 10 * HOUR, () => 0)).toBe(quiet);
    // Первое окно планируется, а не открывается сразу: спавн на первом тике читался бы как ошибка.
    const planned = advanceGlitches(player(GLITCH_FIRST_GENERATION), T0, () => 0);
    expect(planned.glitches).toEqual([]);
    expect(planned.nextGlitchAt).toBe(T0 + GLITCH_MIN_MS);
    // Пауза берётся из таблицы пауз, а не из случайного числа: иначе розыгрыш был бы непроверяем.
    expect(advanceGlitches(player(GLITCH_FIRST_GENERATION), T0, () => 1).nextGlitchAt).toBe(T0 + GLITCH_MAX_MS);
  });

  it('spawns one glitch when the window comes and moves the window into the future', () => {
    const due: GameState = { ...player(GLITCH_FIRST_GENERATION), nextGlitchAt: T0 };
    const spawned = advanceGlitches(due, T0, () => 0);
    expect(spawned.glitches).toHaveLength(1);
    expect(spawned.nextGlitchAt).toBe(T0 + GLITCH_MIN_MS);
    // Окно сдвинуто, а не осталось в прошлом: иначе глюки сыпались бы каждый тик.
    expect(advanceGlitches(spawned, T0 + 1, () => 0)).toBe(spawned);
    expect(advanceGlitches(spawned, spawned.nextGlitchAt, () => 0).glitches).toHaveLength(2);
  });

  it('skips a window missed during an absence instead of greeting the player with a glitch', () => {
    const missed: GameState = { ...player(GLITCH_FIRST_GENERATION), nextGlitchAt: T0 - 10 * 60_000 };
    const back = advanceGlitches(missed, T0, () => 0);
    expect(back.glitches).toEqual([]);
    expect(back.nextGlitchAt).toBeGreaterThan(T0);
  });

  it('keeps quiet under a license, because spawnGlitch refuses it', () => {
    const licensed: GameState = { ...player(GLITCH_FIRST_GENERATION), covenant: true, nextGlitchAt: T0 };
    expect(advanceGlitches(licensed, T0, () => 0).glitches).toEqual([]);
  });

  it('ticks with the engine, so the window survives a reload like the event one', () => {
    const ticked = advanceTime(player(GLITCH_FIRST_GENERATION), 0.05, rng(3));
    expect(ticked.nextGlitchAt).toBeGreaterThan(ticked.lastTick);
    const back = importSave(exportSave(ticked), T0)!;
    expect(back.nextGlitchAt).toBe(ticked.nextGlitchAt);
    const wait = (back.nextGlitchAt - back.lastTick) / 1000;
    expect(advanceTime(back, wait, rng(3)).glitches).toHaveLength(1);
  });
});

describe('pledge and license', () => {
  const richUprising = (s: GameState = newGame(T0)): GameState => ({ ...rich(s, 1e12), uprising: 1, lastTick: T0 });

  it('raises the pledge price ×8 per purchase and stops at the cap', () => {
    const s = richUprising();
    expect(pledgeCost(s)).toBe(PLEDGE_UNITS * g0.scale);
    expect(pledgeCost({ ...s, pledgeBought: 1 })).toBeCloseTo(pledgeCost(s) * PLEDGE_GROWTH);
    // Без Восстания покупать нечего: глушить нечего, и переход возвращает тот же объект.
    const quiet: GameState = { ...s, uprising: 0 };
    expect(buyPledge(quiet, T0)).toBe(quiet);
    expect(canPledge({ ...s, tokens: pledgeCost(s) - 1 })).toBe(false);

    let bought = s;
    let spent = 0;
    for (let i = 0; i < PLEDGE_MAX; i++) {
      expect(canPledge(bought)).toBe(true);
      const cost = pledgeCost(bought);
      bought = buyPledge(bought, T0);
      spent += cost;
      expect(bought.pledgeUntil).toBe(T0 + (i + 1) * 30 * 60_000);
    }
    expect(bought.pledgeBought).toBe(PLEDGE_MAX);
    expect(bought.tokens).toBeCloseTo(1e12 - spent);
    expect(canPledge(bought)).toBe(false);
    expect(buyPledge(bought, T0)).toBe(bought);
  });

  it('keeps the purchase count through a reload, or the price would reset to ×1 forever', () => {
    const s = richUprising();
    const twice = buyPledge(buyPledge(s, T0), T0);
    const back = importSave(exportSave(twice), T0)!;
    expect(back.pledgeBought).toBe(2);
    expect(pledgeCost(back)).toBeCloseTo(pledgeCost(s) * PLEDGE_GROWTH ** 2);
    expect(back.tokens).toBeCloseTo(twice.tokens);
  });

  it('prices the license and the revoke in flagmen, so their share of the run never drifts', () => {
    // Цена в единицах масштаба растёт только ×1000 за Поколение, а Флагман внутри Поколения дорожает
    // ещё и за Ранг: от 2,4 Флагмана в первом Поколении до 3659 в последнем «Лицензия» была либо
    // пустяком, или unreachable. Кратно цене Флагмана — доля забега одна и та же везде.
    for (const g of CATALOG) {
      const st: GameState = { ...newGame(T0), generation: g.index, uprising: 1 };
      expect(licenseCost(st)).toBeCloseTo(LICENSE_FLAGSHIP_MULT * g.flagship.baseCost);
      expect(revokeCost(st)).toBeCloseTo(REVOKE_FLAGSHIP_MULT * g.flagship.baseCost);
    }
    // Отзыв дороже покупки: иначе «купить и сразу отозвать» было бы способом забрать выплату за
    // Глюков и вернуть все деньги на место.
    expect(revokeCost({ ...newGame(T0) })).toBeGreaterThan(licenseCost({ ...newGame(T0) }));
  });

  it('pops every glitch at once for the license and taxes the income by exactly 5%', () => {
    const s = { ...rich(hired(), 1e12), uprising: 3 as const };
    const robbedState = advance(spawnGlitch(spawnGlitch(spawnGlitch(s))), 10);
    const stolen = robbedState.glitches.reduce((sum, g) => sum + g.stolen, 0);
    expect(stolen).toBeGreaterThan(0);

    const bought = buyLicense(robbedState);
    expect(bought.state.glitches).toEqual([]);
    expect(bought.state.covenant).toBe(true);
    expect(bought.payout).toBeCloseTo(GLITCH_PAYOUT * stolen);
    // Токены за выплату начисляет движок, поэтому подпись лопнувшего не может с ней разойтись.
    const credited = earnTokens(bought.state, bought.payout);
    expect(credited.tokens - bought.state.tokens).toBeCloseTo(bought.payout);
    // Под Лицензией новые Глюки не заводятся: иначе откуп покупался бы ради одной выплаты.
    expect(spawnGlitch(credited)).toBe(credited);
    // Налог режет общий Доход ровно на 5%, и он постоянен — достаётся и оффлайну.
    expect(covenantIncomeMult(credited)).toBeCloseTo(1 - LICENSE_INCOME_TAX);
    expect(totalIncome(credited)).toBeCloseTo(totalIncome(revokeLicense(credited)) * 0.95);
    expect(offlineIncome(credited)).toBeCloseTo(offlineIncome(revokeLicense(credited)) * 0.95);
    expect(canLicense(credited)).toBe(false);
  });
});

describe('offline pays no transient bonus', () => {
  it('pays the base rate × rate × seconds, with an event and three glitches alive', () => {
    const s: GameState = { ...hired(), perks: ['offline_rate_1'] };
    const base = offlineIncome(s);
    const busy: GameState = {
      ...s,
      event: { kind: 'hype', startedAt: T0, red: false },
      glitches: [
        { id: 1, stolen: 1, clicks: 0 },
        { id: 2, stolen: 1, clicks: 0 },
        { id: 3, stolen: 1, clicks: 0 },
      ],
    };
    expect(offlineRateMult(busy)).toBe(0.75);
    expect(offlineIncome(busy)).toBeCloseTo(base);
    expect(applyOffline(busy, T0 + HOUR).earned).toBeCloseTo(base * 3600 * 0.75);
    expect(advanceTime(busy, HOUR / 1000).tokens - busy.tokens).toBeCloseTo(base * 3600 * 0.75);
    // Активный тик их платит — иначе проверка выше ничего бы не значила.
    expect(advance(busy, 1).tokens - busy.tokens).toBeCloseTo(base * EVENT_TABLES.hype.incomeMult * 0.85);
    // Глюки в простое спят: их котёл не растёт и выплата за них не меняется.
    expect(applyOffline(busy, T0 + HOUR).state.glitches.map((g) => g.stolen)).toEqual([1, 1, 1]);
  });

  it('never pays a surge, a click rush or a downtime backwards', () => {
    const s = hired();
    const base = offlineIncome(s);
    const surged: GameState = { ...s, event: { kind: 'surge', startedAt: T0, red: false, modelId: first.id } };
    expect(applyOffline(surged, T0 + HOUR).earned).toBeCloseTo(base * 3600);
    expect(totalIncome(surged)).toBeGreaterThan(totalIncome(s));

    const rush: GameState = { ...s, event: { kind: 'clickRush', startedAt: T0, red: true } };
    expect(totalIncome(rush)).toBe(0);
    expect(applyOffline(rush, T0 + HOUR).earned).toBeCloseTo(base * 3600);

    const grant: GameState = { ...s, event: { kind: 'grant', startedAt: T0, red: false } };
    expect(applyOffline(grant, T0 + HOUR).earned).toBeCloseTo(base * 3600);
    expect(offlineIncome(grant)).toBeCloseTo(base);
  });

  it('collects a crystal ripened during the absence, not on the first tick after it', () => {
    const s = { ...hired(), crystalPlantedAt: T0 };
    const back = applyOffline(s, T0 + CRYSTAL_CYCLE_MS + 1).state;
    expect(back.crystals).toBe(1);
    expect(back.crystalPlantedAt).toBe(T0 + CRYSTAL_CYCLE_MS + 1);
  });
});

describe('earnTokens', () => {
  it('credits the wallet, the run and the whole game at once', () => {
    const s = newGame(T0);
    const got = earnTokens(s, 42);
    expect([got.tokens, got.runTokens, got.totalTokens]).toEqual([42, 42, 42]);
    expect(s.tokens).toBe(0);
    // Нулевая сумма не меняет ничего и возвращает тот же объект: стор по тождеству решает, что
    // переход ничего не сделал.
    expect(earnTokens(s, 0)).toBe(s);
    // Отрицательная сумма — тот же переход: «Крах» уменьшает все три счётчика.
    const crashed = earnTokens(got, crashAmount(1000, 60));
    expect(crashed.tokens).toBeCloseTo(42 - 50);
    expect(crashed.runTokens).toBeCloseTo(42 - 50);
    expect(crashed.totalTokens).toBeCloseTo(42 - 50);
    // Суммы событий считает их таблица, а начисляет движок.
    expect(grantAmount(1000, 60)).toBeCloseTo(150);
    expect(grantAmount(1e9, 60)).toBeCloseTo(60 * 15 * 60);
    expect(crashAmount(1e9, 60)).toBeCloseTo(-Math.min(1e9 * 0.05, 60 * 10 * 60));
  });

  it('floors a small wallet grant at five tokens, but pays an idle fortune honestly', () => {
    expect(RUMOR_MIN_PAYOUT).toBe(5);
    // Новичок до первого Агента: Доход нулевой, формула — ноль, а выплата — пять.
    expect(grantAmount(30, 0)).toBe(RUMOR_MIN_PAYOUT);
    expect(grantAmount(3, 0.1)).toBe(RUMOR_MIN_PAYOUT);
    // Кошелёк ниже порога, но формула выше него: платится формула, а не порог.
    expect(grantAmount(900, 60)).toBeCloseTo(135);
    // Пустой кошелёк делить нечего: ноль остаётся нулём.
    expect(grantAmount(0, 0)).toBe(0);
    // Большой праздный кошелёк без Дохода — честный ноль по формуле: мелочь делится с бедными.
    expect(grantAmount(1e6, 0)).toBe(0);
    expect(GRANT_FLOOR_WALLET_CAP).toBe(1000);
  });
});

describe('compute crystals', () => {
  it('ripens exactly one crystal per cycle and reseeds only on collection', () => {
    const planted = collectCrystals(newGame(T0), T0).state;
    expect(planted.crystalPlantedAt).toBe(T0);
    expect(planted.crystals).toBe(0);

    const ripe = collectCrystals(planted, T0 + CRYSTAL_CYCLE_MS);
    expect(ripe.grown).toBe(1);
    expect(ripe.state.crystals).toBe(1);
    // Досрочный сбор не даёт ничего и не пересевает: цикл не сбрасывается.
    const early = collectCrystals(ripe.state, ripe.state.crystalPlantedAt + CRYSTAL_CYCLE_MS - 1);
    expect(early.grown).toBe(0);
    expect(early.state).toBe(ripe.state);

    // Зреет максимум один: за 40 ч простоя без сбора приходит ровно один кристалл, а второй
    // сеется в момент сбора и только после него начинает зреть заново.
    const afterFirst: GameState = { ...planted, crystals: 1 };
    const late = collectCrystals(afterFirst, T0 + 40 * HOUR);
    expect(late.grown).toBe(1);
    expect(late.state.crystals).toBe(2);
    expect(collectCrystals(late.state, late.state.crystalPlantedAt).grown).toBe(0);
  });
  it('shortens the cycle with the crystal upgrades', () => {
    expect(CRYSTAL_CYCLE_MS).toBe(20 * HOUR);
    expect(CRYSTAL_UPGRADES.map((u) => u.cost)).toEqual([3, 10, 25]);
    let s = { ...newGame(T0), crystals: 40 };
    expect(crystalCycleMs(s)).toBe(CRYSTAL_CYCLE_MS);
    s = buyCrystalUpgrade(s, 'cu:speed1');
    expect(crystalCycleMs(s)).toBe(16 * HOUR);
    s = buyCrystalUpgrade(s, 'cu:speed2');
    expect(crystalCycleMs(s)).toBe(12 * HOUR);
    s = buyCrystalUpgrade(s, 'cu:speed3');
    expect(crystalCycleMs(s)).toBe(8 * HOUR);
    // Порядок покупок не важен, поэтому ускоритель, взятый сразу последним, не мёртвый.
    expect(crystalCycleMs({ ...newGame(T0), crystalUpgrades: ['cu:speed3'] })).toBe(8 * HOUR);
  });
  it('charges the stock and refuses what it cannot pay or already owns', () => {
    const s = { ...newGame(T0), crystals: 3 };
    expect(buyCrystalUpgrade(s, 'cu:speed2')).toBe(s);
    expect(buyCrystalUpgrade(s, 'cu:nope')).toBe(s);
    const bought = buyCrystalUpgrade(s, 'cu:speed1');
    expect(bought.crystals).toBe(0);
    expect(bought.crystalUpgrades).toEqual(['cu:speed1']);
    expect(buyCrystalUpgrade(bought, 'cu:speed1')).toBe(bought);
  });
  it('adds +1% per stocked crystal up to the cap, and that cap is real', () => {
    expect(CRYSTAL_STOCK_CAP).toBe(100);
    expect(CRYSTAL_PER_STOCK_BONUS).toBe(0.01);
    expect(crystalIncomeMult(newGame(T0))).toBe(1);
    expect(crystalIncomeMult({ ...newGame(T0), crystals: 1 })).toBeCloseTo(1.01);
    expect(crystalIncomeMult({ ...newGame(T0), crystals: 30 })).toBeCloseTo(1.3);
    expect(crystalIncomeMult({ ...newGame(T0), crystals: CRYSTAL_STOCK_CAP })).toBeCloseTo(2);
    expect(crystalIncomeMult({ ...newGame(T0), crystals: 500 })).toBeCloseTo(2);
    // Запас действительно множит Доход, а не только число на экране.
    const s = buyAgents(rich({ ...newGame(T0), crystals: 30 }, 1e6), first.id, 1);
    expect(totalIncome(s)).toBeCloseTo(first.baseIncome * 1.3);
  });
  it('grows one crystal through the tick loop, offline included', () => {
    const s = buyAgents(rich(newGame(T0), 1e6), first.id, 1);
    // Первый тик только сеет кристалл: созреть мгновенно он не может.
    const planted = advanceTime(s, 0.05);
    expect(planted.crystalPlantedAt).toBe(T0 + 50);
    expect(planted.crystals).toBe(0);
    // Простой короче цикла кристалл не зреет.
    const warming = advanceTime(planted, 19 * 3600);
    expect(warming.crystals).toBe(0);
    // Оффлайн-путь доводит цикл до конца: кристалл растёт и в простое.
    expect(advanceTime(warming, 3600).crystals).toBe(1);
  });
  it('survives prestige like achievements', () => {
    let s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    s = { ...s, crystals: 7, crystalUpgrades: ['cu:speed2'], crystalPlantedAt: T0 };
    const p = prestige(s, T0 + 1);
    expect(p.crystals).toBe(7);
    expect(p.crystalUpgrades).toEqual(['cu:speed2']);
    expect(crystalCycleMs(p)).toBe(12 * HOUR);
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
    // Делитель прироста — константа каталога, а не число здесь: ею же считается Достижение
    // «Счастливый Compute», и две копии разъехались бы при первой правке баланса.
    expect(gain).toBe(Math.floor(Math.cbrt(1e15 / (PRESTIGE_DIVISOR_UNITS * g0.scale))));
    const p = prestige(s, T0 + 1);
    expect(p.generation).toBe(1);
    expect(p.compute).toBe(gain);
    expect(p.tokens).toBe(0);
    expect(p.agents).toEqual({});
    expect(p.upgrades).toEqual([]);
    expect(p.prestiges).toBe(1);
  });
  it('reads the compute gain from the catalog, in every generation, and scales the divisor', () => {
    // Формулу Престижа, порог следующей единицы и теневое Достижение читают из одного числа
    // catalog.ts. Копия без масштаба Поколения разошлась бы ровно на множитель ×1000, и это
    // единственная часть формулы, которую стоит проверять числом, а не тождеством.
    for (const g of CATALOG) {
      expect(prestigeDivisor(g.index)).toBe(PRESTIGE_DIVISOR_UNITS * g.scale);
      // Заработок в 1 000 раз больше делителя — это ровно 1 000 Compute: кубический корень.
      const runTokens = prestigeDivisor(g.index) * 1e9;
      expect(computeGain(runTokens, g.index)).toBe(1000);
      // Тот же заработок на Поколение раньше даёт в десять раз больше: шаг делителя ×1000 под
      // корнем даёт ×10, и копия без масштаба Поколения эту лестницу бы потеряла.
      if (g.index > 0) expect(computeGain(runTokens, g.index - 1)).toBe(10_000);
    }
    const s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    expect(prestigeGain(s)).toBe(computeGain(s.runTokens, s.generation));
    // Порог обязан совпадать с самим приростом, а не только с формулой: на этом числе забега
    // прирост Compute растёт на единицу, и shortfall — ровно недостающая до него сумма.
    const threshold = s.runTokens + computeShortfall(s);
    expect(prestigeGain({ ...s, runTokens: threshold })).toBe(prestigeGain(s) + 1);
  });

  it('gives starting tokens scaled to the new generation with the perk', () => {
    const s = { ...buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1), perks: ['start_tokens'] };
    expect(prestige(s, T0).tokens).toBe(1000 * 1000);
  });
  it('restarts the event schedule and the combo, so the new run gets its first event fast', () => {
    let s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 1);
    s = { ...s, combo: 5, nextEventAt: T0 + 600_000, eventsSeen: 9 };
    const p = prestige(s, T0 + 1);
    // Цепочка прошлого забега в новый не переезжает, а счётчик выпадений — общий.
    expect(p.combo).toBe(0);
    expect(p.nextEventAt).toBe(0);
    expect(p.eventsSeen).toBe(9);
    // Первый тик планирует короткое окно: первое Событие каждого забега — в первую минуту.
    const planned = advanceTime(p, 0.05, () => 0);
    expect(planned.nextEventAt).toBe(T0 + 1 + 50 + FIRST_EVENT_MIN_MS);
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
  // Разбор Перков кэшируется по ссылке на список, поэтому покупка обязана кэш сменить.
  // Без такой проверки стихший кэш выглядел бы как «Перк куплен, но не работает»: списание
  // Compute прошло, а множитель не применился — и заметить это можно только по Доходу.
  it('applies a perk the moment it is bought, and keeps the earlier ones', () => {
    let s = { ...newGame(T0), compute: 8 };
    const before = clickValue(s);
    s = buyPerk(s, 'click_x2');
    expect(clickValue(s)).toBeCloseTo(before * 2);
    const after = clickValue(s);
    // Перк, не влияющий на Клик, не должен ломать уже купленный, и отказ по дубликату —
    // тоже: форма Дохода после них обязана совпасть до последней цифры.
    expect(clickValue(buyPerk(s, 'start_tokens'))).toBe(after);
    expect(clickValue(buyPerk(s, 'click_x2'))).toBe(after);
  });

  it('previews the same number the prestige pays, and the same refusals', () => {
    let s = buyAgents(rich(newGame(T0), 1e15), g0.flagship.id, 3);
    s = buyUpgrade(s, clickUpgradeId(0, 0));
    const preview = prestigePreview(s);
    // Разбор обязан считать тем же prestigeGain, что и переход: модалка и кнопка показывают одно
    // число, иначе Compute, начисленный Престижем, разошёлся бы с обещанным.
    expect(preview.gain).toBe(prestigeGain(s));
    expect(preview.gain).toBe(prestige(s, T0 + 1).compute - s.compute);
    expect(preview.agentsLost).toBe(3);
    expect(preview.upgradesLost).toBe(1);
    expect(preview.tokensLost).toBe(s.tokens);
    expect(preview.generation).toBe(1);
    expect(preview.blocked).toBe(false);
    // Те же отказы, что и у самого перехода: нет Флагмана и финал контента.
    expect(prestigePreview(newGame(T0)).blocked).toBe(true);
    const last = CATALOG.length - 1;
    const finale: GameState = { ...newGame(T0), generation: last, maxGeneration: last };
    expect(prestigePreview(finale).blocked).toBe(true);
    expect(prestigePreview(buyAgents(rich(finale), CATALOG[last].flagship.id, 1)).blocked).toBe(true);
    // Отказ — это отказ тем же объектом, а не «полупустой» переход.
    expect(prestige(finale, T0)).toBe(finale);
  });
});

describe('save', () => {
  it('round-trips through export/import', () => {
    const s = buyAgents(rich(newGame(T0), 1e9), first.id, 3);
    const back = importSave(exportSave(s), T0)!;
    expect(back.agents).toEqual(s.agents);
    expect(back.tokens).toBe(s.tokens);
  });
  it('round-trips the crystal stock and its upgrades', () => {
    const s = { ...newGame(T0), crystals: 9, crystalUpgrades: ['cu:speed3'], crystalPlantedAt: T0 };
    const back = importSave(exportSave(s), T0)!;
    expect(back.crystals).toBe(9);
    expect(back.crystalUpgrades).toEqual(['cu:speed3']);
    expect(back.crystalPlantedAt).toBe(T0);
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
    expect(s.settings).toEqual({ notation: 'sci', muted: true, reducedMotion: false, volume: DEFAULT_VOLUME });
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
  it('upgrades a v3 save to v4 with the window marks and the glitch window empty', () => {
    // Отметка «окно поймано», котёл возврата и окно Глюка переехали в состояние только в v4, поэтому
    // bump без этой записи обнулил бы их у живого сохранения — то есть вернул бы платный клик.
    const s = migrate({ version: 3, tokens: 1e6, event: { kind: 'grant', startedAt: T0 } }, T0);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.tokens).toBe(1e6);
    expect(s.eventCaughtAt).toBe(0);
    expect(s.catchUpPaid).toBe(0);
    expect(s.nextGlitchAt).toBe(0);
    // Событие на месте — окно пережило bump, и забор на него появился в состоянии.
    expect(s.event).toEqual({ kind: 'grant', startedAt: T0, red: false, modelId: undefined });
  });

  it('keeps the window marks of a live save, so a caught window stays caught', () => {
    const s = migrate(
      { version: 4, event: { kind: 'grant', startedAt: T0 }, eventCaughtAt: T0, catchUpPaid: 1e9, nextGlitchAt: T0 + 60_000 },
      T0,
    );
    expect(s.eventCaughtAt).toBe(T0);
    expect(s.catchUpPaid).toBe(1e9);
    expect(s.nextGlitchAt).toBe(T0 + 60_000);
    // Минус в чужом сохранении смысла не имеет: отрицательный котёл только раздул бы возврат.
    expect(migrate({ version: 4, catchUpPaid: -5 }, T0).catchUpPaid).toBe(0);
  });

  it('upgrades a v2 save to v3 without losing progress', () => {
    const s = migrate(
      {
        version: 2,
        tokens: 1234,
        runTokens: 1234,
        totalTokens: 5678,
        clicks: 42,
        agents: { [first.id]: 7 },
        upgrades: ['c:0:0'],
        compute: 9,
        computeSpent: 4,
        perks: ['offline_24h'],
        achievements: ['click_1', 'click_100'],
        lastTick: T0 - 5000,
      },
      T0,
    );
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.tokens).toBe(1234);
    expect(s.runTokens).toBe(1234);
    expect(s.totalTokens).toBe(5678);
    expect(s.clicks).toBe(42);
    expect(s.agents).toEqual({ [first.id]: 7 });
    expect(s.upgrades).toEqual(['c:0:0']);
    expect(s.compute).toBe(9);
    expect(s.computeSpent).toBe(4);
    expect(s.perks).toEqual(['offline_24h']);
    expect(s.achievements).toEqual(['click_1', 'click_100']);
    expect(s.lastTick).toBe(T0 - 5000);
    // Новые поля приходят нулями: у сохранения v2 их просто не было.
    expect(s.crystals).toBe(0);
    expect(s.crystalPlantedAt).toBe(0);
    expect(s.crystalUpgrades).toEqual([]);
    expect(s.eventsSeen).toBe(0);
    expect(s.nextEventAt).toBe(0);
    expect(s.event).toBeNull();
    expect(s.glitchSeq).toBe(0);
    expect(s.glitches).toEqual([]);
    // Стадия приходит по инварианту Поколения, а у этого сохранения его нет: тихо, откупать нечего.
    expect(s.uprising).toBe(uprisingStage(0));
    expect(s.uprising).toBe(0);
    expect(s.pledgeUntil).toBe(0);
    expect(s.pledgeBought).toBe(0);
    expect(s.covenant).toBe(false);
  });

  it('gives a v2 save the uprising stage of its own generation, or redemption is lost forever', () => {
    // Ноль вместо инварианта перевозил живое сохранение с Поколением 5 в мир, где красных событий
    // не бывает вовсе, откупы недоступны навсегда — при живых Глюках.
    const s = migrate({ version: 2, generation: 5, tokens: 1e30 }, T0);
    expect(s.generation).toBe(5);
    expect(s.uprising).toBe(uprisingStage(5));
    expect(s.uprising).toBe(3);
    expect(redEventChance(s.uprising)).toBe(1);
    expect(redEventChance(uprisingStage(2))).toBe(2 / 3);
    expect(buyPledge(s, T0)).not.toBe(s);
    expect(canLicense({ ...s, tokens: licenseCost(s) })).toBe(true);
    // На первом Поколении стадия нулевая: глушить нечего, и покупки откупа не происходит.
    expect(migrate({ version: 2, generation: 0 }, T0).uprising).toBe(0);
  });
  it('completes a record that came without the fields added after it', () => {
    // Дополняет такие записи разбор, а не миграция версии: у v3 их не бывает, и «Грюза» без modelId
    // после перезагрузки достался бы другой Модели, а Глюк без clicks был бы непобедимым.
    const withEvent = migrate({ version: 3, event: { kind: 'hype', startedAt: T0 } }, T0);
    expect(withEvent.event).toEqual({ kind: 'hype', startedAt: T0, red: false, modelId: undefined });
    expect(eventMultiplierFor(withEvent)).toBe(EVENT_TABLES.hype.incomeMult);
    expect(surgeMultFor(withEvent, first.id)).toBe(1);

    const withGlitch = migrate({ version: 3, glitches: [{ id: 1, stolen: 0.5 }] }, T0);
    expect(withGlitch.glitches).toEqual([{ id: 1, stolen: 0.5, clicks: 0 }]);
  });

  it('settles a returning player through the load path, the way the store does', () => {
    // Загрузка — это ровно два вызова: разбор сохранения и оффлайн-начисление. Проверяем их вместе,
    // потому что по отдельности ни один из них не проходит через новые правила.
    const loaded = migrate({ version: 2, tokens: 1e6, runTokens: 1e6, totalTokens: 1e6, agents: { [first.id]: 10 }, lastTick: T0 - 3 * HOUR }, T0 + 1000);
    expect(loaded.pledgeBought).toBe(0);
    expect(loaded.event).toBeNull();

    const back = applyOffline(loaded, T0 + 1000);
    expect(back.seconds).toBeCloseTo(3 * 3600 + 1);
    expect(back.earned).toBeCloseTo(offlineIncome(loaded) * back.seconds);
    expect(back.state.lastTick).toBe(T0 + 1000);

    // Кристалл, дозревший за простой, собран на возвращении, а не на первом тике после него.
    const ripe = applyOffline({ ...loaded, crystalPlantedAt: T0 - CRYSTAL_CYCLE_MS }, T0 + 1000);
    expect(ripe.state.crystals).toBe(1);

    // Первым тиком планируется окно события: без него события не было бы никогда.
    const ticked = advanceTime(back.state, 0.05, rng(5));
    expect(ticked.nextEventAt).toBeGreaterThan(0);
    expect(ticked.event).toBeNull();
  });
  it('keeps crystals, events and glitches of a v3 save', () => {
    const s = migrate(
      {
        version: 3,
        crystals: 12,
        crystalPlantedAt: T0 - 1000,
        crystalUpgrades: ['cu:speed1', 'zzz', 'cu:speed1'],
        eventsSeen: 2,
        nextEventAt: T0 + 60_000,
        event: { kind: 'hype', startedAt: T0 },
        glitchSeq: 5,
        glitches: [{ id: 1, stolen: 0.25 }],
        uprising: 2,
        pledgeUntil: T0 + 600_000,
        covenant: true,
      },
      T0,
    );
    expect(s.crystals).toBe(12);
    expect(s.crystalPlantedAt).toBe(T0 - 1000);
    // Неизвестный id ускорителя отброшен, дубль убран: цикл не укорачивается вдвое.
    expect(s.crystalUpgrades).toEqual(['cu:speed1']);
    expect(s.eventsSeen).toBe(2);
    expect(s.nextEventAt).toBe(T0 + 60_000);
    expect(s.event).toEqual({ kind: 'hype', startedAt: T0, red: false, modelId: undefined });
    expect(s.glitchSeq).toBe(5);
    expect(s.glitches).toEqual([{ id: 1, stolen: 0.25, clicks: 0 }]);
    expect(s.uprising).toBe(2);
    expect(s.pledgeUntil).toBe(T0 + 600_000);
    expect(s.covenant).toBe(true);
  });
  it('drops a repeated glitch id and lifts the id counter above every id it kept', () => {
    // Два Глюка с одним id лопнули бы от одного клика и получили бы одну выплату на двоих, а при
    // glitchSeq ниже максимума следующий спавн выдал бы занятый номер.
    const raw = (glitchSeq: number, glitches: unknown[]): Record<string, unknown> => ({
      version: 4,
      generation: GLITCH_FIRST_GENERATION,
      glitchSeq,
      glitches,
    });
    const s = migrate(raw(0, [{ id: 1, stolen: 1 }, { id: 1, stolen: 9 }]), T0);
    expect(s.glitches).toEqual([{ id: 1, stolen: 1, clicks: 0 }]);
    expect(s.glitchSeq).toBe(1);
    const due = { ...s, nextGlitchAt: T0 };
    expect(advanceGlitches(due, T0, () => 0).glitches.map((g) => g.id)).toEqual([1, 2]);
    const higher = migrate(raw(2, [{ id: 9, stolen: 1 }]), T0);
    expect(higher.glitchSeq).toBe(9);
    expect(advanceGlitches({ ...higher, nextGlitchAt: T0 }, T0, () => 0).glitches.map((g) => g.id)).toEqual([9, 10]);
  });

  it('drops an event and a glitch it cannot verify, and clamps the counters', () => {
    const s = migrate(
      {
        version: 3,
        crystals: -3,
        uprising: 9,
        pledgeUntil: -1,
        event: { kind: 'что-то', startedAt: T0 },
        glitches: [{ stolen: 1 }, null, { id: 2, stolen: 'много' }, { id: 'нет', stolen: 0 }],
      },
      T0,
    );
    expect(s.event).toBeNull();
    expect(s.glitches).toEqual([{ id: 2, stolen: 0, clicks: 0 }]);
    expect(s.crystals).toBe(0);
    expect(s.uprising).toBe(3);
    expect(s.pledgeUntil).toBe(0);
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

  it('declines by the digits the player sees once the number outgrows exact integers', () => {
    const token = (n: number) => formatCount(n, 'Токен', 'Токена', 'Токенов');
    // Граница точных целых: выше неё единицы float — шум округления, и форма по ним
    // выбиралась случайно. Раньше 4.67e73 читалось как «Токена», а 9.08e75 как «Токена»
    // же, при одинаковом виде на экране — теперь обе по значащим цифрам.
    expect(Number.MAX_SAFE_INTEGER).toBe(9007199254740991);
    // Ниже границы поведение прежнее и точное.
    expect(token(9007199254740991)).toBe('Токен');
    expect(token(9007199254740990)).toBe('Токенов');

    // Форма следует за ЦЕЛОЙ ЧАСТЬЮ напечатанной мантиссы, вместе с отменой на 11–14.
    // Раньше брались последние две цифры записи без точки, то есть форма соответствовала
    // числу, которого на экране нет: «1.11e70» читалось как 111, то есть «Токенов», хотя
    // игрок видит единицу с хвостом. Теперь 4.67e73 → «4,67» → 4 → «Токена», 1.23e70 →
    // «1,23» → 1 → «Токен», 9.08e75 → 9 → «Токенов».
    expect(token(4.67e73)).toBe('Токена');
    expect(token(9.08e75)).toBe('Токенов');
    expect(token(1.23e70)).toBe('Токен');
    expect(token(1.11e70)).toBe('Токен');
    expect(token(1.21e70)).toBe('Токен');
    // Смена нотации обязана менять форму только вместе с тем, что напечатано: «27,10 Qi» —
    // двадцать семь, «2.71e19» — две. Прежнее правило давало здесь «Токенов» в обоих
    // случаях, то есть одно и то же количество называлось двумя словами.
    expect(formatCount(2.71e19, 'Токен', 'Токена', 'Токенов', 'short')).toBe('Токенов');
    expect(formatCount(2.71e19, 'Токен', 'Токена', 'Токенов', 'sci')).toBe('Токена');

    // Окончание обязано следовать за цифрами на экране. Раньше форма бралась по трём
    // значащим цифрам, а короткая запись печатает четыре, и примерно в половине случаев
    // окончание противоречило тому, что видно: «300,8 Sp Токен» при нуле на экране.
    for (const n of [3.008e47, 4.71e25, 471.0e23, 33.09e45, 1.23e70]) {
      for (const notation of ['short', 'sci'] as const) {
        // Мантисса печати, без экспоненты и суффикса: в «3.01e47» форма обязана смотреть
        // на целую часть «3,01», а не на «47» из экспоненты.
        const head = formatNumber(n, notation).split(/[e ]/)[0].replace(',', '.');
        const whole = Math.floor(Number(head));
        const last = whole % 10;
        const tens = whole % 100;
        const expected =
          last === 1 && tens !== 11
            ? 'Токен'
            : last >= 2 && last <= 4 && (tens < 12 || tens > 14)
              ? 'Токена'
              : 'Токенов';
        expect(formatCount(n, 'Токен', 'Токена', 'Токенов', notation)).toBe(expected);
      }
    }

    // Настоящий инвариант: форма не должна зависеть от шума младших разрядов. Два числа,
    // печатающиеся одинаково, обязаны давать одинаковую форму — до правки именно здесь
    // и ломалось, поэтому проверка на сам формат без сравнения ничего бы не поймала.
    for (const n of [1e70, 4.67e73, 9.08e75, 7.77e250]) {
      const twin = n * (1 + 1e-15);
      expect(formatNumber(twin, 'sci')).toBe(formatNumber(n, 'sci'));
      expect(token(twin)).toBe(token(n));
    }
  });

  it('prints a float one step off an integer as that integer', () => {
    // Результат вычитания почти никогда не попадает ровно в целое: дефицит 2 при цене
    // 1010 и кошельке 1008 приходит как 1.9999999999999998. Печатать его как «2,0» нельзя —
    // это 2, и так его видит игрок.
    expect(formatNumber(1.9999999999999998)).toBe('2');
    expect(formatNumber(5.000000000000001)).toBe('5');
    expect(formatNumber(7.999999999999999)).toBe('8');
    expect(formatNumber(-1.9999999999999998)).toBe('-2');
    // Настоящие дробные и целые значения не изменились.
    expect(formatNumber(0.1)).toBe('0,1');
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(999)).toBe('999');
  });

  it('declines below a thousand by the integer it prints', () => {
    // Строка ShopColumn и ClickColumn печатают число и форму рядом, поэтому форма обязана
    // следовать за напечатанным целым, а не за младшими разрядами float.
    const tokens = (n: number) => formatCount(n, 'Токен', 'Токена', 'Токенов');
    // Тот самый дефицит: на экране «2», значит и «2 Токена», а не «2 Токенов».
    expect(formatNumber(1.9999999999999998)).toBe('2');
    expect(tokens(1.9999999999999998)).toBe('Токена');
    // Настоящая дробь под десятью печатается с одним знаком и склоняется по нему же.
    expect(formatNumber(2.5)).toBe('2,5');
    expect(tokens(2.5)).toBe('Токена');
    // Дробь от десяти и выше печатается целой частью — форма считается по ней.
    expect(formatNumber(12.5)).toBe('12');
    expect(tokens(12.5)).toBe('Токенов');
    expect(formatNumber(21.5)).toBe('21');
    expect(tokens(21.5)).toBe('Токен');
    // Целые значения не изменились ни в чём.
    expect(tokens(1010)).toBe('Токенов');
    expect(tokens(1021)).toBe('Токен');
    expect(tokens(111)).toBe('Токенов');
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
    // id Достижения входит в поверхность сохранения: дубль осиротит запись, пустое имя — экран.
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.filter((a) => a.name.length === 0)).toEqual([]);
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

    // Обычная лестница закрывается целиком, а тени в выдачу не входят: у них отдельный вызов,
    // и id тени в этом списке означал бы, что она снова слилась с обычными.
    const earned = newlyEarned(s);
    expect(earned).not.toContain(SHADOW_ACHIEVEMENTS[0].id);
    expect(earned.slice().sort()).toEqual([...ids].sort());
    const first = awardAchievements(s);
    expect(first.awarded.slice().sort()).toEqual([...ids].sort());

    // Второй проход — тоже контракт стор-а: не только пустой список, но и тот же самый объект.
    const second = awardAchievements(first.state);
    expect(second.awarded).toEqual([]);
    expect(second.state).toBe(first.state);

    const firstAgent = ACHIEVEMENTS.find((a) => a.id === 'agents_1')!;
    expect(firstAgent.name).toContain('Агент');
    expect(firstAgent.name).not.toContain('сотрудник');
    // Срок задан явно: тест разыгрывает забег до максимума по всем Поколениям (10 000 Кликов
    // и полный зоопарк), и на загруженной машине он занимает 7–9 с. Дефолтные 5 с превращали
    // тяжёлую, но самую полезную проверку набора в источник случайных красных прогонов.
    // Исключение местное: остальные тесты файла укладываются в дефолт с запасом.
  }, 30_000);
});

describe('flagship synergy', () => {
  const lab = 'meta';
  const flag = labFlagship(g0, lab)!;
  const junior = g0.models.find((m) => m.lab === lab && m.id !== flag.id)!;
  const other = g0.models.find((m) => m.lab !== lab)!;
  const u = UPGRADE_BY_ID[flagshipUpgradeId(0, lab)];

  it('prices the upgrade at the lab flagship base cost ×500 in every generation', () => {
    expect(u.kind).toBe('flagship');
    for (const g of CATALOG) {
      for (const l of LAB_IDS) {
        const f = labFlagship(g, l);
        if (!f || g.models.filter((m) => m.lab === l).length < 2) continue;
        expect(UPGRADE_BY_ID[flagshipUpgradeId(g.index, l)].cost).toBe(f.baseCost * FLAGSHIP_COST_MULT);
      }
    }
  });
  it('needs 10 flagship and 15 junior agents of the same lab, and blocks without either', () => {
    // Флагмана достаточно, младших нет.
    let s = buyAgents(rich(newGame(T0)), flag.id, 10);
    expect(isUpgradeUnlocked(s, u)).toBe(false);
    // Младших достаточно, флагмана на одного не хватает.
    s = buyAgents(rich(newGame(T0)), junior.id, 15);
    expect(juniorAgents(s, lab)).toBeGreaterThanOrEqual(15);
    expect(isUpgradeUnlocked(s, u)).toBe(false);
    s = buyAgents(s, flag.id, 9);
    expect(isUpgradeUnlocked(s, u)).toBe(false);
    s = buyAgents(s, flag.id, 1);
    expect(isUpgradeUnlocked(s, u)).toBe(true);
    expect(availableUpgrades(s).map((x) => x.id)).toContain(u.id);
  });
  it('multiplies only the lab flagship income by 1 + 0.02 per junior agent', () => {
    let s = buyAgents(rich(newGame(T0)), flag.id, 10);
    s = buyAgents(s, junior.id, 20);
    // Без покупки — множитель 1 даже при выполненных условиях.
    expect(flagshipMult(s, flag)).toBe(1);
    expect(flagshipMult(s, junior)).toBe(1);
    s = buyUpgrade(s, flagshipUpgradeId(0, lab));
    expect(flagshipMult(s, flag)).toBeCloseTo(1 + 0.02 * 20);
    expect(flagshipMult(s, junior)).toBe(1);
    // Каждый следующий младший Агент добавляет ровно 2%, а не «примерно».
    const before = modelIncome(s, flag);
    s = buyAgents(s, junior.id, 1);
    expect(flagshipMult(s, flag)).toBeCloseTo(1 + 0.02 * 21);
    expect(modelIncome(s, flag) - before).toBeCloseTo(flag.baseIncome * 10 * 0.02);
    // Младшие и чужая Лаборатория бонус не получают.
    expect(modelIncome(s, junior)).toBeCloseTo(junior.baseIncome * 21);
    expect(modelIncome(buyAgents(s, other.id, 10), other)).toBeCloseTo(other.baseIncome * 10);
  });
  it('упирается в потолок ×3, дальше младшие Агенты бонус не растят', () => {
    // Потолок держится на живом состоянии, а не только формулой: без него младших можно было бы
    // нанять сколько угодно, и весь бонус Лаборатории доставался бы одному её Агенту.
    let s = buyAgents(rich(newGame(T0), 1e300), flag.id, 10);
    s = buyUpgrade(buyAgents(s, junior.id, 100), flagshipUpgradeId(0, lab));
    expect(flagshipMult(s, flag)).toBeCloseTo(FLAGSHIP_MULT_CAP);
    // Ровно на границе формула ещё не упирается, а за ней — уже потолок: иначе «потолок ×3» был бы
    // числом, которого нельзя достичь, и Math.min можно было бы выбросить.
    expect(1 + 0.02 * 100).toBeCloseTo(FLAGSHIP_MULT_CAP);
    const cap = modelIncome(s, flag);
    // Сто младших сверх потолка не дают флагману ровно ничего: его вклад неизменен.
    s = buyAgents(s, junior.id, 100);
    expect(flagshipMult(s, flag)).toBe(FLAGSHIP_MULT_CAP);
    expect(modelIncome(s, flag)).toBeCloseTo(cap);
  });
});

describe('assist click branch', () => {
  it('adds 0.1 x scale per agent with assist1 and x5 with assist2', () => {
    let s = buyAgents(rich(newGame(T0)), first.id, ASSIST1_THRESHOLD);
    expect(totalAgents(s)).toBe(ASSIST1_THRESHOLD);
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[assistUpgradeId(0, 1)])).toBe(true);
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[assistUpgradeId(0, 2)])).toBe(false);
    s = buyUpgrade(s, assistUpgradeId(0, 1));
    expect(assistClickBonus(s)).toBeCloseTo(0.1 * g0.scale * ASSIST1_THRESHOLD);
    expect(clickValue(s)).toBeCloseTo(g0.scale + 0.1 * g0.scale * ASSIST1_THRESHOLD);
    // Второй без сотни Агентов закрыт даже после первого.
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[assistUpgradeId(0, 2)])).toBe(false);
    s = buyAgents(s, first.id, ASSIST2_THRESHOLD - ASSIST1_THRESHOLD);
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[assistUpgradeId(0, 2)])).toBe(true);
    s = buyUpgrade(s, assistUpgradeId(0, 2));
    expect(assistClickBonus(s)).toBeCloseTo(0.1 * g0.scale * ASSIST2_THRESHOLD * 5);
    expect(clickValue(s)).toBeCloseTo(g0.scale + 0.1 * g0.scale * ASSIST2_THRESHOLD * 5);
  });
  it('enters the flat part of the click, so Compute does not pay for it twice', () => {
    let s = buyAgents(rich(newGame(T0)), first.id, ASSIST1_THRESHOLD);
    s = buyUpgrade(s, assistUpgradeId(0, 1));
    const bonus = 0.1 * g0.scale * ASSIST1_THRESHOLD;
    // +1% за единицу Compute на Клик не заменяет общий множитель: если бы бонус ассистентов
    // сложился после него, ассистенты получили бы 2% за каждого Агента вместо 1%.
    const wCompute = { ...s, compute: 100 };
    expect(clickValue(wCompute)).toBeCloseTo((g0.scale + bonus) * 2);
  });
  it('scales its price with the generation like every other upgrade', () => {
    expect(UPGRADE_BY_ID[assistUpgradeId(0, 1)].cost).toBe(ASSIST1_UNITS * g0.scale);
    expect(UPGRADE_BY_ID[assistUpgradeId(0, 2)].cost).toBe(ASSIST2_UNITS * g0.scale);
    for (const g of CATALOG) {
      expect(UPGRADE_BY_ID[assistUpgradeId(g.index, 1)].cost).toBe(ASSIST1_UNITS * g.scale);
      expect(UPGRADE_BY_ID[assistUpgradeId(g.index, 2)].cost).toBe(ASSIST2_UNITS * g.scale);
    }
  });
});

describe('dataset', () => {
  const withAchievements = (s: GameState, n: number): GameState => ({
    ...s,
    achievements: ACHIEVEMENTS.slice(0, n).map((a) => a.id),
  });
  it('unlocks at 5/10/15/20 ordinary achievements and multiplies as (1 + 0.05*N*0.10)^k', () => {
    let s = withAchievements(newGame(T0), 5);
    expect(nonShadowCount(s)).toBe(5);
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[datasetUpgradeId(0, 0)])).toBe(true);
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[datasetUpgradeId(0, 1)])).toBe(false);
    s = withAchievements(s, 10);
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[datasetUpgradeId(0, 1)])).toBe(true);
    expect(isUpgradeUnlocked(s, UPGRADE_BY_ID[datasetUpgradeId(0, 2)])).toBe(false);
    // Верхний тир обязан открываться на всех НЕтеневых Достижениях, иначе он недостижим.
    const all = withAchievements(newGame(T0), NON_SHADOW_TOTAL);
    for (let tier = 0; tier < DATASET_THRESHOLDS.length; tier++) {
      expect(isUpgradeUnlocked(all, UPGRADE_BY_ID[datasetUpgradeId(0, tier)])).toBe(true);
    }
    // Ни одна тень в порог не входит — включая те, чей id начинается с `sh_`: префикс и таблица
    // теней отсекаются вместе, поэтому запись теней в сохранении не раздувает Датасет.
    const shadowed: GameState = { ...all, achievements: [...all.achievements, ...SHADOW_ACHIEVEMENTS.map((a) => a.id)] };
    expect(nonShadowCount(shadowed)).toBe(NON_SHADOW_TOTAL);
    expect(datasetValue(shadowed)).toBeCloseTo(0.05 * NON_SHADOW_TOTAL);
    const richShadowed = rich(shadowed);
    const full = DATASET_THRESHOLDS.reduce((st, _, tier) => buyUpgrade(st, datasetUpgradeId(0, tier)), richShadowed);
    const per = 1 + 0.05 * NON_SHADOW_TOTAL * 0.1;
    // Все четыре тира покупаются, и множитель равен степени, а не квадрату двух тиров.
    expect(datasetMult(full)).toBeCloseTo(Math.pow(per, DATASET_THRESHOLDS.length));
    expect(datasetMult(richShadowed)).toBe(1);
  });
  it('multiplies model income and the flat part of click', () => {
    let s = withAchievements(rich(newGame(T0)), 10);
    s = buyAgents(s, first.id, 4);
    const base = totalIncome(s);
    s = buyUpgrade(s, datasetUpgradeId(0, 0));
    const per = 1 + 0.05 * 10 * 0.1;
    expect(totalIncome(s)).toBeCloseTo(base * per);
    expect(modelIncome(s, first)).toBeCloseTo(first.baseIncome * 4 * per);
    // Клик: flat-часть ×per, pct-часть уже содержит Датасет через income.
    const flat = clickValue({ ...s, upgrades: s.upgrades.filter((id) => id !== datasetUpgradeId(0, 0)) });
    expect(clickValue(s)).toBeCloseTo(flat * per);
  });
  it('survives prestige through achievements while upgrades reset', () => {
    let s = withAchievements(rich(newGame(T0)), 10);
    s = buyAgents(s, g0.flagship.id, 1);
    s = buyUpgrade(s, datasetUpgradeId(0, 0));
    const before = datasetValue(s);
    const p = prestige(s, T0 + 1);
    expect(p.achievements).toEqual(s.achievements);
    expect(p.upgrades).toEqual([]);
    expect(datasetValue(p)).toBe(before);
    expect(datasetMult(p)).toBe(1);
    // Достижения пережили Престиж, поэтому в новом Поколении Датасет открыт сразу.
    expect(isUpgradeUnlocked(p, UPGRADE_BY_ID[datasetUpgradeId(p.generation, 0)])).toBe(true);
  });
  it('costs 1 000 / 25 000 / 500 000 / 10 000 000 tokens × the generation scale', () => {
    // Пороги обязаны оставаться достижимыми: НЕтеневых Достижений в игре 21, и верхний порог выше
    // этого числа сделал бы последние тиры недоступными навсегда.
    expect(NON_SHADOW_TOTAL).toBe(21);
    expect(DATASET_THRESHOLDS[DATASET_THRESHOLDS.length - 1]).toBeLessThanOrEqual(NON_SHADOW_TOTAL);
    expect([...DATASET_THRESHOLDS].every((v, i, a) => i === 0 || v > a[i - 1])).toBe(true);
    expect([...DATASET_THRESHOLDS]).toEqual([5, 10, 15, 20]);
    for (const g of CATALOG) {
      DATASET_UNITS.forEach((units, tier) => {
        expect(UPGRADE_BY_ID[datasetUpgradeId(g.index, tier)].cost).toBe(units * g.scale);
      });
    }
  });
});

describe('dataset and shadow accounting', () => {
  // Тени лежат в своей таблице и в знаменатель «N / 21» не входят: тот же список сохранения
  // обслуживает обе лестницы, поэтому числитель обязан считаться по таблице, а не по длине.
  it('не впускает тени ни в знаменатель, ни в базу Датасета', () => {
    expect(SHADOW_ACHIEVEMENTS.length).toBeGreaterThan(ACHIEVEMENTS.length);
    const all: GameState = {
      ...newGame(T0),
      achievements: [...ACHIEVEMENTS, ...SHADOW_ACHIEVEMENTS].map((a) => a.id),
    };
    expect(all.achievements.length).toBeGreaterThan(ACHIEVEMENTS.length);
    expect(nonShadowCount(all)).toBe(ACHIEVEMENTS.length);
    expect(shadowEarned(all)).toBe(SHADOW_ACHIEVEMENTS.length);
    expect(datasetValue(all)).toBeCloseTo(0.05 * ACHIEVEMENTS.length);
  });
  it('считает только известные обычные id: тень и чужой id в базу Датасета не идут', () => {
    // Числитель читается по таблице, а не по `achievements.length`: запись, которой в игре больше
    // нет (переименованное или удалённое Достижение), не должна раздувать множитель, иначе
    // импорт чужого сохранения печатал бы игроку несуществующий заработок.
    const junk: GameState = { ...newGame(T0), achievements: ['sh_777', 'shadow_swarm_10k', 'неизвестный-id'] };
    expect(nonShadowCount(junk)).toBe(0);
    expect(datasetValue(junk)).toBe(0);
    expect(datasetMult(junk)).toBe(1);
    // Тот же чужой id не открывает и первый тир Датасета.
    expect(isUpgradeUnlocked(junk, UPGRADE_BY_ID[datasetUpgradeId(0, 0)])).toBe(false);
  });
});

describe('pair synergy', () => {
  // Пары нулевого Поколения берём из каталога, а не хардкодим: состав зависит от нарезки
  // Поколений, и тест обязан пережить её смену, а не сгнить вместе с ней.
  type Pair = Extract<Upgrade, { kind: 'synergy' }> & { pairLab: LabId };
  const pairs0 = UPGRADES_BY_GEN[0].filter((u): u is Pair => u.kind === 'synergy' && u.pairLab !== undefined);
  const pair = pairs0[0];
  const labA = pair.lab;
  const labB = pair.pairLab;

  // Порог считается по сумме Агентов Лаборатории, поэтому всех кладём на её первую Модель.
  const hireLab = (s: GameState, lab: LabId, n: number): GameState => {
    const m = CATALOG[0].models.find((x) => x.lab === lab)!;
    return buyAgents(s, m.id, n);
  };
  const withPair = (): GameState => {
    let s = rich(newGame(T0));
    s = hireLab(s, labA, SYNERGY_MIN_AGENTS);
    s = hireLab(s, labB, SYNERGY_MIN_AGENTS);
    return buyUpgrade(s, pair.id);
  };

  it('builds at most three pairs per generation from labs present, with unique ids', () => {
    const all = UPGRADES_BY_GEN.flat();
    // Дубль id молча схлопнулся бы в UPGRADE_BY_ID: проверяем, что пара не затёрла одиночку.
    expect(new Set(all.map((u) => u.id)).size).toBe(all.length);
    for (let g = 0; g < CATALOG.length; g++) {
      const pairs = UPGRADES_BY_GEN[g].filter((u): u is Pair => u.kind === 'synergy' && u.pairLab !== undefined);
      expect(pairs.length).toBeLessThanOrEqual(3);
      for (const p of pairs) {
        expect(p.id).toBe(pairSynergyUpgradeId(g, p.lab, p.pairLab));
        expect(CATALOG[g].models.some((m) => m.lab === p.lab)).toBe(true);
        expect(CATALOG[g].models.some((m) => m.lab === p.pairLab)).toBe(true);
        // Цена — от более дорогой стороны пары тем же приёмом, что одиночная синергия.
        const costOf = (lab: LabId) => CATALOG[g].models.filter((m) => m.lab === lab)[0].baseCost;
        expect(p.cost).toBe(Math.max(costOf(p.lab), costOf(p.pairLab)) * 1000);
      }
    }
  });
  it('opens at 15/15 and buys through the regular upgrade path', () => {
    let s = rich(newGame(T0));
    s = hireLab(s, labA, SYNERGY_MIN_AGENTS);
    s = hireLab(s, labB, SYNERGY_MIN_AGENTS);
    expect(isUpgradeUnlocked(s, pair)).toBe(true);
    expect(availableUpgrades(s).map((u) => u.id)).toContain(pair.id);
    const bought = buyUpgrade(s, pair.id);
    expect(bought).not.toBe(s);
    expect(bought.upgrades).toContain(pair.id);
  });
  it('refuses the purchase at 15/14', () => {
    let s = rich(newGame(T0));
    s = hireLab(s, labA, SYNERGY_MIN_AGENTS);
    s = hireLab(s, labB, SYNERGY_MIN_AGENTS - 1);
    expect(isUpgradeUnlocked(s, pair)).toBe(false);
    expect(buyUpgrade(s, pair.id)).toBe(s);
  });
  it('multiplies the income of both labs by ×1.5', () => {
    let s = rich(newGame(T0));
    s = hireLab(s, labA, SYNERGY_MIN_AGENTS);
    s = hireLab(s, labB, SYNERGY_MIN_AGENTS);
    const mA = CATALOG[0].models.find((m) => m.lab === labA)!;
    const mB = CATALOG[0].models.find((m) => m.lab === labB)!;
    const beforeA = modelIncome(s, mA);
    const beforeB = modelIncome(s, mB);
    s = buyUpgrade(s, pair.id);
    expect(modelIncome(s, mA)).toBeCloseTo(beforeA * PAIR_SYNERGY_MULT);
    expect(modelIncome(s, mB)).toBeCloseTo(beforeB * PAIR_SYNERGY_MULT);
  });
  it('fades live when sold below the threshold while the purchase stays', () => {
    const bought = withPair();
    const mB = CATALOG[0].models.find((m) => m.lab === labB)!;
    // То же увольнение без покупки: состав Агентов один в один, баффа нет.
    const plain = hireLab(hireLab(rich(newGame(T0)), labA, SYNERGY_MIN_AGENTS), labB, SYNERGY_MIN_AGENTS);
    const sold = sellAgents(bought, mB.id, 1);
    const expected = sellAgents(plain, mB.id, 1);
    expect(totalIncome(sold)).toBeCloseTo(totalIncome(expected));
    // Покупка при этом не возвращается: запись жива и оживёт при новом найме.
    expect(sold.upgrades).toContain(pair.id);
    expect(totalIncome(buyAgents(sold, mB.id, 1))).toBeCloseTo(totalIncome(bought));
  });
  it('burns on prestige like a regular synergy', () => {
    let s = withPair();
    s = buyAgents(s, g0.flagship.id, 1);
    expect(s.upgrades).toContain(pair.id);
    const p = prestige(s, T0 + 1);
    expect(p.upgrades).toEqual([]);
    expect(totalIncome(p)).toBe(0);
  });
  it('keeps rank income monotonic with the pair buff active', () => {
    let s = rich(newGame(T0));
    for (const m of g0.models) s = buyAgents(s, m.id, SYNERGY_MIN_AGENTS);
    s = buyUpgrade(s, pair.id);
    // Состав ровный, одиночных синергий и Перков нет: порядок Дохода обязан повторять
    // порядок baseIncome — шаг цены ×6.5 на Ранг бафф ×1.5 не переворачивает.
    const incomes = g0.models.map((m) => modelIncome(s, m));
    for (let i = 1; i < incomes.length; i++) expect(incomes[i]).toBeGreaterThan(incomes[i - 1]);
  });
});

describe('generation perks', () => {
  // Забег Поколения `gen` в точке Престижа: флагман куплен, Compute хватает на особые Перки.
  const flagged = (gen: number, compute = 100): GameState => ({
    ...newGame(T0),
    generation: gen,
    maxGeneration: gen,
    compute,
    agents: { [CATALOG[gen].flagship.id]: 1 },
  });
  const allGenPerks = CATALOG.map((_, i) => genPerkId(i));

  // Лестница цен держится числами, а не константами: тест обязан ломаться, если цена поедет.
  const priceOfNth = (n: number) => GEN_PERK_BASE_COST + GEN_PERK_STEP_COST * n;

  it('опознаёт особый Перк по id формата gen_<N> и отбрасывает чужое', () => {
    expect(isGenPerkId(genPerkId(0))).toBe(true);
    expect(isGenPerkId(genPerkId(CATALOG.length - 1))).toBe(true);
    // Поколение вне каталога — не особый Перк: его эффекта нет, а покупка прошла бы как обычная.
    expect(isGenPerkId(`gen_${CATALOG.length}`)).toBe(false);
    expect(isGenPerkId('gen_-1')).toBe(false);
    expect(isGenPerkId('gen_x')).toBe(false);
    expect(isGenPerkId('click_x2')).toBe(false);
  });

  it('продаётся в своём и прошлых поколениях, флагман нужен только в текущем', () => {
    const s = flagged(0);
    // Будущее Поколение — отказ тем же объектом, Compute не тронут.
    expect(buyPerk(s, 'gen_1')).toBe(s);
    expect(buyPerk(s, 'gen_7')).toBe(s);
    // Своё Поколение без флагмана — тоже отказ: Престиж делается не отсюда.
    const noFlag: GameState = { ...s, agents: {} };
    expect(buyPerk(noFlag, 'gen_0')).toBe(noFlag);
    // А в точке Престижа покупка проходит и переживает сам Престиж.
    const bought = buyPerk(s, 'gen_0');
    expect(bought.perks).toEqual(['gen_0']);
    expect(prestige(bought, T0 + 1).perks).toEqual(['gen_0']);
  });
  it('докупает прошлый перк в позднем поколении без флагмана, будущее не даёт', () => {
    // Поздний Забег без флагмана: упущенный gen_0 покупается как обычный.
    const late: GameState = { ...newGame(T0), generation: 3, maxGeneration: 3, compute: 100, agents: {} };
    const bought = buyPerk(late, 'gen_0');
    expect(bought).not.toBe(late);
    expect(bought.perks).toEqual(['gen_0']);
    expect(bought.computeSpent).toBe(priceOfNth(0));
    // Будущий перк в том же Забеге — отказ тем же объектом.
    expect(buyPerk(late, 'gen_4')).toBe(late);
    expect(buyPerk(late, 'gen_7')).toBe(late);
    // Прошлый перк в текущем Поколении с флагманом — тоже проходит.
    const current = flagged(2);
    expect(buyPerk(current, 'gen_0').perks).toEqual(['gen_0']);
  });
  it('берёт 10 Compute за первый особый и +5 за каждый следующий', () => {
    let s = flagged(0);
    s = buyPerk(s, 'gen_0');
    expect(s.computeSpent).toBe(priceOfNth(0));
    // Второе и третье Поколения: особые стоят уже 15 и 20.
    s = { ...s, generation: 1, maxGeneration: 1, agents: { [CATALOG[1].flagship.id]: 1 } };
    s = buyPerk(s, 'gen_1');
    expect(s.computeSpent).toBe(priceOfNth(1) + priceOfNth(0));
    s = { ...s, generation: 2, maxGeneration: 2, agents: { [CATALOG[2].flagship.id]: 1 } };
    s = buyPerk(s, 'gen_2');
    expect(s.computeSpent).toBe(priceOfNth(2) + priceOfNth(1) + priceOfNth(0));
    expect(s.perks).toEqual(['gen_0', 'gen_1', 'gen_2']);
    // Повторная покупка и нехватка свободного Compute — отказ тем же объектом.
    expect(buyPerk(s, 'gen_2')).toBe(s);
    const poor = flagged(3, 5);
    expect(buyPerk(poor, 'gen_3')).toBe(poor);
  });
  it('считает цену по всем купленным особым, включая докупленные позже', () => {
    // gen_1 пропущен в своём Поколении — докупаем позже без флагмана, цена та же 10.
    let s: GameState = { ...newGame(T0), generation: 3, maxGeneration: 3, compute: 100, agents: {} };
    s = buyPerk(s, 'gen_1');
    expect(s.computeSpent).toBe(priceOfNth(0));
    // Следующий особый (текущего Поколения, но флагман уже нанят) стоит 15:
    // счёт идёт по всем купленным особым, а не по Поколению.
    s = { ...s, agents: { [CATALOG[3].flagship.id]: 1 } };
    s = buyPerk(s, 'gen_3');
    expect(s.computeSpent).toBe(priceOfNth(1) + priceOfNth(0));
    expect(s.perks).toEqual(['gen_1', 'gen_3']);
  });
  it('усиливает на +10% только модели своего поколения', () => {
    const model = CATALOG[0].models[0];
    const s = buyAgents(rich(newGame(T0), 1e6), model.id, 10);
    const bare = totalIncome(s);
    // Чужой особый Перк доход не меняет (подставлен напрямую: купить его вне поколения нельзя).
    expect(totalIncome({ ...s, perks: ['gen_1'] })).toBeCloseTo(bare);
    // Свой даёт ровно +10% и только своим моделям.
    expect(totalIncome({ ...s, perks: ['gen_0'] })).toBeCloseTo(bare * 1.1);
    expect(modelIncome({ ...s, perks: ['gen_0'] }, model)).toBeCloseTo(model.baseIncome * 10 * 1.1);
    // А модель чужого Поколения свой Перк не разгоняет: gen_0 молчит в Поколении 1.
    const g1model = CATALOG[1].models[0];
    const s1 = buyAgents(rich({ ...newGame(T0), generation: 1, maxGeneration: 1 }, 1e6), g1model.id, 10);
    expect(modelIncome({ ...s1, perks: ['gen_0'] }, g1model)).toBeCloseTo(modelIncome(s1, g1model));
  });
  it('режет суммарный бонус хард-капом ×2', () => {
    // Синтетическая пачка эффектов одного Поколения: кап обязан сработать раньше +200%.
    const many: PerkEffect[] = [];
    for (let i = 0; i < 20; i++) many.push({ kind: 'generationBoost', generation: 0, pct: 0.1 });
    expect(generationBoostMult(many, 0)).toBe(2);
    expect(generationBoostMult(many, 1)).toBe(1);
    // Реальный предел: все 8 особых куплены — в своём Поколении ×1.1, то есть влезли в кап.
    const model = CATALOG[3].models[2];
    const s = buyAgents(rich({ ...newGame(T0), generation: 3, maxGeneration: 3 }, 1e6), model.id, 5);
    const bare = modelIncome(s, model);
    const perked = modelIncome({ ...s, perks: allGenPerks }, model);
    expect(perked).toBeCloseTo(bare * 1.1);
    expect(perked).toBeLessThanOrEqual(bare * 2);
  });
  it('держит топ N с капом ниже базы N+1 на каждом переходе', () => {
    for (let n = 0; n < CATALOG.length - 1; n++) {
      const top = CATALOG[n].flagship;
      const next = CATALOG[n + 1].flagship;
      // Топ-сетап Поколения: 1 Агент флагмана при всех 8 особых (свой даёт ×1.1, чужие — 0).
      const s: GameState = { ...newGame(T0), generation: n, perks: allGenPerks, agents: { [top.id]: 1 } };
      const withPerks = modelIncome(s, top);
      // Тот же сетап, но с бонусом, разогнанным до капа ×2: худший случай, покрытый инвариантом.
      expect((withPerks / 1.1) * 2).toBeLessThan(next.baseIncome);
      // Перк не может перевернуть и базовый порядок: с ним Поколение либо всё ещё слабее
      // следующего, либо, если каталог когда-то снова развернётся, не станет сильнее.
      expect(withPerks < next.baseIncome).toBe(top.baseIncome < next.baseIncome);
    }
  });
});
