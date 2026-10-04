import { CATALOG } from './catalog';
import { SHADOW_ACHIEVEMENTS } from './shadow';
import type { GameState } from './state';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  check: (s: GameState) => boolean;
}

const totalAgents = (s: GameState) => Object.values(s.agents).reduce((a, b) => a + b, 0);

const tokens = (id: string, name: string, n: number): Achievement => ({
  id, name, desc: `Заработать ${n.toExponential(0).replace('e+', 'e')} токенов за всё время`, check: (s) => s.totalTokens >= n,
});

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'click_1', name: 'Привет, мир', desc: 'Отправить первый промпт', check: (s) => s.clicks >= 1 },
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
  { id: 'upgrade_1', name: 'Дообучен', desc: 'Купить первый Апгрейд', check: (s) => s.upgrades.length >= 1 },
  {
    id: 'full_roster', name: 'Полный зоопарк', desc: 'Иметь агентов всех моделей текущего поколения',
    check: (s) => CATALOG[s.generation].models.every((m) => (s.agents[m.id] ?? 0) > 0),
  },
  { id: 'prestige_1', name: 'Новое поколение', desc: 'Совершить Престиж', check: (s) => s.prestiges >= 1 },
  { id: 'prestige_5', name: 'Серийный релизер', desc: '5 престижей', check: (s) => s.prestiges >= 5 },
  { id: 'gen_4', name: 'Omni-присутствие', desc: 'Дойти до 4-го поколения', check: (s) => s.maxGeneration >= 3 },
  { id: 'gen_last', name: 'На передовой', desc: 'Дойти до последнего поколения', check: (s) => s.maxGeneration >= CATALOG.length - 1 },
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
 *
 * Теней здесь нет намеренно: у них другой счётчик, а `awarded` этого перехода уходит в
 * тосты и в значок в шапке, где теневой id не нашёл бы обычную запись в таблице. Запись
 * теней идёт отдельным вызовом awardShadowAchievements.
 */
export function awardAchievements(s: GameState): { state: GameState; awarded: string[] } {
  const awarded = newlyEarned(s);
  if (awarded.length === 0) return { state: s, awarded };
  return { state: { ...s, achievements: [...s.achievements, ...awarded] }, awarded };
}

/** Возвращает id новых выполненных теневых Достижений. */
export function newlyEarnedShadows(s: GameState): string[] {
  const have = new Set(s.achievements);
  return SHADOW_ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(s)).map((a) => a.id);
}

/**
 * Применяет вновь заработанные тени к состоянию — форма ответа совпадает с
 * awardAchievements, поэтому стор вызывает её тем же способом.
 *
 * Тени пишутся в тот же `state.achievements`: отдельного поля в GameState нет, а
 * `migrate` отбрасывает только Модели, Апгрейды и Перки, поэтому id теней переживают
 * загрузку без миграции и без bump SAVE_VERSION. Плата за это — знаменатель: числителем
 * обычного счётчика может быть только ordinaryEarned, никогда не `achievements.length`.
 */
export function awardShadowAchievements(s: GameState): { state: GameState; awarded: string[] } {
  const awarded = newlyEarnedShadows(s);
  if (awarded.length === 0) return { state: s, awarded };
  return { state: { ...s, achievements: [...s.achievements, ...awarded] }, awarded };
}

/** Числитель обычного счётчика: тени лежат в том же списке, но в «N / 21» не входят. */
export function ordinaryEarned(s: GameState): number {
  return ACHIEVEMENTS.reduce((n, a) => n + (s.achievements.includes(a.id) ? 1 : 0), 0);
}

/** Числитель теневого счётчика. */
export function shadowEarned(s: GameState): number {
  return SHADOW_ACHIEVEMENTS.reduce((n, a) => n + (s.achievements.includes(a.id) ? 1 : 0), 0);
}
