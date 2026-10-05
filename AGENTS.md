# AGENTS.md

This file has two parts. **Part 1** is universal and applies to any codebase. **Part 2** is specific to this project and overrides Part 1 where they conflict.

---

# Part 1. Universal principles

## How we think about software

Complexity is the enemy. It means the amount of knowledge someone needs to understand and safely change the system, not the number of lines. It arrives incrementally, one reasonable special case at a time, and is far easier to add than to remove.

- **Understand before changing.** Read the affected code, its callers, and nearby tests. Find local conventions and verification commands instead of guessing them. Separate facts from assumptions; ask when ambiguity materially changes the outcome, otherwise assume and say so.
- **Smallest correct model.** Choose the simplest design that meets the actual requirement and makes correct behavior unsurprising. Do not preserve complexity because it already exists. Do not add configuration, extensibility, or general-purpose machinery for hypothetical needs.
- **Design it twice.** For consequential design decisions, consider at least two plausible approaches and explain the trade-off when it materially affects the implementation. Keep the plan short; planning is not a separate project.
- **Deep modules, small interfaces.** Hide substantial complexity behind a surface callers can understand without reading the inside. Encapsulate decisions likely to change. Keep wrappers that provide a real contract or a stable boundary; remove those that add a hop without hiding anything.
- **Boundaries hold the mess.** External-system quirks live in adapters, parsers, and I/O layers. Separate domain logic from transport, storage, and presentation where it reduces complexity, not to satisfy a layering diagram.
- **Abstract knowledge, not similar-looking code.** Each rule, contract, and decision has one source of truth. Do not merge fragments because they look alike; they may have different reasons to change. An abstraction that accumulates flags and special cases is asking to be split.
- **Easier to change wins ties.** Prefer reversible decisions. Give migrations, compatibility breaks, and new dependencies explicit attention.
- **No broken windows, no scope creep.** Fix small rot you touch or flag it explicitly. Unrelated improvements and out-of-scope problems get reported separately, not folded in silently.
- **Good enough software.** Know when to stop. Honor the developer's intent in a minimal and realistic fashion.

These are good defaults, not hard rules. The developer's explicit preference overrides anything here. If a rule fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Ways to hurt yourself

Irreversible or hard-to-notice mistakes. Read before running anything.

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID found by matching a name or path. Your own process may match. Kill only PIDs you captured at spawn or a port owner you have positively identified.
2. **Touching live data.** Reading and copying from real data is fine. Never start a service against it, never open it read-write, never "clean it up".
3. **Baking environment into artifacts.** Do not embed secrets or developer-machine-specific configuration in committed files or builds. Keep values that differ between environments configurable.
4. **Destroying others' work.** Do not overwrite, revert, or stash changes you did not make. Do not force-push, delete branches, run migrations, or hit external or paid services without explicit authorization.
5. **Leaking secrets.** Never put credentials or personal data in code, logs, test fixtures, or messages.

Work may be directed remotely or from a shared machine. Do not change global settings, install global dependencies, or clean up anything you did not create.

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and state which entries applied:

- **Entry points.** UI, API, CLI, background jobs, settings, command palette, keyboard shortcuts. Fixing one is not fixing the feature.
- **Platforms, clients, integrations.** Each supported one needs a decision, even if it is "not supported here".
- **Contracts.** Anything crossing a boundary (API, schema, wire format, events, errors) evolves together with its consumers. Pick a rollout order that preserves the compatibility the project requires.
- **Reverse states and lifecycle.** If you add a way in, add the way out and a way to see the current state. Create, edit, cancel, delete, restore. A one-way door is a bug unless the irreversibility is intended and made explicit.
- **UI states.** Empty, loading, success, error, and huge dataset.
- **Hostile conditions.** Repeated calls, concurrency, interruption, reconnection, first run.
- **Docs.** Does the change make existing guidance inaccurate? Apply the documentation rules below before adding anything.

Do not implement hypothetical scenarios. But do not mistake one working path for a complete feature.

## Test data

An empty database alone is a bad test. Seed your sandbox with a copy of realistic data instead of pointing at live state.

- Use a snapshot procedure that yields a consistent file while the source is in use. A plain file copy of a running database may be inconsistent; treat it as corrupt.
- Bring secrets and settings only if the flow under test needs them.
- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- Choose the **smallest sufficient** proof, not the smallest possible one: tests you touched, targeted lint and typecheck for the scope you changed. Expand when touching shared contracts, dependencies, or infrastructure.
- Test observable behavior, public contracts, and meaningful invariants, not implementation shape. Do not render components to static markup to assert props, or write tests that only confirm a callback was wired or mirror the code line by line. Never weaken a test to make it pass.
- Bug fixes ship with a regression test. Behavior changes ship with focused tests for that behavior.
- Async tests wait on real signals (events, receipts, completion). No arbitrary sleeps. When no completion signal exists, use bounded condition-based polling so the test cannot hang.
- Tracer bullets: get a thin end-to-end path working first, then thicken it.
- If verification is unavailable, state exactly what remains unverified. Never present an expectation as a confirmed result.

## Performance

- Consider the critical paths: I/O, queries, payload size, memory, rendering, background work.
- Evaluate with representative data volumes, not empty states.
- Justify non-trivial optimizations with measurements. If performance requires a more complex design, record the measured problem and the trade-off.

## Documentation

Most code changes do not need a documentation change. Agents can read the code.

- Code records implementation; comments explain intent, contracts, constraints, and non-obvious reasons. They describe how a thing is used, move with the code, and are fixed or deleted the moment they stop being true. Do not narrate obvious operations or use comments to excuse confusing code.
- Internal docs hold architectural decisions and their reasons, cross-component constraints, and traps hard to discover from source. Before adding a paragraph, ask what a maintainer would get wrong without it. If the code answers the question, leave it out.
- Do not enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation.
- When a documented decision changes, rewrite or remove the affected text. Do not append a second account.
- User docs help users accomplish tasks. Update them when how a user does something changes. Do not describe every button, layout, or UI state.
- Do not create documentation, reports, plans, or notes as a by-product of every task. No new doc files unless requested.
- Do not commit implementation plans, research notes, or scratch files. A merged PR is the implementation record; do not keep a second checklist in the repository.

## Code quality

- One concept, one name, everywhere. If a comment is needed to say _what_ a thing is, rename it. Comments are for _why_: domain context and constraints a name cannot carry.
- Errors: define them out of existence where possible; handle them where a meaningful decision can be made; never disguise failure as success.
- Validate untrusted input at the boundary; trust established invariants inside.
- Minimize implicit side effects and undocumented call-order requirements. Make illegal states unrepresentable where cheap.
- Follow existing conventions. If they block a correct solution, explain the conflict instead of silently introducing a competing style.

## Keep humans in control

- Never commit, push, publish, deploy, or open a PR unless the developer explicitly asks.
- Communicate blockers and risks as soon as they appear, not at the end.
- Before adding a dependency, check what the project already has and weigh the maintenance cost.
- In the final response, state briefly: what changed, how it was verified, what remains unverified, and anything out of scope you noticed.

---

# Part 2. This project

## AI Tycoon

A browser idle/clicker game in the spirit of Cookie Clicker: the player hires real AI models that generate Tokens and climbs through Generations of AI via Prestige. It is a single-page client — React 19 + Vite + Zustand, no backend, no accounts — with the Russian-language player experience shipped as a static bundle. The only external system is Artificial Analysis, whose metrics are baked into a committed snapshot at release time (ADR-0001).

## What we can never compromise on

Every change is judged against these first.

1. **Player progress survives every change.** The only copy of a player's run is `localStorage['ai-tycoon-save']`, written by hand. `migrate` silently drops model, upgrade and perk ids that no longer exist, `importSave` rejects a whole export over one bad generation index, and a `SAVE_VERSION` bump without a matching `MIGRATIONS` entry rewrites old saves. Nothing in this repo can recover a lost run, so a change to `GameState`, to catalog ids, or to the save version is a change to live data: ship the migration and its test in the same commit, and never clear a key you did not create.
2. **Idle time is never paid twice and never uncapped.** `lastTick` must move together with every income mutation, and any gap longer than `OFFLINE_THRESHOLD_SEC` must go through `applyOffline` with its cap. Break either and hours of idle income are silently created or destroyed — including when a background tab or a sleeping laptop produces a huge `dt`.
3. **Balance order stays monotonic.** Within a Generation, cost and income strictly increase with Rank; each Generation scales by ×1000; real speed and price only bend numbers within ±30%. A change that makes a cheaper Model more productive inverts the whole progression, so these invariants are asserted over the full catalog in the tests and must stay asserted.
4. **No Artificial Analysis key and no live AA call ever reach the client.** Metrics ship as a committed snapshot; the sync script is a maintainer-only tool that takes the key as an inline environment variable. The visible attribution stays in the footer and the shop, and monetization would additionally require a commercial AA license.
5. **The player reads Russian, in the words of `CONTEXT.md`.** Токен, Клик, Доход, Модель, Агент, Лаборатория, Поколение, Забег, Престиж, Compute, Перк, Справка AA. The synonyms the glossary explicitly avoids — монета, тап, здание, юнит, сессия — do not appear in player-facing text, identifiers, or commit messages.

## Glossary

- **you** means the agent reading this file and changing the codebase.
- **we / maintainers** mean the repo owner working solo on `Narek-Khachikyan/Tycoon`.
- **user / player** means the person playing the game in a browser. All player-facing text is Russian.
- **Domain terms** — Токен, Клик, Доход, Оффлайн-доход, Лаборатория, Модель, Агент, Ранг, Флагман, Маскот, Сцена, Апгрейд, Синергия, Поколение, Забег, Престиж, Compute, Перк, Достижение, Новостная лента, Справка AA — mean exactly what `CONTEXT.md` says, including the synonyms it tells us to avoid.
- **seed** means one row in `src/data/generations.ts`: a real model, its Lab, its manual Generation cut, and fallback AA values.
- **snapshot** means `src/data/aa-snapshot.json`: metrics fetched from Artificial Analysis by `npm run sync:aa` and committed to the repo.
- **catalog** means `CATALOG` in `src/economy/catalog.ts`: the generated Generation → Model tree that every other rule reads.
- **Rank** means a model's position inside its Generation by Intelligence Index, weakest to smartest; it is what drives price and income.
- **transition** means a pure `(GameState) => GameState` function in `src/economy/`, which returns the same object when nothing changed.

## Project-specific footguns

Beyond "Ways to hurt yourself":

- `localStorage['ai-tycoon-save']` in a developer's browser is real player progress. Never `localStorage.clear()`, never write it from a script or a test, and never bump `SAVE_VERSION` in `src/economy/state.ts` without the matching entry in `MIGRATIONS` in `src/economy/save.ts`.
- `src/data/aa-snapshot.json` is imported straight into the bundle, so treat everything in it as public. Rewrite it only through `npm run sync:aa` — the script reads the key, merges into the existing file, writes atomically, and refuses to replace an unparseable snapshot. It keeps only the slugs the seeds reference, because nothing else is readable by the game. To override a number, pin it on the seed instead of hand-editing the JSON.
- `npm run sprites` points at `scripts/chroma-key.py`, which is not in the repo. The command is dead; flag it rather than relying on it. Raw source art under `public/sprites/raw` is gitignored and local only.
- `npm run dev` is the only server here. Vite silently takes the next free port, so remember which port you actually got — each origin has its own save — and stop it by the PID you spawned.
- Audio needs a user gesture. `AudioContext` can stay `suspended`, in which case every sound is a no-op. That is not a bug to chase.
- The tick already serializes state to `localStorage` every 50 ms. Do not add a second persistence path, a longer interval, or an extra animation loop.
- `dist/` and `tsconfig.tsbuildinfo` are build output. Never commit or hand-edit them.

## Surfaces

- **Platforms / clients:** exactly one — a responsive browser client. At ≥1000 px `App.tsx` renders the three columns; below that it swaps to one tab at a time. The threshold is `THREE_COL_MIN` from `src/layout.ts` — the sum of the column minima — so read it from there instead of hard-coding a new number. There is no server, no API, no CLI, no second client. All shared rules live in `src/economy/`, so a UI change never re-implements economy math.
- **Integrations / adapters:** `scripts/sync-aa.mjs` (Artificial Analysis HTTP, maintainer-only, needs `AA_API_KEY`); Google Fonts (Pixelify Sans + Nunito) fetched by `index.html`; Web Audio API through `src/audio/sound.ts`; `localStorage` persistence plus base64 save export/import through the clipboard in `src/components/Modals.tsx`.
- **Contracts** are typed in `src/economy/state.ts` (`GameState`) and enforced by `src/economy/save.ts` (`SAVE_VERSION`, `MIGRATIONS`, `migrate`). Model, upgrade and perk ids are part of that contract: an id missing from the catalog is dropped on load. Rollout order is contract-first and atomic — a change to the state shape, to ids, or to `SAVE_VERSION` ships with its migration and its tests in the same PR, because there is no server to stage a two-release rollout.
- **Modes:** active play; background tab, sleep or a closed tab (any gap over 10 s becomes capped offline income); first run with an empty state; the content finale in the last Generation, where Prestige must not wipe the run; late-game numbers past the `formatNumber` suffix ladder, in both `short` and `sci` notation; muted audio; reduced motion on (`settings.reducedMotion`), which stops every scale, translate, parallax and shake while deliberately keeping opacity crossfades — a fade is not a vestibular trigger where a moving, scaling or shaking element is —; save import and full reset.

## Dev environment

- `npm install` installs from the committed `package-lock.json`. Do not bump React, Vite, TypeScript, Zustand or Vitest as a side effect of an unrelated change.
- `npm run dev` serves the game on `http://localhost:5173`, or the next free port. All state lives in that origin's `localStorage`, so a different port is a different, empty save.
- No environment variables and no secrets are needed to play or develop. Only `npm run sync:aa` reads `AA_API_KEY`, and it accepts it two ways: from a local `.env` (already in `.gitignore`, so it never reaches git) or inline as `AA_API_KEY=... npm run sync:aa`, which wins over the file. Keep the key in `.env` and never commit it, never give it a `VITE_` prefix, and never put it in `index.html`: Vite hands only `VITE_`-prefixed variables to the client bundle, and a key without that prefix stays out of the build.
- Nothing here talks to a production backend, so there is no server-side data to protect while developing. The only real data is the player's save inside their own browser.
- Stop what you started, by the PID you tracked. Other people's `vite` processes are not yours to kill.

## Test data

- There is no database and no fixtures directory. Tests build state with pure helpers: `newGame(T0)` for a fresh run, then `buyAgents` / `buyUpgrade` / `prestige` or literal field spreads (the `rich` helper) to reach late-game token counts. Follow that instead of adding fixture files.
- Realistic volumes are the point. Prices, income and modifiers are asserted across all 8 Generations, and token counts are exercised up to `1e300`. A test that only ever uses a fresh state hides rounding and overflow bugs in `formatNumber`, `maxAffordable` and prestige gains.
- For manual UI checks use a private window or a throwaway port, never the browser profile holding real progress. Export/import codes from `SettingsModal` are the supported way to move a run between origins.

## Verification commands

- Full suite: `npm test` — 218 vitest cases across four files, `src/economy/economy.test.ts`, `src/economy/shadow.test.ts`, `src/layout.test.ts` (the column constants) and `src/store/useGameStore.test.ts` (the actions and their side effects), about half a second. Cheap; run it before finishing any economy, save, content or layout change.
- Typecheck for a scope: `npx tsc -b`. This is the only static gate — there is no ESLint or Prettier in this repo, and adding one is not part of a feature. `npm run build` is `tsc -b && vite build` and is the closest thing to CI, because there is no CI.
- Focused: `npm test -- -t '<test name>'`. Note that `vite.config.ts` includes only `src/**/*.test.ts`, so a `.test.tsx` would silently never run; component behaviour is verified by hand.
- UI verification: `npm run dev`, then check both widths (≥1000 px and <1000 px) and the states you touched — empty first run, no income yet, the offline report at its cap, Prestige confirmation, the content finale, an import error. Screenshots go to the PR, never into the repo. Do not add browser automation or E2E tooling unless asked.

## Pull requests

- Title format: Conventional Commits with a scope, matching the history — `feat(economy): …`, `feat(ui): …`, `fix(format): …`, `fix: …`. Say what the player sees.
- Body: the problem in a sentence or two, how you fixed it, and the alternatives you rejected and why. Close issues with `Closes #N`; the tracker is GitHub Issues in `Narek-Khachikyan/Tycoon`, driven by `gh`. End with the model and harness that did the work.
- Macroscope appends its own summary and review sections to PR bodies between invisible markers. Leave them alone, and never paste them into another document.
- Evidence: before/after screenshots for UI changes, uploaded to the PR. Never commit screenshots, build output, or working notes.
- One concern per PR. If the description says "also", split it.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix the real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when checks are green on the latest commit.
- Never push, publish or open a PR unless the developer explicitly asks.

## How it works

`src/data/generations.ts` holds the manual cut of real models per Generation as *seeds*, each with fallback AA values, and `scripts/sync-aa.mjs` merges the Artificial Analysis *snapshot* into `src/data/aa-snapshot.json`. `buildCatalog` in `src/economy/catalog.ts` merges the two, sorts each Generation's models by Intelligence Index to assign a *Rank*, and derives price and income from an exponential rank ladder times the generation scale (×1000 per Generation), with the real price only bending the cost within ±30% (ADR-0001). Speed is reference-only: AA publishes throughput for a minority of models, so a speed-derived modifier would reward the models someone happened to measure. Every game rule is a pure *transition* `(GameState) => GameState` in `src/economy/engine.ts` — prices, income, Click, offline accrual, Prestige — that returns the same object when nothing changed. `src/store/useGameStore.ts` is the only mutable owner; the 50 ms loop that drives it lives in `src/App.tsx`. That loop calls `advanceTime`, which routes a normal frame to active income and any gap over ten seconds through the capped offline path, then awards Achievements, plays sounds, and serializes the whole state to `localStorage` on every tick. React components read the store and call its actions; they never construct or mutate `GameState` themselves. Domain vocabulary lives in `CONTEXT.md`, architectural decisions in `docs/adr/`.

## Where code lives

- `src/economy/` — all game rules and the save contract, free of React and the DOM. `engine.ts` holds prices, income, Click, offline and Prestige: read it before touching balance. `state.ts` (`GameState`, `newGame`, `SAVE_VERSION`) and `save.ts` (`migrate`, export/import) form the contract — read both before changing any field. `catalog.ts` owns the balance constants and the catalog build; `upgrades.ts`, `perks.ts`, `achievements.ts` and `news.ts` are content tables; `format.ts` formats numbers and durations for display. `crystal.ts` owns Compute-crystal growth and the stock bonus, `events.ts` the event pool and its windows, `glitches.ts` the Glitches, the red-event tables and the Откуп rules — read the last three before touching those mechanics. `economy.test.ts` lives here and is the main safety net.
- `src/store/useGameStore.ts` — the only place that mutates state or causes side effects: each tick's `advanceTime`, its `localStorage` save, offline accrual on load, sounds, toasts, click floaters, plus UI-only slices (active tab, buy amount, sell mode). Anything that needs a side effect goes through an action here. `useGameStore.test.ts` is the safety net for those actions, звуки, тосты и окно события в частности.
- `src/data/` — content inputs, not generated code. `labs.ts` is the Lab roster; adding a Lab means editing the `LabId` union and `LABS` together. `generations.ts` is the manual Generation cut and fallback values. `glossary.ts` holds the «Справка» definitions shown in the Info modal. `aa-snapshot.json` is generated — change it through the sync script or a seed `pin`.
- `src/components/` — presentation only. `Header`, `NewsTicker`, `ClickColumn`, `OfficeColumn`, `ShopColumn`, `Footer`, `Modals` and `Toasts` render and dispatch; `Footer.tsx` holds the Artificial Analysis attribution the build must never lose; `MascotSprite.tsx` renders each Lab's PNG pixel mascot from `public/sprites`. `OfficeColumn` picks one of four Сцен by `floor(generation / 2)` from `public/scenes/`, preloads the next one when that index changes, and keeps every readable label either outside the artwork or on a deliberately darkened HUD band of its own — never as bare text on the painting — so text contrast never depends on what the painting happened to put there (`docs/adr/0002-neutral-ui-base-and-four-office-scenes.md`). `Icon` holds the pixel SVG icons, `Num` wraps a bare number in `pixel-font` (ADR-0003), and `useDialogFocus` traps focus inside the dialogs. Styling is inline `style` objects plus the `pixel-*` classes.
- `src/App.tsx` — the shell one level above the columns: the desktop/mobile switch, the 50 ms tick loop, and the modals and toasts it mounts.
- `src/layout.ts` — the single source of column widths and of the three-column threshold (`THREE_COL_MIN`); `src/layout.test.ts` covers the column constants.
- `src/audio/sound.ts` — the 8-bit Web Audio synth. No audio files, no asset pipeline.
- `src/index.css` — theme variables, `pixel-*` classes, and every animation. Keyframes belong here, not inline in a component.
- `scripts/sync-aa.mjs` — the maintainer-only Node script, and the only code allowed to write the snapshot.
- `docs/adr/` — architectural decisions; read the relevant one before changing balance or the data flow. `CONTEXT.md` — domain vocabulary. `docs/agents/` — tracker, triage-label and domain-doc conventions for the agent skills.
- `node_modules/` — read-only reference for library APIs. Never edit it, never import from it directly.

## Taste

Project preferences, not universal truths.

- Strict TypeScript with `noUnusedLocals` and `noUnusedParameters`; prefer inferred types over annotations; `any` does not appear in this codebase. Content that varies in shape is a discriminated union (`Upgrade`, `PerkEffect`), never a bag of optional flags.
- A transition that changes nothing returns the same `state` object. The store detects that with `next !== state` to skip sounds, toasts and re-renders — keep the identity contract when adding transitions.
- Keep economy math in scaled "units" (`genScale`, `START_TOKENS_UNITS`, `PRESTIGE_DIVISOR_UNITS`) so numbers stay readable, and put a new balance constant beside the ones it relates to instead of in a shared config file.
- Money math lives in `engine.ts`, never in a component. Components read state and call actions.
- UI style is inline `style` with the CSS variables from `index.css`, the `pixel-font` / `pixel-btn` / `pixel-card` classes, mascots drawn as SVG rects and Сцены as committed PNGs. No CSS framework, no component library.
- Player-facing strings are Russian; identifiers and commit messages are English; comments explaining intent are Russian, like the existing ones. A comment says *why* — why `lastTick` moves with income, why a corrupt import is rejected — and never narrates the next line.
- Show numbers only through `formatNumber`, `formatCount` and `formatDuration`, using the player's chosen notation.
- Components add no timer of their own: no `setInterval`, no second persistence path, no idle animation loop. The two exceptions those three prohibitions would otherwise catch are the 15 s news timer in `NewsTicker` and the Токен counter's `requestAnimationFrame` — the latter interpolates between ticks and writes straight to its DOM node, where a React re-render cannot clobber it. A bounded one-shot `setTimeout` — a toast's dwell, a label that reverts after showing itself — is not an interval and does not repeat, so the rule does not cover it; keep it a one-shot, because a repeating `setTimeout` is an interval that only pretends otherwise.
- No backend, auth, analytics or telemetry, and security machinery is not over-indexed for maintainer-only features. The one exception is the AA key, which must never reach the client.
- Tests are grouped into `describe` blocks by area and assert invariants across the whole catalog — "cost strictly increases with Rank", "modifiers stay within ±30%", "an interval is never paid twice" — rather than golden snapshots or rendered markup.
- Internal docs are `CONTEXT.md` and `docs/adr/`. There is no README and no user documentation; do not add either unasked. A merged PR is the implementation record.
- No lint or format tooling exists; match the surrounding style by hand.

---

# Agent skills

## Issue tracker

Issues live in this repo's GitHub Issues (`Narek-Khachikyan/Tycoon`), driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

## Triage labels

The five canonical triage roles, each label string equal to its role name. See `docs/agents/triage-labels.md`.

## Domain docs

Single-context layout: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
