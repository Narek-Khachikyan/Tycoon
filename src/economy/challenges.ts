import type { GameState } from './state';

/**
 * Испытание Забега: добровольное ограничение на весь Забег. Испытание выбирается только на
 * свежем забеге (см. canStartChallenge) и закрывается Престижем, а каждое закрытое даёт
 * постоянный +10% к Доходу. Термин зафиксирован: «Испытание Забега», не «челлендж».
 */
export interface ChallengeDef {
  id: 'no-synergy' | 'no-click';
  name: string;
  desc: string;
  /** Вечная награда за закрытие: процент к Доходу, складывается с остальными. */
  rewardPct: number;
}

/** Награда у всех Испытаний одна: +10% к Доходу навсегда за каждое закрытое. */
export const CHALLENGE_REWARD_PCT = 10;

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'no-synergy',
    name: 'Забег без Синергий',
    desc: 'Синергии Лабораторий не действуют весь Забег. Награда: +10% к Доходу навсегда.',
    rewardPct: CHALLENGE_REWARD_PCT,
  },
  {
    id: 'no-click',
    name: 'Забег без Кликов',
    desc: 'Клики не приносят Токены весь Забег, но их счётчик растёт — реплики Моделей и Переписка продолжают работать. Награда: +10% к Доходу навсегда.',
    rewardPct: CHALLENGE_REWARD_PCT,
  },
];

const CHALLENGE_IDS = new Set(CHALLENGES.map((c) => c.id));

/**
 * Испытание стартует только на свежем забеге: ни Агентов, ни Апгрейдов, ни Кликов.
 * Правило держит испытание честным — его нельзя включить задним числом на середине забега,
 * когда ограничение уже ничего не стоит, и нельзя снять штраф, не сбросив забег.
 */
export function canStartChallenge(state: GameState): boolean {
  return (
    Object.values(state.agents).every((n) => n <= 0) &&
    state.upgrades.length === 0 &&
    state.runClicks === 0
  );
}

/**
 * Ставит активное Испытание (null — снять выбор). Работает только на свежем забеге:
 * иначе возвращается тот же объект, и стор по identity-контракту пропускает звуки и тосты.
 */
export function startChallenge(state: GameState, id: ChallengeDef['id'] | null): GameState {
  if (!canStartChallenge(state)) return state;
  if (id !== null && !CHALLENGE_IDS.has(id)) return state;
  if (state.activeChallenge === id) return state;
  return { ...state, activeChallenge: id };
}

/**
 * Множитель Дохода за закрытые Испытания: +10% за каждое, дедуп по id.
 *
 * Считаются все записи без сверки с таблицей — как Достижения, а не как Перки: id переживает
 * правку таблицы, и закрытое Испытание не должно дешеветь от того, что его строку переименовали.
 */
export function challengeIncomeMult(state: GameState): number {
  return 1 + (CHALLENGE_REWARD_PCT / 100) * new Set(state.challengesDone).size;
}
