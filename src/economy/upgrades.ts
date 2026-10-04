import { CATALOG, type Generation } from './catalog';
import { LAB_IDS, LABS, type LabId } from '../data/labs';
import type { GameState } from './state';

// Слайг спрайта живёт рядом со строкой, которую он изображает, а не в компоненте: список
// тиров и список картинок обязаны расти вместе, иначе индексы разъедутся. Спрайт один на
// все Модели Поколения — имя Модели и так стоит в заголовке карточки.
export const MODEL_TIERS = [
  { threshold: 1, costMult: 10, name: 'Fine-tuning', sprite: 'fine-tuning' },
  { threshold: 5, costMult: 50, name: 'RLHF', sprite: 'rlhf' },
  { threshold: 25, costMult: 500, name: 'Chain-of-Thought', sprite: 'chain-of-thought' },
  { threshold: 50, costMult: 50_000, name: '1M контекст', sprite: 'context-1m' },
  { threshold: 100, costMult: 5_000_000, name: 'Tool use', sprite: 'tool-use' },
] as const;

export const CLICK_UPGRADES = [
  { units: 100, kind: 'x2', name: 'Prompt engineering', desc: 'клик ×2', sprite: 'prompt-engineering' },
  { units: 500, kind: 'x2', name: 'System prompt', desc: 'клик ×2', sprite: 'system-prompt' },
  { units: 10_000, kind: 'x2', name: 'Few-shot примеры', desc: 'клик ×2', sprite: 'few-shot' },
  { units: 100_000, kind: 'pct', name: 'Вайб-кодинг', desc: '+1% дохода за клик', sprite: 'vibe-coding' },
  {
    units: 10_000_000,
    kind: 'pct',
    name: 'Мультиагентный промпт',
    desc: '+1% дохода за клик',
    sprite: 'multi-agent-prompt',
  },
  {
    units: 1_000_000_000,
    kind: 'pct',
    name: 'Промпт-оркестратор',
    desc: '+1% дохода за клик',
    sprite: 'prompt-orchestrator',
  },
] as const;

export const SYNERGY_SPRITE = 'shared-dataset';

export const SYNERGY_MIN_AGENTS = 15;
export const SYNERGY_PER_AGENT = 0.01;
/** Фиксированный бафф Парной Синергии обеим Лабораториям. */
export const PAIR_SYNERGY_MULT = 1.5;
/** Сколько пар на Поколение попадает в магазин: полный перебор дал бы до 28 записей
 *  и захламил бы список Апгрейдов, а порог 15/15 всё равно раньше всего reachable у
 *  самых представленных Лабораторий. */
export const MAX_PAIR_SYNERGIES_PER_GEN = 3;

export type Upgrade =
  | {
      id: string;
      kind: 'model';
      name: string;
      desc: string;
      cost: number;
      modelId: string;
      tier: number;
      sprite: string;
    }
  | { id: string; kind: 'click'; name: string; desc: string; cost: number; effect: 'x2' | 'pct'; sprite: string }
  // Парная синергия — тот же kind: `lab` держит первую Лабораторию для совместимости
  // (магазин и ростер читают её как раньше), вторая лежит в `pairLab`, если он есть.
  // Спрайт тот же, что у одиночной: это тоже общий датасет, различается только подпись.
  | { id: string; kind: 'synergy'; name: string; desc: string; cost: number; lab: LabId; sprite: string; pairLab?: LabId };

export const modelUpgradeId = (modelId: string, tier: number) => `m:${modelId}:${tier}`;
export const clickUpgradeId = (gen: number, i: number) => `c:${gen}:${i}`;
export const synergyUpgradeId = (gen: number, lab: LabId) => `s:${gen}:${lab}`;
/** Канонический id пары: Лаборатории всегда отсортированы, чтобы `A×B` и `B×A`
 *  не давали два разных Апгрейда на одну и ту же пару. */
export const pairSynergyUpgradeId = (gen: number, a: LabId, b: LabId) => {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `s:${gen}:${first}x${second}`;
};

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
        sprite: t.sprite,
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
      sprite: c.sprite,
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
      sprite: SYNERGY_SPRITE,
    });
  }
  // Парные синергии «Совместный датасет A×B»: в отличие от одиночных, каждой Лаборатории
  // достаточно одной Модели в Поколении — пара собирается из состава, а не из глубины ростера.
  const labCount = new Map<LabId, number>();
  const firstCost = new Map<LabId, number>();
  for (const lab of LAB_IDS) {
    const labModels = gen.models.filter((m) => m.lab === lab);
    if (labModels.length === 0) continue;
    labCount.set(lab, labModels.length);
    firstCost.set(lab, labModels[0].baseCost);
  }
  const labs = [...labCount.keys()];
  const pairs: Array<[LabId, LabId]> = [];
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const [a, b] = labs[i] < labs[j] ? [labs[i], labs[j]] : [labs[j], labs[i]];
      pairs.push([a, b]);
    }
  }
  // Топ по суммарному числу Моделей: такие пары игрок откроет раньше всего, а id пар
  // стабильны — состав Лабораторий идёт из сидов, а не из снапшота, поэтому сортировка
  // Рангов на набор пар не влияет и старые сохранения не осиротеют.
  pairs.sort((p, q) => {
    const nP = labCount.get(p[0])! + labCount.get(p[1])!;
    const nQ = labCount.get(q[0])! + labCount.get(q[1])!;
    if (nQ !== nP) return nQ - nP;
    if (p[0] !== q[0]) return p[0] < q[0] ? -1 : 1;
    return p[1] < q[1] ? -1 : 1;
  });
  for (const [a, b] of pairs.slice(0, MAX_PAIR_SYNERGIES_PER_GEN)) {
    list.push({
      id: pairSynergyUpgradeId(gen.index, a, b),
      kind: 'synergy',
      name: `Совместный датасет: ${LABS[a].name} × ${LABS[b].name}`,
      desc: `Доход моделей ${LABS[a].name} и ${LABS[b].name} ×1.5, пока в каждой ≥15 Агентов`,
      // Цена от более дорогой стороны пары, тем же приёмом, что одиночная синергия:
      // берётся baseCost первой (самой дешёвой) Модели Лаборатории, а не флагмана,
      // иначе пара стоила бы как конец Поколения и не покупалась бы никогда.
      cost: Math.max(firstCost.get(a)!, firstCost.get(b)!) * 1000,
      lab: a,
      pairLab: b,
      sprite: SYNERGY_SPRITE,
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
      // Пара открывается только составом 15/15: одна перекачанная Лаборатория
      // вторую не вытягивает.
      if (u.pairLab !== undefined) {
        return labAgents(state, u.lab) >= SYNERGY_MIN_AGENTS && labAgents(state, u.pairLab) >= SYNERGY_MIN_AGENTS;
      }
      return labAgents(state, u.lab) >= SYNERGY_MIN_AGENTS;
  }
}

export function availableUpgrades(state: GameState): Upgrade[] {
  const owned = new Set(state.upgrades);
  return UPGRADES_BY_GEN[state.generation]
    .filter((u) => !owned.has(u.id) && isUpgradeUnlocked(state, u))
    .sort((a, b) => a.cost - b.cost);
}
