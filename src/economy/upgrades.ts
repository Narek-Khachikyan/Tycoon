import { CATALOG, type Generation } from './catalog';
import { LAB_IDS, LABS, type LabId } from '../data/labs';
import type { GameState } from './state';

export const MODEL_TIERS = [
  { threshold: 1, costMult: 10, name: 'Fine-tuning' },
  { threshold: 5, costMult: 50, name: 'RLHF' },
  { threshold: 25, costMult: 500, name: 'Chain-of-Thought' },
  { threshold: 50, costMult: 50_000, name: '1M контекст' },
  { threshold: 100, costMult: 5_000_000, name: 'Tool use' },
] as const;

export const CLICK_UPGRADES = [
  { units: 100, kind: 'x2', name: 'Prompt engineering', desc: 'клик ×2' },
  { units: 500, kind: 'x2', name: 'System prompt', desc: 'клик ×2' },
  { units: 10_000, kind: 'x2', name: 'Few-shot примеры', desc: 'клик ×2' },
  { units: 100_000, kind: 'pct', name: 'Вайб-кодинг', desc: '+1% дохода за клик' },
  { units: 10_000_000, kind: 'pct', name: 'Мультиагентный промпт', desc: '+1% дохода за клик' },
  { units: 1_000_000_000, kind: 'pct', name: 'Промпт-оркестратор', desc: '+1% дохода за клик' },
] as const;

export const SYNERGY_MIN_AGENTS = 15;
export const SYNERGY_PER_AGENT = 0.01;

export type Upgrade =
  | { id: string; kind: 'model'; name: string; desc: string; cost: number; modelId: string; tier: number }
  | { id: string; kind: 'click'; name: string; desc: string; cost: number; effect: 'x2' | 'pct' }
  | { id: string; kind: 'synergy'; name: string; desc: string; cost: number; lab: LabId };

export const modelUpgradeId = (modelId: string, tier: number) => `m:${modelId}:${tier}`;
export const clickUpgradeId = (gen: number, i: number) => `c:${gen}:${i}`;
export const synergyUpgradeId = (gen: number, lab: LabId) => `s:${gen}:${lab}`;

export function upgradesFor(gen: Generation): Upgrade[] {
  const list: Upgrade[] = [];
  for (const m of gen.models) {
    MODEL_TIERS.forEach((t, tier) =>
      list.push({
        id: modelUpgradeId(m.id, tier),
        kind: 'model',
        name: `${m.name}: ${t.name}`,
        desc: `доход ${m.name} ×2`,
        cost: m.baseCost * t.costMult,
        modelId: m.id,
        tier,
      }),
    );
  }
  CLICK_UPGRADES.forEach((c, i) =>
    list.push({
      id: clickUpgradeId(gen.index, i),
      kind: 'click',
      name: c.name,
      desc: c.desc,
      cost: c.units * gen.scale,
      effect: c.kind,
    }),
  );
  for (const lab of LAB_IDS) {
    const labModels = gen.models.filter((m) => m.lab === lab);
    if (labModels.length < 2) continue;
    list.push({
      id: synergyUpgradeId(gen.index, lab),
      kind: 'synergy',
      name: `Общий датасет ${LABS[lab].name}`,
      desc: `Каждый агент ${LABS[lab].name} даёт +1% дохода всем моделям ${LABS[lab].name}`,
      cost: labModels[0].baseCost * 1000,
      lab,
    });
  }
  return list;
}

export const UPGRADES_BY_GEN: Upgrade[][] = CATALOG.map(upgradesFor);
export const UPGRADE_BY_ID: Record<string, Upgrade> = Object.fromEntries(
  UPGRADES_BY_GEN.flat().map((u) => [u.id, u]),
);

export function labAgents(state: GameState, lab: LabId): number {
  return CATALOG[state.generation].models
    .filter((m) => m.lab === lab)
    .reduce((s, m) => s + (state.agents[m.id] ?? 0), 0);
}

/** Высший Апгрейд Модели, купленный хотя бы у одной Модели Лаборатории, или -1, пока не куплен
 *  ни один: Апгрейды Моделей покупаются поштучно, и у Лаборатории их столько же, сколько Моделей. */
export function labTopTier(state: GameState, lab: LabId): number {
  let top = -1;
  for (const m of CATALOG[state.generation].models) {
    if (m.lab !== lab) continue;
    for (let tier = 0; tier < MODEL_TIERS.length; tier++) {
      if (state.upgrades.includes(modelUpgradeId(m.id, tier))) top = Math.max(top, tier);
    }
  }
  return top;
}

/** Название работы, которой занята Лаборатория, по её высшему Апгрейду; пусто, пока их нет.
 *  Строка уже игровая, поэтому интерфейс не дублирует названия тиров. */
export function labWork(state: GameState, lab: LabId): string {
  const top = labTopTier(state, lab);
  return top >= 0 ? MODEL_TIERS[top].name : '';
}

/** Апгрейд появляется в магазине, когда выполнено его условие открытия. */
export function isUpgradeUnlocked(state: GameState, u: Upgrade): boolean {
  switch (u.kind) {
    case 'model':
      return (state.agents[u.modelId] ?? 0) >= MODEL_TIERS[u.tier].threshold;
    case 'click': {
      const i = Number(u.id.split(':')[2]);
      const prevOk = i === 0 || state.upgrades.includes(clickUpgradeId(state.generation, i - 1));
      return prevOk && state.runTokens >= u.cost / 4;
    }
    case 'synergy':
      return labAgents(state, u.lab) >= SYNERGY_MIN_AGENTS;
  }
}

export function availableUpgrades(state: GameState): Upgrade[] {
  const owned = new Set(state.upgrades);
  return UPGRADES_BY_GEN[state.generation]
    .filter((u) => !owned.has(u.id) && isUpgradeUnlocked(state, u))
    .sort((a, b) => a.cost - b.cost);
}
