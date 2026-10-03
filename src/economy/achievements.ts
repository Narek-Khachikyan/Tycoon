import { CATALOG } from './catalog';
import type { GameState } from './state';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  check: (s: GameState) => boolean;
}

const totalAgents = (s: GameState) => Object.values(s.agents).reduce((a, b) => a + b, 0);

const tokens = (id: string, name: string, n: number): Achievement => ({
  id, name, desc: `Заработать ${n.toExponential(0).replace('e+', 'e')} Токенов за всё время`, check: (s) => s.totalTokens >= n,
});

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'click_1', name: 'Hello, world', desc: 'Отправить первый промпт', check: (s) => s.clicks >= 1 },
  { id: 'click_100', name: 'Промпт-джуниор', desc: '100 Кликов', check: (s) => s.clicks >= 100 },
  { id: 'click_1000', name: 'Промпт-мидл', desc: '1 000 Кликов', check: (s) => s.clicks >= 1000 },
  { id: 'click_10000', name: 'Промпт-сеньор', desc: '10 000 Кликов', check: (s) => s.clicks >= 10000 },
  tokens('tok_3', 'Первая тысяча', 1e3),
  tokens('tok_6', 'Миллион контекста', 1e6),
  tokens('tok_9', 'Миллиард параметров', 1e9),
  tokens('tok_12', 'Триллион токенов', 1e12),
  tokens('tok_18', 'Весь интернет', 1e18),
  tokens('tok_27', 'Датасет вселенной', 1e27),
  { id: 'agents_1', name: 'Первый сотрудник', desc: 'Нанять первого Агента', check: (s) => totalAgents(s) >= 1 },
  { id: 'agents_50', name: 'Стартап', desc: '50 Агентов одновременно', check: (s) => totalAgents(s) >= 50 },
  { id: 'agents_250', name: 'Скейлап', desc: '250 Агентов одновременно', check: (s) => totalAgents(s) >= 250 },
  { id: 'one_100', name: 'Монокультура', desc: '100 Агентов одной Модели', check: (s) => Object.values(s.agents).some((n) => n >= 100) },
  { id: 'upgrade_1', name: 'Fine-tuned', desc: 'Купить первый Апгрейд', check: (s) => s.upgrades.length >= 1 },
  {
    id: 'full_roster', name: 'Полный зоопарк', desc: 'Иметь Агентов всех Моделей текущего Поколения',
    check: (s) => CATALOG[s.generation].models.every((m) => (s.agents[m.id] ?? 0) > 0),
  },
  { id: 'prestige_1', name: 'Новое поколение', desc: 'Совершить Престиж', check: (s) => s.prestiges >= 1 },
  { id: 'prestige_5', name: 'Серийный релизер', desc: '5 Престижей', check: (s) => s.prestiges >= 5 },
  { id: 'gen_4', name: 'Omni-присутствие', desc: 'Дойти до 4-го Поколения', check: (s) => s.maxGeneration >= 3 },
  { id: 'gen_last', name: 'На передовой', desc: 'Дойти до последнего Поколения', check: (s) => s.maxGeneration >= CATALOG.length - 1 },
  { id: 'perk_1', name: 'Инвестор', desc: 'Купить первый Перк', check: (s) => s.perks.length >= 1 },
];

/** Возвращает id новых выполненных Достижений. */
export function newlyEarned(s: GameState): string[] {
  const have = new Set(s.achievements);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(s)).map((a) => a.id);
}

/**
 * Применяет вновь заработанные Достижения к состоянию.
 * Вызывается из каждого перехода состояния, который может выполнить условие.
 */
export function awardAchievements(s: GameState): { state: GameState; awarded: string[] } {
  const awarded = newlyEarned(s);
  if (awarded.length === 0) return { state: s, awarded };
  return { state: { ...s, achievements: [...s.achievements, ...awarded] }, awarded };
}
