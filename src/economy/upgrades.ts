import { CATALOG, type Generation, type Model } from './catalog';
import { LAB_IDS, LABS, type LabId } from '../data/labs';
import { nonShadowCount } from './achievements';
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

// Флагман тянет младших: пороги открытия и сила бонуса.
export const FLAGSHIP_MIN_FLAGSHIP_AGENTS = 10;
export const FLAGSHIP_MIN_JUNIOR_AGENTS = 15;
export const FLAGSHIP_PER_JUNIOR = 0.02;
/**
 * Верхняя граница бонуса Флагмана: он растёт с числом младших Агентов, а у их числа нет потолка,
 * и без границы при 1000 младших множитель стал бы ×21. Стек с Синергией Лаборатории (×11 на 1000
 * её Агентах) и Compute (×11 на 1000 единиц) доводит такую Лабораторию до ×2564, а со всеми пятью
 * тирами Модели — до ×82 000, и достаётся это всё одному Агенту Лаборатории, а не Поколению.
 *
 * Потолок не про шаг ×1000 между Поколениями: все три множителя одинаковы в каждом Поколении и
 * порядок Поколений перевернуть не могут. Он про то, что ×21 ещё надо заслужить: 1000 младших
 * Агентов самой дешёвой Модели Поколения 1 стоят около 1e62 Токенов забега, а 2000 — около 1e122,
 * и ни то ни другое ничем не ограничено. Граница срабатывает ровно на сотне младших, где
 * 1 + 2% × 100 = 3.
 */
export const FLAGSHIP_MULT_CAP = 3;
export const FLAGSHIP_COST_MULT = 500;

// Агенты-ассистенты: пороги, сила и цены в единицах масштаба Поколения.
// Ассисты считаются от общего числа Агентов Поколения, а тиры Модели — от Агентов одной Модели,
// поэтому числа не совпадают напрямую. Но 100 — это верхняя ступень лестницы Модели, и при самом
// узком росте, когда все Агенты куплены одной Моделью, она открывается на 100 общих Агентах, то
// есть раньше ассистов. Линейка уходит выше 100, чтобы её первая ступень не слилась с последней
// ступенью Модели.
export const ASSIST1_THRESHOLD = 150;
export const ASSIST2_THRESHOLD = 400;
export const ASSIST_PER_AGENT = 0.1;
export const ASSIST2_MULT = 5;
export const ASSIST1_UNITS = 250;
export const ASSIST2_UNITS = 50_000;

/**
 * Датасет: пороги по числу НЕтеневых Достижений и цены в единицах масштаба Поколения.
 *
 * НЕтеневых Достижений в игре двадцать одно, и лестница рассчитана на их число: 5 и 10 закрываются
 * за первый забег, 15 и 20 требуют почти всего списка. Цена растёт быстрее порога — ×25, ×20, ×20, —
 * так что каждый следующий тир обходится дороже предыдущего и по усилию, и по деньгам, а множитель
 * Датасета платит только за купленные тиры.
 *
 * Верхний порог обязан оставаться достижимым: это единственное место, где лестница может разойтись
 * со списком Достижений, и проверяет его тест по числу НЕтеневых.
 */
export const DATASET_THRESHOLDS = [5, 10, 15, 20] as const;
export const DATASET_UNITS = [1_000, 25_000, 500_000, 10_000_000] as const;
export const DATASET_PER_ACHIEVEMENT = 0.05;
export const DATASET_PER_DATASET = 0.1;

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
  | {
      id: string;
      kind: 'click';
      name: string;
      desc: string;
      cost: number;
      effect: 'x2' | 'pct' | 'assist1' | 'assist2';
      sprite: string;
    }
  // Парная синергия — тот же kind: `lab` держит первую Лабораторию для совместимости
  // (магазин и ростер читают её как раньше), вторая лежит в `pairLab`, если он есть.
  // Спрайт тот же, что у одиночной: это тоже общий датасет, различается только подпись.
  | { id: string; kind: 'synergy'; name: string; desc: string; cost: number; lab: LabId; sprite: string; pairLab?: LabId }
  // Новые виды берут спрайт из готового набора: рисовать PNG ради трёх карточек не за чем, они
  // отличаются подписью. Датасет — тот же общий датасет, ассисты — команда и дирижёр, Флагман —
  // «Tool use», потому что отдельной короны в наборе нет, а путь к несуществующему файлу показал бы
  // игроку пустую рамку.
  | { id: string; kind: 'flagship'; name: string; desc: string; cost: number; lab: LabId; modelId: string; sprite: string }
  | { id: string; kind: 'dataset'; name: string; desc: string; cost: number; tier: number; sprite: string };

export const modelUpgradeId = (modelId: string, tier: number) => `m:${modelId}:${tier}`;
export const clickUpgradeId = (gen: number, i: number) => `c:${gen}:${i}`;
export const synergyUpgradeId = (gen: number, lab: LabId) => `s:${gen}:${lab}`;
export const flagshipUpgradeId = (gen: number, lab: LabId) => `f:${gen}:${lab}`;
export const assistUpgradeId = (gen: number, n: 1 | 2) => `c:${gen}:assist${n}`;
export const datasetUpgradeId = (gen: number, i: number) => `d:${gen}:${i}`;
/** Канонический id пары: Лаборатории всегда отсортированы, чтобы `A×B` и `B×A`
 *  не давали два разных Апгрейда на одну и ту же пару. */
export const pairSynergyUpgradeId = (gen: number, a: LabId, b: LabId) => {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `s:${gen}:${first}x${second}`;
};
/** Все Агенты текущего Поколения. */
export function totalAgents(state: GameState): number {
  return CATALOG[state.generation].models.reduce((s, m) => s + (state.agents[m.id] ?? 0), 0);
}

/** Сильнейшая Модель Лаборатории в Поколении — локальный флагман для синергии. */
export function labFlagship(gen: Generation, lab: LabId): Model | undefined {
  let best: Model | undefined;
  for (const m of gen.models) {
    if (m.lab !== lab) continue;
    if (!best || m.rank > best.rank) best = m;
  }
  return best;
}

/** Агенты младших Моделей Лаборатории (все, кроме её флагмана). */
export function juniorAgents(state: GameState, lab: LabId): number {
  const gen = CATALOG[state.generation];
  const flag = labFlagship(gen, lab);
  return gen.models
    .filter((m) => m.lab === lab && m.id !== flag?.id)
    .reduce((s, m) => s + (state.agents[m.id] ?? 0), 0);
}

const ROMAN = ['I', 'II', 'III', 'IV'] as const;

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
  // Клик-ветка ассистентов: flat-бонус за каждого Агента и его усиление.
  // Спрайты из существующего набора: первая ступень — команда, вторая — дирижёр.
  list.push({
    id: assistUpgradeId(gen.index, 1),
    kind: 'click',
    name: 'Агенты-ассистенты',
    desc: 'Клик +0,1 × масштаб за каждого Агента',
    cost: ASSIST1_UNITS * gen.scale,
    effect: 'assist1',
    sprite: 'multi-agent-prompt',
  });
  list.push({
    id: assistUpgradeId(gen.index, 2),
    kind: 'click',
    name: 'Синхрон ассистентов',
    desc: 'бонус Агентов-ассистентов ×5',
    cost: ASSIST2_UNITS * gen.scale,
    effect: 'assist2',
    sprite: 'prompt-orchestrator',
  });
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
  // Флагман тянет младших: доход локального флагмана растёт с числом младших Агентов.
  for (const lab of LAB_IDS) {
    const labModels = gen.models.filter((m) => m.lab === lab);
    if (labModels.length < 2) continue;
    const flag = labFlagship(gen, lab)!;
    list.push({
      id: flagshipUpgradeId(gen.index, lab),
      kind: 'flagship',
      name: `Флагман ${LABS[lab].name}`,
      desc: `Доход флагмана ${LABS[lab].name} ×(1 + 2% за каждого младшего агента той же Лаборатории)`,
      cost: flag.baseCost * FLAGSHIP_COST_MULT,
      lab,
      modelId: flag.id,
      sprite: 'tool-use',
    });
  }
  // Датасет: множитель к Доходу и Клику, растущий с числом Достижений.
  DATASET_THRESHOLDS.forEach((_, tier) =>
    list.push({
      id: datasetUpgradeId(gen.index, tier),
      kind: 'dataset',
      name: `Датасет ${ROMAN[tier]}`,
      desc: 'Доход и Клик ×(1 + 10% от Датасета за каждый Датасет)',
      cost: DATASET_UNITS[tier] * gen.scale,
      tier,
      sprite: SYNERGY_SPRITE,
    }),
  );
  return list;
}

export const UPGRADES_BY_GEN: Upgrade[][] = CATALOG.map(upgradesFor);
export const UPGRADE_BY_ID: Record<string, Upgrade> = Object.fromEntries(
  UPGRADES_BY_GEN.flat().map((u) => [u.id, u]),
);

export function labAgents(state: Pick<GameState, 'generation' | 'agents'>, lab: LabId): number {
  return CATALOG[state.generation].models
    .filter((m) => m.lab === lab)
    .reduce((s, m) => s + (state.agents[m.id] ?? 0), 0);
}

/** Высший Апгрейд Модели, купленный хотя бы у одной Модели Лаборатории, или -1, пока не куплен
 *  ни один: Апгрейды Моделей покупаются поштучно, и у Лаборатории их столько же, сколько Моделей. */
export function labTopTier(state: Pick<GameState, 'generation' | 'upgrades'>, lab: LabId): number {
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
export function labWork(state: Pick<GameState, 'generation' | 'upgrades'>, lab: LabId): string {
  const top = labTopTier(state, lab);
  return top >= 0 ? MODEL_TIERS[top].name : '';
}

/** Апгрейд появляется в магазине, когда выполнено его условие открытия. */
export function isUpgradeUnlocked(state: GameState, u: Upgrade): boolean {
  switch (u.kind) {
    case 'model':
      return (state.agents[u.modelId] ?? 0) >= MODEL_TIERS[u.tier].threshold;
    case 'click': {
      // Ветка ассистентов открывается числом Агентов, а не цепочкой клик-апгрейдов.
      if (u.effect === 'assist1') return totalAgents(state) >= ASSIST1_THRESHOLD;
      if (u.effect === 'assist2') {
        return (
          state.upgrades.includes(assistUpgradeId(state.generation, 1)) &&
          totalAgents(state) >= ASSIST2_THRESHOLD
        );
      }
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
    case 'flagship':
      return (
        (state.agents[u.modelId] ?? 0) >= FLAGSHIP_MIN_FLAGSHIP_AGENTS &&
        juniorAgents(state, u.lab) >= FLAGSHIP_MIN_JUNIOR_AGENTS
      );
    case 'dataset':
      // Порог — число НЕтеневых Достижений: теневые множитель не раздувают.
      return nonShadowCount(state) >= DATASET_THRESHOLDS[u.tier];
  }
}

export function availableUpgrades(state: GameState): Upgrade[] {
  const owned = new Set(state.upgrades);
  return UPGRADES_BY_GEN[state.generation]
    .filter((u) => !owned.has(u.id) && isUpgradeUnlocked(state, u))
    .sort((a, b) => a.cost - b.cost);
}
