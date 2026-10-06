# AGENTS.md

Token Clicker: a browser idle/clicker where the player hires real AI models that generate Токены and climbs through Поколения via Престиж. React + Vite + Zustand, one page, no backend. `README.md` is the player's; this file is for you, and it is a **router** — invariants, gotchas, verification, pointers. Everything else lives in `CODE_MAP.md`, `CODING_STANDARDS.md`, `CONTEXT.md`, `docs/adr/`, or the code itself. Prefer those over a second copy here.

## Never compromise on these

Every change is judged against them first.

1. **A player's run survives every change.** The only copy of a run is `localStorage['ai-tycoon-save']`, hand-serialized; `localStorage['ai-tycoon-save:corrupt']` holds quarantined bytes after a corrupt load, so both keys are someone's progress. `migrate` silently drops model, upgrade and perk ids that have left the catalog; `importSave` rejects a whole export over one bad `generation`; a `SAVE_VERSION` bump with no matching `MIGRATIONS` entry rewrites old saves. Nothing in this repo can recover a lost run, so a change to `GameState`, to catalog ids, or to `SAVE_VERSION` ships with its migration and its test in the same commit.
2. **Idle time is paid once, and capped.** `lastTick` moves together with every income mutation, and any gap past `OFFLINE_THRESHOLD_SEC` goes through `applyOffline` and its cap. Break either and hours of income are silently created or destroyed — a background tab or a sleeping laptop hands `advanceTime` a huge `dt`.
3. **Balance order stays monotonic.** Within a Поколение, cost and income strictly increase with Ранг, and no Ранг pays back more than 3× worse or faster than the cheapest or dearest Модель around it — that bound is what keeps the Флагман, the only key to Престиж, reachable. Each Поколение scales ×1000; real speed and price bend numbers within ±30% only. `src/economy/economy.test.ts` asserts every one of these across the whole catalog; keep them asserted.
4. **No Artificial Analysis key and no live AA call ever reach the client.** Metrics ship as a committed snapshot; `npm run sync:aa` is a maintainer-only tool that takes the key inline or from a gitignored `.env`. Vite hands only `VITE_`-prefixed variables to the bundle, so a key without that prefix stays out of the build — never add the prefix, never put it in `index.html`. The visible attribution stays in `Footer.tsx` and the shop's «Справка AA»; monetization would additionally require a commercial AA license. Rewrite `src/data/aa-snapshot.json` only through the sync script; to override a number, `pin` it on the seed instead of hand-editing the JSON.
5. **The player reads Russian, in the words of `CONTEXT.md`.** Токен, Клик, Доход, Модель, Агент, Лаборатория, Поколение, Забег, Престиж, Compute, Перк, Справка AA. The avoided synonyms — монета, тап, здание, юнит, сессия — stay out of player-facing text, identifiers and commit messages; `src/issues.test.ts` enforces them over the glossary and the quip table.

## Keep the human in the loop

These are not the model's defaults, and this repo enforces them.

- **You stop at a verified working tree.** The developer commits, pushes and opens the PR. Never commit, publish or deploy on your own initiative.
- **Kill only what you spawned.** Never `pkill -f` or kill a PID found by matching a name or path; your own process can match. Stop a server by the PID you captured at spawn.
- **No credential or personal data in code, logs, fixtures or messages.** Invariant 4 is the sharp case, not the only one.
- **Say what you did not verify.** An expectation is not a result: name what stayed in the **fog of war** and anything out of scope you noticed.
- A rule that fights the task in front of you gets flagged out loud, with sign-off, before you break it.

## Gotchas the code does not confess

- `npm run sprites` points at `scripts/chroma-key.py`, which is not in the repo. The command is dead — flag it rather than relying on it. Raw source art under `public/sprites/raw` is gitignored.
- `App.tsx` owns the only game clock: one 50 ms `setInterval` that drives `advanceTime`. Persistence is throttled to `SAVE_INTERVAL_MS` (1 s), force-written on every player action, and flushed on `visibilitychange`/`pagehide` — it is not a write per tick. Never add a second persistence path. The repeating timers that already exist are `NewsTicker`'s 15 s news rotation, `ClickColumn`'s counter interpolation, `PrestigeOverlay`'s overlay animation and `music.ts`'s audio scheduler; a one-shot `setTimeout` (a toast's dwell, a modal's exit) is not a timer under this rule. None of them is a pattern to copy into a new component.
- `npm run dev` is the only server. Vite takes the next free port, and every origin keeps its own save, so remember which port you got. Manual UI checks use a private window or a throwaway port, never the profile holding real progress; «Настройки» can export a run as a code and import it back.
- Audio stays silent until a user gesture: `AudioContext` resumes only after one, so a muted game before the first click is not a bug to chase.
- `dist/` and `tsconfig.tsbuildinfo` are build output. `tools/sim.ts` is the balance simulator and runs under `npx tsx`, which is not a dependency here.
- `src/audio/` is synthesized; there are no audio files and no asset pipeline.

## Verify

- `npm test` before you finish any economy, save, content or layout change. `npx tsc -b` is the only static gate: there is no linter, no formatter and no CI.
- One case: `npm test -- -t '<name>'`. `vite.config.ts` includes only `src/**/*.test.ts`, so a new `.test.tsx` never runs, silently — component behaviour is checked by hand.
- A bug fix ships with a test that goes **red** on the bug. Async tests wait on the real signal; no sleeps, and bounded polling where no completion signal exists.
- Before calling it done, know its **blast radius**: entry points, states, and anything crossing the save contract — this repo has one client and no API, so the surface is the UI's states and `src/economy/`. A one-way door is a bug unless the irreversibility is deliberate and said out loud.
- UI is checked by hand at both widths (≥1000 px and below) and in the states you touched — empty first run, no income yet, the offline report at its cap, Prestige confirmation, the content finale, an import error. No browser automation.

## Rules that attach to a place

- **Money math lives in `src/economy/engine.ts`.** Components read state and call store actions; they never construct or mutate `GameState`.
- **A transition that changes nothing returns the same object.** The store checks `next !== state` to skip sounds, toasts and re-renders; keep the identity contract when you add one.
- **Numbers reach the screen only through `formatNumber`, `formatCount` and `formatDuration`.**
- **Content that varies in shape is a discriminated union**, never a bag of optional flags.
- **One number decides the layout.** `THREE_COL_MIN` in `src/layout.ts` is the desktop/mobile switch — read it there rather than hard-coding a width.

## Pointers

Reach for these before you decide, not after.

- **Opening a module you have not opened?** `CODE_MAP.md` — one line per module, its reading order, and the invariants that hang off it.
- **Writing or reviewing code?** `CODING_STANDARDS.md` — the standard applied to what is in front of you: design, comments, naming, tests, docs, dependencies, performance, and the PR shape the developer asks for.
- **Touching balance, the AA data flow, the palette and Сцены, the pixel font, the Престиж overlay, or Температура?** Read the matching ADR in `docs/adr/` first. If your change contradicts one, say so out loud instead of overriding it.
- **Naming a domain concept** — in code, a commit, a test name, an issue title? `CONTEXT.md` holds the definition and the synonyms to avoid. A concept that is not there is either invented language or a real gap; say which.
- **Issue tracker, triage labels, domain-doc conventions?** `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`.

## Two words with fixed meanings

- **seed** — one row in `src/data/generations.ts`: a real Модель, its Лаборатория, its Поколение, and its fallback AA values.
- **snapshot** — `src/data/aa-snapshot.json`: metrics fetched from Artificial Analysis by `npm run sync:aa` and committed. It is imported straight into the bundle, so everything in it is public.
