import { describe, expect, it } from 'vitest';
import { CATALOG } from './catalog';
import { coachDone, coachStep } from './onboarding';
import { newGame, type GameState } from './state';

const T0 = 1_000_000;
const firstModelId = CATALOG[0].models[0].id;

describe('coachDone', () => {
  // Регрессия: событие на 45–90-й секунде гасило подсказку даже у игрока, который ещё не
  // сделал ни одного Клика, — и новичок терял объяснение, не начав ни одного шага.
  it('не считает пройденным игрока, который ещё ни разу не кликнул, даже если событие случилось', () => {
    expect(coachDone({ ...newGame(T0), eventsSeen: 1 })).toBe(false);
    expect(coachStep({ ...newGame(T0), eventsSeen: 1 })?.id).toBe('first-click');
  });

  it('закрывает поток после первого Клика и случившегося События', () => {
    expect(coachDone({ ...newGame(T0), clicks: 1, eventsSeen: 1 })).toBe(true);
    expect(coachDone({ ...newGame(T0), clicks: 1, eventCaughtAt: 1 })).toBe(true);
  });
});

describe('onboarding coach', () => {
  it("шаг 1 на свежем состоянии: до первого Клика", () => {
    const s = newGame(T0);
    expect(coachDone(s)).toBe(false);

    const step = coachStep(s);
    expect(step).not.toBeNull();
    expect(step?.id).toBe("first-click");
    expect(step?.title.trim().length).toBeGreaterThan(0);
    expect(step?.body.trim().length).toBeGreaterThan(0);
  });

  it("шаг 2 после первого Клика (clicks >= 1) и до найма Агента", () => {
    const s0 = newGame(T0);
    const s1: GameState = { ...s0, clicks: 1, runClicks: 1 };
    expect(coachDone(s1)).toBe(false);

    const step = coachStep(s1);
    expect(step).not.toBeNull();
    expect(step?.id).toBe("first-agent");
    expect(step?.title.trim().length).toBeGreaterThan(0);
    expect(step?.body.trim().length).toBeGreaterThan(0);
  });

  it("шаг 3 после найма первого Агента и до первого пойманного События", () => {
    const s0 = newGame(T0);
    const s1: GameState = {
      ...s0,
      clicks: 15,
      runClicks: 15,
      agents: { [firstModelId]: 1 },
    };
    expect(coachDone(s1)).toBe(false);

    const step = coachStep(s1);
    expect(step).not.toBeNull();
    expect(step?.id).toBe("first-event");
    expect(step?.title.trim().length).toBeGreaterThan(0);
    expect(step?.body.trim().length).toBeGreaterThan(0);
  });

  it("после пойманного События coachStep возвращает null и coachDone = true", () => {
    const s0 = newGame(T0);
    const sWithEvent: GameState = {
      ...s0,
      clicks: 25,
      agents: { [firstModelId]: 1 },
      eventCaughtAt: T0 + 5000,
    };
    expect(coachDone(sWithEvent)).toBe(true);
    expect(coachStep(sWithEvent)).toBeNull();
  });

  it("если Событие уже появлялось (eventsSeen > 0), поток завершён навсегда", () => {
    const s0 = newGame(T0);
    const sSeen: GameState = {
      ...s0,
      clicks: 20,
      agents: { [firstModelId]: 1 },
      eventsSeen: 1,
    };
    expect(coachDone(sSeen)).toBe(true);
    expect(coachStep(sSeen)).toBeNull();
  });

  it("на Поколении 2+ и после Престижа поток НЕ возвращается", () => {
    const s0 = newGame(T0);

    // Свежий Забег после первого Престижа (prestiges = 1, clicks = 0, agents = {})
    const sPrestige: GameState = {
      ...s0,
      prestiges: 1,
      clicks: 0,
      agents: {},
    };
    expect(coachDone(sPrestige)).toBe(true);
    expect(coachStep(sPrestige)).toBeNull();

    // Второе Поколение (generation = 1)
    const sGen1: GameState = {
      ...s0,
      generation: 1,
      clicks: 0,
      agents: {},
    };
    expect(coachDone(sGen1)).toBe(true);
    expect(coachStep(sGen1)).toBeNull();

    // Поколение 3 (generation = 2)
    const sGen2: GameState = {
      ...s0,
      generation: 2,
      clicks: 0,
      agents: {},
    };
    expect(coachDone(sGen2)).toBe(true);
    expect(coachStep(sGen2)).toBeNull();
  });

  it("у каждого шага онбординга непустые заголовок и подсказка", () => {
    const s0 = newGame(T0);
    const s1: GameState = { ...s0, clicks: 1 };
    const s2: GameState = { ...s1, agents: { [firstModelId]: 1 } };

    const step1 = coachStep(s0);
    const step2 = coachStep(s1);
    const step3 = coachStep(s2);

    for (const step of [step1, step2, step3]) {
      expect(step).not.toBeNull();
      expect(step!.title.trim()).not.toBe("");
      expect(step!.body.trim()).not.toBe("");
    }
  });
});
