import { CATALOG, LAST_GENERATION, MODEL_BY_ID, type Model } from './catalog';
import { perkEffects, PERK_BY_ID, START_TOKENS_UNITS } from './perks';
import type { GameState } from './state';
import {
  clickUpgradeId,
  CLICK_UPGRADES,
  isUpgradeUnlocked,
  labAgents,
  modelUpgradeId,
  MODEL_TIERS,
  SYNERGY_PER_AGENT,
  synergyUpgradeId,
  UPGRADE_BY_ID,
} from './upgrades';

export const PRICE_GROWTH = 1.15;
export const SELL_REFUND = 0.25;
export const COMPUTE_BONUS = 0.01;
export const PRESTIGE_DIVISOR_UNITS = 1e5;
export const BASE_OFFLINE_HOURS = 8;

// ---------- Цены ----------

export function discountMult(state: GameState): number {
  return perkEffects(state.perks).reduce((m, e) => (e.kind === 'discount' ? m * (1 - e.pct) : m), 1);
}

/** Цена следующих `n` Агентов при `owned` уже купленных. */
export function bulkCost(model: Model, owned: number, n: number, discount = 1): number {
  const r = PRICE_GROWTH;
  return model.baseCost * discount * Math.pow(r, owned) * ((Math.pow(r, n) - 1) / (r - 1));
}

export function maxAffordable(model: Model, owned: number, tokens: number, discount = 1): number {
  const r = PRICE_GROWTH;
  const first = model.baseCost * discount * Math.pow(r, owned);
  if (tokens < first) return 0;
  return Math.floor(Math.log((tokens * (r - 1)) / first + 1) / Math.log(r));
}

export function sellRefund(model: Model, owned: number, n: number, discount = 1): number {
  const k = Math.min(n, owned);
  return bulkCost(model, owned - k, k, discount) * SELL_REFUND;
}

// ---------- Доход ----------

export function globalMult(state: GameState): number {
  return 1 + state.compute * COMPUTE_BONUS;
}

export function modelIncome(state: GameState, model: Model): number {
  const n = state.agents[model.id] ?? 0;
  if (!n) return 0;
  let mult = 1;
  for (let t = 0; t < MODEL_TIERS.length; t++) {
    if (state.upgrades.includes(modelUpgradeId(model.id, t))) mult *= 2;
  }
  if (state.upgrades.includes(synergyUpgradeId(state.generation, model.lab))) {
    mult *= 1 + SYNERGY_PER_AGENT * labAgents(state, model.lab);
  }
  for (const e of perkEffects(state.perks)) {
    if (e.kind === 'labBoost' && e.lab === model.lab) mult *= e.mult;
  }
  return model.baseIncome * n * mult * globalMult(state);
}

export function totalIncome(state: GameState): number {
  return CATALOG[state.generation].models.reduce((s, m) => s + modelIncome(state, m), 0);
}

export function clickValue(state: GameState, income = totalIncome(state)): number {
  const gen = state.generation;
  let flat = CATALOG[gen].scale;
  let pct = 0;
  CLICK_UPGRADES.forEach((c, i) => {
    if (!state.upgrades.includes(clickUpgradeId(gen, i))) return;
    if (c.kind === 'x2') flat *= 2;
    else pct += 0.01;
  });
  for (const e of perkEffects(state.perks)) if (e.kind === 'clickMult') flat *= e.mult;
  return flat * globalMult(state) + income * pct;
}

export function autoclicksPerSecond(state: GameState): number {
  return perkEffects(state.perks).reduce((s, e) => (e.kind === 'autoclick' ? s + e.perSecond : s), 0);
}

// ---------- Действия ----------

const earn = (state: GameState, amount: number): GameState => ({
  ...state,
  tokens: state.tokens + amount,
  runTokens: state.runTokens + amount,
  totalTokens: state.totalTokens + amount,
});

export function click(state: GameState): GameState {
  const s = earn(state, clickValue(state));
  return { ...s, clicks: s.clicks + 1, runClicks: s.runClicks + 1 };
}

export function buyAgents(state: GameState, modelId: string, n: number | 'max'): GameState {
  const model = MODEL_BY_ID[modelId];
  if (!model || model.generation !== state.generation) return state;
  const owned = state.agents[modelId] ?? 0;
  const d = discountMult(state);
  const count = n === 'max' ? maxAffordable(model, owned, state.tokens, d) : n;
  if (count <= 0) return state;
  const cost = bulkCost(model, owned, count, d);
  if (cost > state.tokens) return state;
  return { ...state, tokens: state.tokens - cost, agents: { ...state.agents, [modelId]: owned + count } };
}

export function sellAgents(state: GameState, modelId: string, n: number): GameState {
  const model = MODEL_BY_ID[modelId];
  const owned = state.agents[modelId] ?? 0;
  if (!model || owned === 0) return state;
  const k = Math.min(n, owned);
  return {
    ...state,
    tokens: state.tokens + sellRefund(model, owned, k, discountMult(state)),
    agents: { ...state.agents, [modelId]: owned - k },
  };
}

export function buyUpgrade(state: GameState, id: string): GameState {
  const u = UPGRADE_BY_ID[id];
  if (!u || state.upgrades.includes(id) || u.cost > state.tokens || !isUpgradeUnlocked(state, u)) return state;
  return { ...state, tokens: state.tokens - u.cost, upgrades: [...state.upgrades, id] };
}

export function buyPerk(state: GameState, id: string): GameState {
  const p = PERK_BY_ID[id];
  const free = state.compute - state.computeSpent;
  if (!p || state.perks.includes(id) || p.cost > free) return state;
  return { ...state, computeSpent: state.computeSpent + p.cost, perks: [...state.perks, id] };
}

// ---------- Время ----------

/** Продвигает игру на `dt` секунд (Доход + автоклик). */
export function advance(state: GameState, dt: number): GameState {
  if (dt <= 0) return state;
  const income = totalIncome(state);
  const auto = autoclicksPerSecond(state) * clickValue(state, income);
  return earn(state, (income + auto) * dt);
}

export function offlineCapHours(state: GameState): number {
  return perkEffects(state.perks).reduce(
    (h, e) => (e.kind === 'offlineCap' ? Math.max(h, e.hours) : h),
    BASE_OFFLINE_HOURS,
  );
}

/** Начисляет Оффлайн-доход за время с `lastTick` до `now`, с лимитом. */
export function applyOffline(state: GameState, now: number): { state: GameState; seconds: number; earned: number } {
  const raw = Math.max(0, (now - state.lastTick) / 1000);
  const seconds = Math.min(raw, offlineCapHours(state) * 3600);
  const earned = totalIncome(state) * seconds;
  const s = earn(state, earned);
  return { state: { ...s, lastTick: now }, seconds, earned };
}

// ---------- Престиж ----------

export function canPrestige(state: GameState): boolean {
  return (state.agents[CATALOG[state.generation].flagship.id] ?? 0) >= 1;
}

export function prestigeGain(state: GameState): number {
  const divisor = PRESTIGE_DIVISOR_UNITS * CATALOG[state.generation].scale;
  return Math.floor(Math.cbrt(state.runTokens / divisor));
}

export function isContentFinale(state: GameState): boolean {
  return state.generation === LAST_GENERATION && canPrestige(state);
}

export function startingTokens(state: GameState, generation: number): number {
  return perkEffects(state.perks).some((e) => e.kind === 'startTokens')
    ? START_TOKENS_UNITS * CATALOG[generation].scale
    : 0;
}

export function prestige(state: GameState, now: number): GameState {
  if (!canPrestige(state)) return state;
  const next = Math.min(state.generation + 1, LAST_GENERATION);
  return {
    ...state,
    generation: next,
    maxGeneration: Math.max(state.maxGeneration, next),
    compute: state.compute + prestigeGain(state),
    prestiges: state.prestiges + 1,
    tokens: startingTokens(state, next),
    runTokens: 0,
    runClicks: 0,
    agents: {},
    upgrades: [],
    runStartedAt: now,
    lastTick: now,
  };
}
