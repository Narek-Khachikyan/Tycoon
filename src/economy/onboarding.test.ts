import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { coachDone, coachStep } from './onboarding';
import { newGame, type GameState } from './state';

const T0 = 1_000_000;
const at = (patch: Partial<GameState>): GameState => ({ ...newGame(T0), ...patch });
const hired = { [CATALOG[0].models[0].id]: 1 };

describe('onboarding coach', () => {
  it('walks first click, first agent, first event, each with a title and a hint', () => {
    const steps = [at({}), at({ clicks: 1 }), at({ clicks: 1, agents: hired })].map(coachStep);
    expect(steps.map((s) => s?.id)).toEqual(['first-click', 'first-agent', 'first-event']);
    for (const step of steps) {
      expect(step!.title.trim()).not.toBe('');
      expect(step!.body.trim()).not.toBe('');
    }
  });

  // Регрессия: событие на 45–90-й секунде гасило подсказку даже у игрока, который ещё не
  // сделал ни одного Клика, — и новичок терял объяснение, не начав ни одного шага.
  it('keeps the first step for a player who has not clicked, even after an event', () => {
    const s = at({ eventsSeen: 1 });
    expect(coachDone(s)).toBe(false);
    expect(coachStep(s)?.id).toBe('first-click');
  });

  it('ends for good once the player has clicked and an event was seen or caught', () => {
    for (const s of [
      at({ clicks: 1, eventsSeen: 1 }),
      at({ clicks: 1, eventCaughtAt: 1 }),
      at({ clicks: 25, agents: hired, eventCaughtAt: T0 + 5000 }),
    ]) {
      expect(coachDone(s)).toBe(true);
      expect(coachStep(s)).toBeNull();
    }
  });

  it('does not come back after a Prestige or on a later generation', () => {
    for (const s of [at({ prestiges: 1 }), at({ generation: 1 }), at({ generation: 2 })]) {
      expect(coachDone(s)).toBe(true);
      expect(coachStep(s)).toBeNull();
    }
  });
});
