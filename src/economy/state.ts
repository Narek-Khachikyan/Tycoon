export const SAVE_VERSION = 2;

export type Notation = 'short' | 'sci';

export interface GameState {
  version: number;
  generation: number;
  maxGeneration: number;
  tokens: number;
  runTokens: number;
  totalTokens: number;
  clicks: number;
  runClicks: number;
  agents: Record<string, number>;
  upgrades: string[];
  compute: number;
  computeSpent: number;
  perks: string[];
  prestiges: number;
  achievements: string[];
  lastTick: number;
  startedAt: number;
  runStartedAt: number;
  settings: { notation: Notation; muted: boolean; reducedMotion: boolean };
}

export function newGame(now: number): GameState {
  return {
    version: SAVE_VERSION,
    generation: 0,
    maxGeneration: 0,
    tokens: 0,
    runTokens: 0,
    totalTokens: 0,
    clicks: 0,
    runClicks: 0,
    agents: {},
    upgrades: [],
    compute: 0,
    computeSpent: 0,
    perks: [],
    prestiges: 0,
    achievements: [],
    lastTick: now,
    startedAt: now,
    runStartedAt: now,
    settings: { notation: 'short', muted: false, reducedMotion: false },
  };
}
