import type { GameState } from './state';
import { totalAgents } from './upgrades';

export interface CoachStep {
  id: string;
  title: string;
  body: string;
}

const STEP_FIRST_CLICK: CoachStep = {
  id: "first-click",
  title: "Первый Клик",
  body: "Нажми «Отправить промпт»: каждый Клик генерирует первые Токены.",
};

const STEP_FIRST_AGENT: CoachStep = {
  id: "first-agent",
  title: "Первый Агент",
  body: "Найми первую Модель в магазине: Агенты автоматически приносят Доход в Токенах каждую секунду.",
};

const STEP_FIRST_EVENT: CoachStep = {
  id: "first-event",
  title: "Апгрейды и События",
  body: "Покупай Апгрейды в магазине для ускорения Дохода и жди Золотой Токен, чтобы поймать первое Событие.",
};

/**
 * Пройден ли онбординг навсегда.
 *
 * Поток живёт только в первом Забеге: после Престижа игрок уже знает все механики, и
 * подсказки вернулись бы к знакомому виду.
 *
 * Событие засчитывается как пройденный поток только ПОСЛЕ первого Клика. Первое Событие
 * приходит на 45–90-й секунде, и игрок, который задержался на чтение интерфейса, иначе
 * потерял бы все три подсказки, не сделав ни одного шага: объяснение исчезло бы ровно
 * тогда, когда оно было нужнее всего.
 */
export function coachDone(state: GameState): boolean {
  if (state.prestiges > 0 || state.generation > 0 || state.maxGeneration > 0) return true;
  if (state.clicks < 1) return false;
  return state.eventCaughtAt > 0 || state.eventsSeen > 0;
}

/**
 * Текущий шаг подсказки для новичка (ровно 3 шага для первого Забега).
 * Возвращает null, если онбординг пройден или не применим.
 */
export function coachStep(state: GameState): CoachStep | null {
  if (coachDone(state)) {
    return null;
  }

  // Шаг 1: до первого Клика — объясняем базовое ручное действие.
  if (state.clicks < 1) {
    return STEP_FIRST_CLICK;
  }

  // Шаг 2: после первого Клика, до найма первого Агента — объясняем покупку Модели и пассивный Доход.
  if (totalAgents(state) < 1) {
    return STEP_FIRST_AGENT;
  }

  // Шаг 3: после первого Агента, до первого События — ориентируем на магазин Апгрейдов и ожидание Золотого Токена.
  return STEP_FIRST_EVENT;
}
