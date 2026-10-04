import { CATALOG, computeGain } from './catalog';
import type { GameState } from './state';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Теневые не входят в подсчёт Датасета и не обязаны выполняться в одном прогоне. */
  shadow?: boolean;
  /** `now` нужен только теневым на время (sh_speed); у остальных игнорируется. */
  check: (s: GameState, now?: number) => boolean;
}

const totalAgents = (s: GameState) => Object.values(s.agents).reduce((a, b) => a + b, 0);

const tokens = (id: string, name: string, n: number): Achievement => ({
  id, name, desc: `Заработать ${n.toExponential(0).replace('e+', 'e')} токенов за всё время`, check: (s) => s.totalTokens >= n,
});

/**
 * Прирост Compute тем же числом, что и Престиж.
 *
 * Формула не копируется, а читается из каталога: она одна на игру, а достижение, зовущее движок,
 * образовало бы цикл импортов — catalog.ts ни от кого не зависит, так что копия не была вынуждена.
 */
const prestigeGain = (s: GameState): number => computeGain(s.runTokens, s.generation);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'click_1', name: 'Hello, world', desc: 'Отправить первый промпт', check: (s) => s.clicks >= 1 },
  { id: 'click_100', name: 'Промпт-джуниор', desc: '100 кликов', check: (s) => s.clicks >= 100 },
  { id: 'click_1000', name: 'Промпт-мидл', desc: '1 000 кликов', check: (s) => s.clicks >= 1000 },
  { id: 'click_10000', name: 'Промпт-сеньор', desc: '10 000 кликов', check: (s) => s.clicks >= 10000 },
  tokens('tok_3', 'Первая тысяча', 1e3),
  tokens('tok_6', 'Миллион контекста', 1e6),
  tokens('tok_9', 'Миллиард параметров', 1e9),
  tokens('tok_12', 'Триллион токенов', 1e12),
  tokens('tok_18', 'Весь интернет', 1e18),
  tokens('tok_27', 'Датасет вселенной', 1e27),
  { id: 'agents_1', name: 'Первый Агент', desc: 'Нанять первого агента', check: (s) => totalAgents(s) >= 1 },
  { id: 'agents_50', name: 'Стартап', desc: '50 агентов одновременно', check: (s) => totalAgents(s) >= 50 },
  { id: 'agents_250', name: 'Скейлап', desc: '250 агентов одновременно', check: (s) => totalAgents(s) >= 250 },
  { id: 'one_100', name: 'Монокультура', desc: '100 агентов одной модели', check: (s) => Object.values(s.agents).some((n) => n >= 100) },
  { id: 'upgrade_1', name: 'Fine-tuned', desc: 'Купить первый Апгрейд', check: (s) => s.upgrades.length >= 1 },
  {
    id: 'full_roster', name: 'Полный зоопарк', desc: 'Иметь агентов всех моделей текущего поколения',
    check: (s) => CATALOG[s.generation].models.every((m) => (s.agents[m.id] ?? 0) > 0),
  },
  { id: 'prestige_1', name: 'Новое поколение', desc: 'Совершить Престиж', check: (s) => s.prestiges >= 1 },
  { id: 'prestige_5', name: 'Серийный релизер', desc: '5 престижей', check: (s) => s.prestiges >= 5 },
  { id: 'gen_4', name: 'Omni-присутствие', desc: 'Дойти до 4-го поколения', check: (s) => s.maxGeneration >= 3 },
  { id: 'gen_last', name: 'На передовой', desc: 'Дойти до последнего поколения', check: (s) => s.maxGeneration >= CATALOG.length - 1 },
  { id: 'perk_1', name: 'Инвестор', desc: 'Купить первый Перк', check: (s) => s.perks.length >= 1 },
  // Теневые: в Датасет не входят, в общем прогоне могут не выполняться.
  {
    id: 'sh_no_click', name: 'Тихий разгон', desc: 'Заработать 1M токенов за забег при не более 15 кликах',
    shadow: true, check: (s) => s.runTokens >= 1e6 && s.runClicks <= 15,
  },
  {
    id: 'sh_speed', name: 'Спидран', desc: 'Заработать 1M токенов за забег быстрее чем за 15 минут',
    shadow: true, check: (s, now = Date.now()) => s.runTokens >= 1e6 && now - s.runStartedAt <= 900_000,
  },
  {
    id: 'sh_hardcore', name: 'Чистый забег', desc: 'Нанять флагмана, не купив ни одного Апгрейда',
    shadow: true,
    check: (s) => (s.agents[CATALOG[s.generation].flagship.id] ?? 0) >= 1 && s.upgrades.length === 0,
  },
  {
    id: 'sh_777', name: 'Счастливый Compute', desc: 'Достичь прироста Престижа с цифрами 777',
    shadow: true, check: (s) => String(prestigeGain(s)).includes('777'),
  },
];

export const ACHIEVEMENT_BY_ID: Record<string, Achievement> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
);

/** Число заработанных НЕтеневых Достижений — база Датасета. Неизвестные id не считаем. */
export function nonShadowCount(state: GameState): number {
  const have = new Set(state.achievements);
  let n = 0;
  for (const a of ACHIEVEMENTS) {
    if (!a.shadow && have.has(a.id)) n++;
  }
  return n;
}

/** Возвращает id новых выполненных Достижений. */
export function newlyEarned(s: GameState, now: number = Date.now()): string[] {
  const have = new Set(s.achievements);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(s, now)).map((a) => a.id);
}

/**
 * Применяет вновь заработанные Достижения к состоянию.
 * Вызывается из каждого перехода состояния, который может выполнить условие.
 */
export function awardAchievements(s: GameState, now: number = Date.now()): { state: GameState; awarded: string[] } {
  const awarded = newlyEarned(s, now);
  if (awarded.length === 0) return { state: s, awarded };
  return { state: { ...s, achievements: [...s.achievements, ...awarded] }, awarded };
}
