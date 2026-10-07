# CODE_MAP.md

Who owns what, the reading order, and the rules that attach to a place. This is an ownership map,
not a file catalog: `ls` and the file itself answer what a module is, so an entry here earns its
line only with what they do not — a boundary, a reading order, a trap. When ownership moves, change
this file in the same commit.

## The shape of it

```
App.tsx        the shell and the only game clock
  └─ store/useGameStore   the only mutable owner
      └─ economy/         every rule, pure
data/          content tables, never logic
components/    presentation, reads state and calls actions
render/, audio/, layout.ts, index.css
scripts/, tools/
```

**Money math lives in `src/economy/`.** Components get every number by calling it and never
re-implement its arithmetic; only the store and `src/economy/` construct or change `GameState`, and
the store is the only module allowed to produce a side effect.

## `src/economy/` — every game rule, pure, free of React and the DOM

**A transition is `(GameState) => GameState` and returns the same object when nothing changed.**
The store checks `next !== state` to skip sounds, toasts and re-renders; keep that identity
contract in every transition you add.

- `engine.ts` — prices, income, Клик, offline accrual, Престиж. Read it before any balance work.
- `state.ts` and `save.ts` — the save contract, read together: `GameState`, `newGame(now)` and
  `SAVE_VERSION` in one; `migrate`, `MIGRATIONS`, import/export and the corrupt-save quarantine
  (`CORRUPT_SAVE_KEY`) in the other.
- `catalog.ts` — ADR-0001 in code: `buildCatalog` → `CATALOG`, the Ранг ladder and the balance
  constants (`GEN_SCALE`, `MOD_SPREAD`, `genScale`, `PRESTIGE_DIVISOR_UNITS`). `START_TOKENS_UNITS`
  lives in `perks.ts`, not here.
- `events.ts` — the Событие pool and its windows, plus the constants `GLOSSARY` and `NewsTicker`
  quote.
- `glitches.ts` — Глюки, the red-event tables behind Восстание моделей, and the Откуп rules.
- `news.ts` — Новостная лента and the Слух tables.
- `quips.ts` — the rules of «Переписка» (recording, the cap, the per-Лаборатория voice); the lines
  themselves are in `data/quips.ts`.
- `format.ts` — **numbers reach the screen only through `formatNumber`, `formatCount` and
  `formatDuration`**, in the player's chosen notation.

## `src/store/useGameStore.ts`

The only module that mutates state or causes a side effect: each tick's `advanceTime`, offline
accrual on load, sounds, toasts, click floaters, and UI-only slices such as the active tab, buy
amount and sell mode. Anything that needs a side effect goes through an action here, and
`useGameStore.test.ts` covers those actions.

It owns the one persistence path: the `localStorage` save is throttled to `SAVE_INTERVAL_MS`
(1 s) for the tick and the Клик, written at once on every other player action, and flushed on
`visibilitychange`/`pagehide` — not a write per tick.

## `src/data/` — content tables, not generated code

- `labs.ts` — adding a Лаборатория means editing the `LabId` union and `LABS` together.
- `generations.ts` — the seeds; see `CONTEXT.md` for the term.
- `glossary.ts` — the «Справка» definitions; their timings are asserted against the code constants,
  so a timing changes in both places.
- `thermalCopy.ts` — player-facing Температура copy, computed from `economy/thermal.ts` so the two
  cannot disagree.

## `src/components/` — presentation only

- Styling is inline `style` objects with the CSS variables and `pixel-*` classes from `index.css`;
  keyframes live in `index.css` too.
- A bare number renders through `Num`, in `pixel-font` (ADR-0003).
- `Modals.tsx` holds `SettingsModal`, the export/import UI and the other modals. Dialogs trap
  focus through `useDialogFocus.ts`.
- `OfficeColumn` picks one of four Сцены by `floor(generation / 2)`, preloads its neighbours when
  the index changes, and keeps every readable label either off the artwork or on a darkened HUD
  band of its own, so text contrast never depends on what the painting happened to put there
  (ADR-0002).

## The rest of `src/`

- `App.tsx` — the shell above the columns: the desktop/mobile switch, the 50 ms tick, the modals and
  toasts it mounts.
- `layout.ts` — the single source of every layout number. **`THREE_COL_MIN` is the desktop/mobile
  switch**; read it there rather than hard-coding a width.
- `render/sceneGrade.ts` — grades the four Сцены into one frame; pure.
- `audio/` — synthesized: no audio files, no asset pipeline. `AudioContext` resumes only after a
  user gesture, so silence before the first click is expected.

## Outside `src/`

- `scripts/sync-aa.mjs` — the maintainer-only Artificial Analysis fetch: it merges into the
  existing snapshot, writes atomically, and keeps only the slugs the seeds reference.
- `tools/sim.ts` — the balance simulator: the real engine with no renderer, printing when each
  milestone lands. Read it before changing the ladder; its header comment gives the flags. It runs
  under `npx tsx`, which is not a declared dependency.
- `public/scenes/`, `public/sprites/` — committed art. `public/sprites/raw/` is gitignored source
  art, and `npm run sprites` points at `scripts/chroma-key.py`, which is not in the repo: the
  command is dead, so flag it rather than rely on it.
- `docs/vision.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/research/` — working notes from
  the synthesis of the two overhaul branches. History, not instructions.
