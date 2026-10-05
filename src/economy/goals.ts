import { CATALOG } from './catalog';
import { canPrestige } from './engine';
import { LAB_IDS, type LabId } from '../data/labs';
import { totalAgents } from './upgrades';
import type { GameState } from './state';

export interface Goal {
  id: string;
  title: string;
  hint: string;
}

interface GoalDef extends Goal {
  /** Цель выполнена. Читает только существующие поля состояния — новых полей нет. */
  done: (s: GameState) => boolean;
}

/** Есть ли Лаборатория с Агентами двух разных её Моделей текущего Поколения. */
function hasLabPair(s: GameState): boolean {
  for (const lab of LAB_IDS) {
    let models = 0;
    for (const m of CATALOG[s.generation].models) {
      if (m.lab === lab && (s.agents[m.id] ?? 0) > 0 && ++models >= 2) return true;
    }
  }
  return false;
}

/** Лаборатории, у которых в текущем Поколении есть хотя бы один Агент. */
function labsWithAgents(s: GameState): Set<LabId> {
  const labs = new Set<LabId>();
  for (const m of CATALOG[s.generation].models) {
    if ((s.agents[m.id] ?? 0) > 0) labs.add(m.lab);
  }
  return labs;
}

/**
 * Цели по порядку прохождения 0–35 мин (вехи прогрессии): Клик → Агент → пятёрка
 * Модели → Апгрейд → дуэт Лаборатории → улов События → три Лаборатории → десять
 * Агентов → Флагман → первый Престиж → второй Престиж. После второго Престижа
 * список пуст — дальше свободная игра, а не чек-лист.
 */
const GOALS: readonly GoalDef[] = [
  {
    id: 'first-click',
    title: 'Первый Клик',
    hint: 'Нажми «Отправить промпт» — каждый Клик приносит Токены.',
    done: (s) => s.clicks >= 1,
  },
  {
    id: 'first-agent',
    title: 'Первый Агент',
    hint: 'Найми самую дешёвую Модель во вкладке «Модели» — дальше Доход капает сам.',
    done: (s) => totalAgents(s) >= 1,
  },
  {
    id: 'model-five',
    title: 'Пятёрка одной Модели',
    hint: 'Доведи число Агентов любой Модели до 5 — откроется её Апгрейд «RLHF»: Доход Модели ×2.',
    done: (s) => CATALOG[s.generation].models.some((m) => (s.agents[m.id] ?? 0) >= 5),
  },
  {
    id: 'first-upgrade',
    title: 'Первый Апгрейд',
    hint: 'Забери доступный Апгрейд во вкладке «Апгрейды» — там множители Дохода и Клика.',
    done: (s) => s.upgrades.length >= 1,
  },
  {
    id: 'synergy-pair',
    title: 'Дуэт Лаборатории',
    hint: 'Держи Агентов двух разных Моделей одной Лаборатории — первый шаг к общему Апгрейду.',
    done: hasLabPair,
  },
  {
    id: 'first-event',
    title: 'Первый улов',
    hint: 'Кликни по Золотому Токену, пока Событие активно, — События ускоряют Доход или выдают Токены.',
    done: (s) => s.eventCaughtAt > 0,
  },
  {
    id: 'three-labs',
    title: 'Три Лаборатории',
    hint: 'Собери Агентов трёх разных Лабораторий — у каждой свой Маскот и характер.',
    done: (s) => labsWithAgents(s).size >= 3,
  },
  {
    id: 'ten-agents',
    title: 'Десять Агентов',
    hint: 'Доведи общее число Агентов до 10 — каждый следующий разгоняет Доход.',
    done: (s) => totalAgents(s) >= 10,
  },
  {
    id: 'flagship',
    title: 'Флагман Поколения',
    hint: 'Найми Агента Флагмана (★) — он открывает Престиж в следующее Поколение.',
    done: canPrestige,
  },
  {
    id: 'first-prestige',
    title: 'Первый Престиж',
    hint: 'Сбрось Забег во вкладке «Престиж» и забери Compute — второй Забег пойдёт в разы быстрее.',
    done: (s) => s.prestiges >= 1,
  },
  {
    id: 'second-prestige',
    title: 'Второй Престиж',
    hint: 'Сделай второй Престиж — накопленного Compute хватит на первые Перки.',
    done: (s) => s.prestiges >= 2,
  },
];

/** Следующие невыполненные цели по порядку, не больше трёх. Пусто — всё пройдено. */
export function currentGoals(state: GameState): Goal[] {
  const out: Goal[] = [];
  for (const g of GOALS) {
    if (out.length >= 3) break;
    if (!g.done(state)) out.push({ id: g.id, title: g.title, hint: g.hint });
  }
  return out;
}

/** Все id целей по порядку — для тестов полноты прохождения. */
export function allGoalIds(): string[] {
  return GOALS.map((g) => g.id);
}
