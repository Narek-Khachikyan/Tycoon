import { CATALOG, LAST_GENERATION, prestigeDivisor } from './catalog';
import { canPrestige } from './engine';
import type { GameState } from './state';
import { totalAgents } from './upgrades';

/**
 * ВЕХИ — список целей, который игрок проходит за первые полчаса.
 *
 * Отдельная сущность рядом с Достижениями, а не новый вид Достижения, потому что отвечает
 * на другой вопрос. Достижение спрашивает «ты сделал это когда-нибудь» и лежит в сейве как
 * факт; веха спрашивает «ты сделал это и что тебе за это» — она выдаёт награду, показывает
 * следующую цель и сгорает при Престиже.
 *
 * Награда всегда в том, что игрок может потратить сейчас (Токены или Compute), и никогда —
 * в множителе «навсегда». Постоянные бонусы принадлежат Перкам: если веха давала вечное,
 * игрок бы шёл к ней вместо Перка, и две лестницы конкурировали бы за одни и те же номера
 * Compute.
 *
 * Пороги заданы в единицах масштаба Поколения (`units`), а не абсолютными числами: забег в
 * Поколении 5 идёт в миллион раз быстрее первого, и абсолютный рубеж вроде «1e9 Токенов»
 * был бы пройден на второй секунде.
 */
export interface Milestone {
  id: string;
  /** Заголовок вехи: что именно игрок сейчас делает. */
  title: string;
  /** Подпись под заголовком: зачем это нужно, одной строкой. */
  hint: string;
  /** Награда в единицах масштаба Поколения. */
  units: number;
  check: (s: GameState) => boolean;
}

const agents = totalAgents;

/**
 * Температура в вехах: цель, ради которой игрок двигает шкалу руками, а не только кликает.
 *
 * Первые три вехи закрываются тем, что игрок уже делает, и только четвёртая требует
 * осознанного жара. Так шкала попадает в первый игровой цикл как инструмент, а не как
 * украшение: игрок видит, что нагрев приносит Токены раньше, чем успевает задаться вопросом,
 * зачем он нужен.
 */
export const MILESTONES: Milestone[] = [
  {
    id: 'ms_click',
    title: 'Отправь первый промпт',
    hint: 'Клик по кнопке — и Токены капают в кошелёк',
    units: 15,
    check: (s) => s.clicks >= 1,
  },
  {
    id: 'ms_heat',
    title: 'Разгони Температуру',
    hint: 'Сдвинь шкалу вправо: жар поднимает Доход',
    units: 40,
    check: (s) => s.temp >= 0.6,
  },
  {
    id: 'ms_hire',
    title: 'Найми первого Агента',
    hint: 'Дешевле всего — самая младшая Модель Поколения',
    units: 60,
    check: (s) => agents(s) >= 1,
  },
  {
    id: 'ms_agents10',
    title: 'Собери 10 Агентов',
    hint: 'Кнопка «×10» покупает сразу десяток',
    units: 150,
    check: (s) => agents(s) >= 10,
  },
  {
    id: 'ms_upgrade',
    title: 'Купи первый Апгрейд',
    hint: 'Вкладка «Апгрейды» — там множители за Токены',
    units: 300,
    check: (s) => s.upgrades.length >= 1,
  },
  {
    id: 'ms_agents25',
    title: 'Собери 25 Агентов',
    hint: 'Температура важнее количества: доход считается от жара',
    units: 900,
    check: (s) => agents(s) >= 25,
  },
  {
    id: 'ms_overheat',
    title: 'Перегрей и остуди',
    hint: 'Дай шкале дойти до края — офис сбросит жар сам',
    units: 2_500,
    check: (s) => s.overheatedAt > 0,
  },
  {
    id: 'ms_roster',
    title: 'Возьми по Агенту каждой Модели',
    hint: '«Полный зоопарк»: по карточке каждой Модели ростера',
    units: 6_000,
    check: (s) => CATALOG[s.generation].models.every((m) => (s.agents[m.id] ?? 0) > 0),
  },
  {
    id: 'ms_upgrades5',
    title: 'Купи 5 Апгрейдов',
    hint: 'Датасет раскрывается по Достижениям, а не по кнопке',
    units: 15_000,
    check: (s) => s.upgrades.length >= 5,
  },
  {
    id: 'ms_flagship',
    title: 'Найми Флагмана',
    hint: 'Самая умная Модель Поколения открывает Престиж',
    units: 40_000,
    check: (s) => canPrestige(s),
  },
];

/** Веха по id — для тостов и проверок, что id не потерялся. */
export const MILESTONE_BY_ID: Record<string, Milestone> = Object.fromEntries(
  MILESTONES.map((m) => [m.id, m]),
);

/**
 * Вехи, которые игрок уже выполнил, но ещё не забрал: выполняются по порядку, и забирать
 * можно только первую unmet. Иначе игрок, вернувшийся после простоя, получил бы сразу
 * шесть наград и не понял бы, за что.
 */
export function claimableMilestones(s: GameState): Milestone[] {
  return MILESTONES.filter((m) => !s.milestones.includes(m.id) && m.check(s));
}

/**
 * Награда за веху в Токенах.
 *
 * Считается от масштаба ТЕКУЩЕГО Поколения, а не того, где веха была выполнена: игрок
 * выполняет веху и забирает её в том же Поколении, а если он закрыл её перед Престижем и
 * вернулся — награда должна остаться в масштабе нового, иначе она стала бы смехотворной.
 */
export function milestoneReward(s: GameState, m: Milestone): number {
  return m.units * CATALOG[s.generation].scale;
}

/**
 * Подсказка к вехе с учётом текущего состояния игры (например, размера ростера поколения).
 */
export function milestoneHint(s: GameState, m: Milestone): string {
  if (m.id === 'ms_roster') {
    const count = CATALOG[s.generation].models.length;
    return `«Полный зоопарк»: ${count} карточек, ${count} галочек`;
  }
  return m.hint;
}

/**
 * Забирает все выполненные вехи разом, но только подряд с первой unmet.
 *
 * Награды складываются в один переход, а не выдаются по одному на тик: шесть тостов разом
 * хуже одного с перечислением, а состояние обязано обновиться за один тик, потому что
 * `lastTick` двигается вместе с наградой.
 */
export function claimMilestones(s: GameState): { state: GameState; claimed: Milestone[]; total: number } {
  const firstUnmet = MILESTONES.findIndex((m) => !s.milestones.includes(m.id) && !m.check(s));
  // -1 значит «все выполнены, но не забраны» — забрать надо их все.
  const limit = firstUnmet === -1 ? MILESTONES.length : firstUnmet;
  const claimed = MILESTONES.slice(0, limit).filter((m) => !s.milestones.includes(m.id) && m.check(s));
  if (claimed.length === 0) return { state: s, claimed, total: 0 };
  const total = claimed.reduce((sum, m) => sum + milestoneReward(s, m), 0);
  return {
    state: {
      ...s,
      tokens: s.tokens + total,
      runTokens: s.runTokens + total,
      totalTokens: s.totalTokens + total,
      milestones: [...s.milestones, ...claimed.map((m) => m.id)],
    },
    claimed,
    total,
  };
}

/**
 * Следующая цель: первая unmet-веха. Чистый вывод, без состояния — та же полоса в трёх местах
 * обязана показывать одно и то же, иначе игрок увидит разные цифры на одной странице.
 */
export function nextMilestone(s: GameState): Milestone | null {
  return MILESTONES.find((m) => !s.milestones.includes(m.id)) ?? null;
}

/**
 * Compute, который даст Престиж, округлённый вниз — для подсказки «сколько до следующего».
 * Живёт здесь, а не в компоненте, потому что это числа каталога и Prestige.
 */
export const nextComputeAt = (s: GameState): number =>
  Math.pow(Math.floor(Math.cbrt(s.runTokens / prestigeDivisor(s.generation))) + 1, 3) * prestigeDivisor(s.generation);

/** Дошёл ли игрок до финала контента: последнее Поколение и есть цель. */
export const isFinaleGoal = (s: GameState): boolean => s.generation >= LAST_GENERATION;