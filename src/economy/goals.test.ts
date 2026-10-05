import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { allGoalIds, currentGoals } from './goals';
import { newGame, type GameState } from './state';
import { clickUpgradeId } from './upgrades';

const T0 = 1_000_000;
const g0 = CATALOG[0];
const flagshipId = g0.flagship.id;
// Две разные нем-флагманские Модели одной Лаборатории: Флагман определяется снимком,
// поэтому захардкоженные id могли бы совпасть с ним и «купить» его раньше времени.
// В нулевом Поколении ≥2 Моделей есть только у Meta, Флагман там at most один.
const cheapPair = g0.models.filter((m) => m.lab === 'meta' && m.id !== flagshipId);
const META_A = cheapPair[0].id;
const META_B = cheapPair[1].id;
// Две Модели двух других Лабораторий (ростер — из сидов, там все немета-лабы одиночные).
const spare = g0.models.filter((m) => m.lab !== 'meta' && m.id !== flagshipId);
const LAB_C = spare[0].id;
const LAB_D = spare.find((m) => m.lab !== spare[0].lab)!.id;

const ids = (s: GameState): string[] => currentGoals(s).map((g) => g.id);

describe('goals', () => {
  it('показывает первые три цели нового забега по порядку', () => {
    expect(ids(newGame(T0))).toEqual(['first-click', 'first-agent', 'model-five']);
  });

  it('ведёт игрока прохождением 0–35 мин: каждая цель исчезает после выполнения', () => {
    const s0 = newGame(T0);
    // Первый Клик.
    const s1: GameState = { ...s0, clicks: 1, runClicks: 1 };
    expect(ids(s1)).toEqual(['first-agent', 'model-five', 'first-upgrade']);
    // Первый Агент.
    const s2: GameState = { ...s1, agents: { [META_A]: 1 } };
    expect(ids(s2)).toEqual(['model-five', 'first-upgrade', 'synergy-pair']);
    // Пятёрка одной Модели.
    const s3: GameState = { ...s2, agents: { [META_A]: 5 } };
    expect(ids(s3)).toEqual(['first-upgrade', 'synergy-pair', 'first-event']);
    // Первый Апгрейд.
    const s4: GameState = { ...s3, upgrades: [clickUpgradeId(0, 0)] };
    expect(ids(s4)).toEqual(['synergy-pair', 'first-event', 'three-labs']);
    // Дуэт Лаборатории.
    const s5: GameState = { ...s4, agents: { [META_A]: 5, [META_B]: 1 } };
    expect(ids(s5)).toEqual(['first-event', 'three-labs', 'ten-agents']);
    // Первый улов События.
    const s6: GameState = { ...s5, eventsSeen: 1, eventCaughtAt: T0 };
    expect(ids(s6)).toEqual(['three-labs', 'ten-agents', 'flagship']);
    // Три Лаборатории (Meta + две другие).
    const s7: GameState = {
      ...s6,
      agents: { [META_A]: 5, [META_B]: 1, [LAB_C]: 1, [LAB_D]: 1 },
    };
    expect(ids(s7)).toEqual(['ten-agents', 'flagship', 'first-prestige']);
    // Десять Агентов.
    const s8: GameState = {
      ...s7,
      agents: { [META_A]: 7, [META_B]: 1, [LAB_C]: 1, [LAB_D]: 1 },
    };
    expect(ids(s8)).toEqual(['flagship', 'first-prestige', 'second-prestige']);
    // Флагман Поколения открывает Престиж.
    const s9: GameState = {
      ...s8,
      agents: { ...s8.agents, [flagshipId]: 1 },
    };
    expect(ids(s9)).toEqual(['first-prestige', 'second-prestige']);
    // Первый Престиж.
    const s10: GameState = { ...s9, prestiges: 1 };
    expect(ids(s10)).toEqual(['second-prestige']);
    // Второй Престиж — цели кончились, дальше свободная игра.
    const s11: GameState = { ...s10, prestiges: 2 };
    expect(ids(s11)).toEqual([]);
  });

  it('не показывает больше трёх целей и не повторяет id', () => {
    for (const n of [0, 1, 5, 10]) {
      const s: GameState = { ...newGame(T0), clicks: n };
      const goals = currentGoals(s);
      expect(goals.length).toBeLessThanOrEqual(3);
      expect(new Set(goals.map((g) => g.id)).size).toBe(goals.length);
    }
  });

  it('дуэт засчитывает только две разные Модели одной Лаборатории', () => {
    // Пять одной Модели и Апгрейд есть, а дуэта нет — он первый в списке.
    // (mistral-7b-instruct здесь — просто чужая Лаборатория, а не дуэт с Meta.)
    const twoLabs: GameState = {
      ...newGame(T0),
      clicks: 1,
      agents: { [META_A]: 5, [LAB_C]: 5 },
      upgrades: [clickUpgradeId(0, 0)],
    };
    expect(ids(twoLabs)[0]).toBe('synergy-pair');
  });

  it('все 11 целей достижимы из синтетических состояний', () => {
    expect(allGoalIds()).toHaveLength(11);
    // Каждая цель встречается первой хотя бы в одном состоянии из прохождения выше.
    const seen = new Set<string>();
    let s: GameState = newGame(T0);
    seen.add(ids(s)[0]);
    s = { ...s, clicks: 1 };
    seen.add(ids(s)[0]);
    s = { ...s, agents: { [META_A]: 1 } };
    for (const g of currentGoals(s)) seen.add(g.id);
    s = { ...s, agents: { [META_A]: 5 }, upgrades: [clickUpgradeId(0, 0)] };
    for (const g of currentGoals(s)) seen.add(g.id);
    s = { ...s, agents: { [META_A]: 5, [META_B]: 1 }, eventCaughtAt: T0 };
    for (const g of currentGoals(s)) seen.add(g.id);
    s = {
      ...s,
      agents: { [META_A]: 7, [META_B]: 1, [LAB_C]: 1, [LAB_D]: 1, [flagshipId]: 1 },
    };
    for (const g of currentGoals(s)) seen.add(g.id);
    s = { ...s, prestiges: 1 };
    for (const g of currentGoals(s)) seen.add(g.id);
    expect([...seen].sort()).toEqual(allGoalIds().sort());
  });
});
