# CODING_STANDARDS.md

Read before your first edit or code review. `AGENTS.md` names the five invariants; this file holds
their mechanism and every other rule that attaches to code. The tree is the source of truth: where
this file disagrees with it, fix this file in the same change.

## Invariants in detail

1. **Save.** Read `src/economy/state.ts` (`GameState`, `newGame(now)`, `SAVE_VERSION`) and
   `save.ts` (`migrate`, `MIGRATIONS`, import/export, the `CORRUPT_SAVE_KEY` quarantine) together.
   `migrate` silently drops model, upgrade and perk ids that have left the catalog; `importSave`
   rejects a whole export over one bad `generation`; a `SAVE_VERSION` bump with no matching
   `MIGRATIONS` entry rewrites old saves. Nothing in the repo recovers a lost run, so the migration
   and its test land in the same commit as the change.
2. **Offline.** Any gap past `OFFLINE_THRESHOLD_SEC` goes through `applyOffline` and its cap: a
   background tab or a sleeping laptop hands `advanceTime` a huge `dt`. Let `lastTick` drift from an
   income mutation, or skip the cap, and hours of income are silently created or destroyed.
3. **Balance.** Within a Поколение, cost and income strictly increase with Ранг, and every Модель's
   payback (cost ÷ income) stays within 3× of every other in its Поколение — the bound that keeps
   the Флагман, the only key to Престиж, reachable. Each Поколение scales ×1000; the real price
   bends cost within ±30% only, and speed is reference-only. `catalog.ts` is ADR-0001 in code
   (`buildCatalog`, `GEN_SCALE`, `MOD_SPREAD`, `PRESTIGE_DIVISOR_UNITS`). Before changing the
   ladder, run `tools/sim.ts`: the real engine with no renderer, printing when each milestone
   lands; its header gives the flags, and it runs under `npx tsx`, which is not a declared
   dependency.
4. **AA data.** The snapshot is public (see Снимок in `CONTEXT.md`). `npm run sync:aa` is
   maintainer-only and takes the key inline or from a gitignored `.env`. Vite hands only
   `VITE_`-prefixed variables to the bundle, so the key stays unprefixed and out of `index.html`.
   To override a number, `pin` it on the seed rather than hand-editing the JSON. The attribution
   stays in `Footer.tsx` and the shop's «Справка AA»; monetization would additionally need a
   commercial AA license.
5. **Russian.** The avoided synonyms — монета, тап, здание, юнит, сессия — stay out of
   player-facing text, identifiers and commit messages. `src/issues.test.ts` enforces them over the
   glossary, `src/economy/quips.test.ts` over the quip table.

## Where each rule lives

```
App.tsx        the shell and the only game clock
  └─ store/useGameStore   the only mutable owner, the only side effects
      └─ economy/         every rule, pure, free of React and the DOM
data/          content tables, never logic
components/    presentation: reads state, calls actions
```

- **Money math lives in `src/economy/`.** Components get every number by calling it; only the store
  and `src/economy/` construct or change `GameState`. Anything that needs a side effect (a sound, a
  toast, a write) is a store action, covered in `useGameStore.test.ts`.
- **A transition is `(GameState) => GameState` and returns the same object when nothing changed.**
  The store checks `next !== state` to skip sounds, toasts and re-renders.
- **One clock, one persistence path.** `App.tsx`'s 50 ms tick drives `advanceTime`. Every
  `localStorage` write goes through the store's save: throttled to `SAVE_INTERVAL_MS` (1 s) for the
  tick and the Клик, written at once on every other player action, flushed on
  `visibilitychange`/`pagehide`. New code hangs off the tick through the store; a bounded one-shot
  `setTimeout` (a toast's dwell) is the only other timer it starts.
- **Numbers reach the screen only through `formatNumber`, `formatCount` and `formatDuration`**; a
  bare number renders through `Num`, in `pixel-font` (ADR-0003).
- **`src/layout.ts` holds every layout number**; `THREE_COL_MIN` is the desktop/mobile switch.
- **Content tables move in pairs:** a new Лаборатория edits the `LabId` union and `LABS` together;
  `data/glossary.ts` timings are asserted against the code constants, so change both.
- **Components** style with inline `style` objects, the CSS variables and `pixel-*` classes from
  `index.css`, where keyframes live too. Dialogs trap focus through `useDialogFocus.ts`. Over a
  Сцена, every readable label sits off the artwork or on a darkened HUD band of its own (ADR-0002).
- **Audio is synthesized** — no files, no asset pipeline. `AudioContext` resumes only after a user
  gesture, so silence before the first click is expected.
- **`npm run sprites` is dead**: `scripts/chroma-key.py` is not in the repo. Flag it rather than
  rely on it.
- `docs/vision.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md` and `docs/research/` are history, not
  instructions.

## Code

- Content that varies in shape is a discriminated union (`Upgrade`, `PerkEffect`), never a bag of
  optional flags. Shipped code has no `any`; the few `as any` casts in tests feed deliberately
  invalid input or reach through a `Proxy` target.
- Comments carry the **why** a name cannot, in Russian like the rest of the tree.
- **Language by audience**: identifiers English; player-facing strings Russian; a commit's type
  prefix English (`feat(ui):`) with a subject, usually Russian, naming what the player sees —
  `fix(ux): не спрашивать про Испытание Забега до первого Престижа`.
- `npm install` from the committed lockfile. React, Vite, TypeScript, Zustand and Vitest move only
  when the task is about them; state a new dependency's maintenance cost out loud before adding it.
- **Blast radius**, before calling it done: who reads what you changed, which UI states it reaches,
  and whether it crosses the save contract.

## Tests

- Name every test `*.test.ts`: `vite.config.ts` includes only `src/**/*.test.ts`, so a `.test.tsx`
  is skipped silently. Run one case with `npm test -- -t '<name>'`.
- A bug fix ships with a test that goes **red** on the bug, in `src/issues.test.ts` as
  `describe('Issue #N: …')`.
- Assert values and contracts, not markup snapshots or wiring. When the contract *is* the source —
  the CSS gate under `[data-motion="reduced"]`, a cleanup handler — read the file as text with
  `readFileSync`, as `src/index.test.ts` and `src/issues.test.ts` do. There is no `@types/node`:
  extend `src/node-fs.d.ts` rather than adding the package.
- Assert over the **whole catalog**, not one hand-picked Поколение; a test that shrinks its loop is
  a deleted invariant.
- An async test waits on the real signal, or polls under a bound.
- Build state with `newGame(T0)` plus `buyAgents` / `buyUpgrade` / `prestige`, or a literal spread
  (`rich`); there is no fixture directory. Drive late-game volumes: a fresh state hides the rounding
  and overflow bugs in `formatNumber`, `maxAffordable` and prestige gains.

## Checking the UI by hand

Component behaviour is checked by hand, not by browser automation.

- Every layout band from `src/layout.ts`: three columns at or above `THREE_COL_MIN`, one tab at a
  time below it, and the compressed header at or below `NARROW_MAX`, where the footer's AA
  attribution must still show.
- The states you touched: empty first run, no income yet, the offline report at its cap, Престиж
  confirmation, the content finale, an import error.
- To reach a late state on a throwaway origin, export a run as a code from «Настройки» and import it
  there.

## Performance

- Judge at representative volumes: all eight Поколения, and Токены up to the `1e300` the tests
  already drive.
- Hot paths: `advanceTime` every 50 ms, per-render income in the shop, serialization on save, audio
  scheduling.

## Documentation

- Write down only what the code cannot say: a decision's reason, a cross-module constraint, a trap.
  When a documented decision changes, rewrite it in place so one account remains.
- `CONTEXT.md` and `docs/adr/` are the internal docs; `README.md` is the player's and stays thin.
  A merged PR is the implementation record: commit no plans, research notes, screenshots or
  checklists, and add no doc file unless the developer asks.

## Pull requests

Only when the developer asks; the developer pushes.

- **Title:** Conventional Commits with a scope, matching the history — `feat(economy):`,
  `feat(ui):`, `fix(format):`, `fix:`. Say what the player sees.
- **Body:** the problem in a sentence or two, the fix, and the alternatives you rejected and why.
  `Closes #N` for GitHub Issues (`Narek-Khachikyan/token-clicker`, driven by `gh`). Macroscope
  appends its own sections between invisible markers — leave them alone and never paste them
  elsewhere.
- **One concern per PR.** If the description says "also", split it.
- **Evidence:** before/after screenshots for UI changes, uploaded to the PR.
- **Babysitting:** poll checks and comments newer than the last push, verify each finding against
  the source, fix the real ones, dismiss false positives in writing. Stop when checks are green on
  the latest commit.
