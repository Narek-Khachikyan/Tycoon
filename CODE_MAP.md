# CODE_MAP.md

One line per module: what it owns, and the reading order it expects. The map is the first thing to
go stale — when you add, delete or split a module, change this file in the same commit, or the next
agent will not find what you built.

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

The dependency edge that matters: `components/` get every number by calling `economy/` and never
re-implement its arithmetic, and the store is the only module allowed to produce a side effect.

## `src/economy/` — every game rule, pure, free of React and the DOM

| Module | Owns |
| --- | --- |
| `engine.ts` | **Prices, income, Клик, offline accrual, Престиж.** Every transition is `(GameState) => GameState` and returns the same object when nothing changed. Read this before any balance work. |
| `state.ts` | `GameState`, `newGame(now)`, `SAVE_VERSION`. The shape of the contract — read before changing any field. |
| `save.ts` | `migrate`, `MIGRATIONS`, `importSave`/`exportSave`, `CORRUPT_SAVE_KEY` and the quarantine of corrupt bytes. Read alongside `state.ts`. |
| `catalog.ts` | `buildCatalog` → `CATALOG`, the Ранг ladder, the balance constants (`GEN_SCALE`, `MOD_SPREAD`, `genScale`, `PRESTIGE_DIVISOR_UNITS`). ADR-0001 in code form. |
| `upgrades.ts` | Апгрейды and the `Upgrade` union. |
| `perks.ts` | Перки and the `PerkEffect` union; also `START_TOKENS_UNITS`. |
| `achievements.ts` | Достижения. |
| `shadow.ts` | The shadow Достижения, which feed nothing. |
| `events.ts` | The Событие pool, its windows, and the constants `GLOSSARY` and `NewsTicker` quote. |
| `glitches.ts` | Глюки, the red-event tables behind Восстание моделей, and the Откуп rules. |
| `crystal.ts` | Compute-crystal growth and the permanent stock bonus. |
| `thermal.ts` | Температура: the range, the heat curve, overheat. ADR-0006. |
| `milestones.ts` | Вехи — the first half-hour list of goals with rewards, burned by Престиж. |
| `goals.ts` | The goal rails shown next to a Модель (`currentGoals`). |
| `challenges.ts` | Испытание Забега: a voluntary constraint for a whole Забег, for a permanent Доход bonus. |
| `onboarding.ts` | The coach steps for a fresh run. |
| `news.ts` | Новостная лента and Слух tables, keyed off progress. |
| `quips.ts` | Rules for «Переписка»: recording, the cap, and the per-Лаборатория voice from `data/quips.ts`. |
| `format.ts` | `formatNumber`, `formatCount`, `formatDuration` — the only way a number reaches the screen. |
| `economy.test.ts` | The main safety net, grouped by area, and the place invariant 3 is enforced. |

## `src/store/useGameStore.ts`

The only module that mutates state or causes a side effect: each tick's `advanceTime`, the
`localStorage` save (throttled to `SAVE_INTERVAL_MS`, forced on every player action but a Клик,
flushed on page hide), offline accrual on load, sounds, toasts, click floaters — plus UI-only slices such as the
active tab, buy amount and sell mode. Anything that needs a side effect goes through an action here.
`useGameStore.test.ts` is the safety net for those actions.

## `src/data/` — content tables, not generated code

| File | Owns |
| --- | --- |
| `labs.ts` | The Лаборатория roster. Adding one means editing the `LabId` union and `LABS` together. |
| `generations.ts` | The manual cut of real models per Поколение as *seeds*, with fallback AA values and `pin` overrides. |
| `aa-snapshot.json` | **Generated** by `npm run sync:aa` — invariant 4. |
| `glossary.ts` | The «Справка» definitions shown in the info modal; its timings are asserted against the code constants. |
| `prompts.ts` | The canonical Переписка request→reply pairs, including the first eight the store shipped with. |
| `quips.ts` | Talking-model lines, per Лаборатория, no mechanics attached. |
| `thermalCopy.ts` | Player-facing Температура text and risk copy, computed from `economy/thermal.ts` so the two cannot disagree. |

## `src/components/` — presentation only

- **Columns:** `ClickColumn` (the Клик, the Токен counter, the dial), `OfficeColumn` (Сцены and
  mascots), `ShopColumn` (Модели, Апгрейды, Перки, Справка AA).
- **Chrome:** `Header`, `NewsTicker`, `Toasts`, `Footer` — and `Footer.tsx` holds the Artificial
  Analysis attribution the build must never lose.
- **Modals:** `Modals.tsx` holds `SettingsModal`, the export/import UI and the rest; it and
  `QuipBubble` trap focus through `useDialogFocus.ts`.
- **Overlays:** `PrestigeOverlay`, `OnboardingCoach`, `GoldenToken`, `QuipBubble`, `GoalsBanner`,
  `MilestoneStrip`.
- **Scene and sprite drawing:** `MascotSprite`, `WorkstationSprite`, `EventSprites`, `SceneEvents`.
- **Температура:** `ThermalSection`, `ThermalDial`, `ThermalSparks`.
- **Primitives:** `Icon` (pixel SVG), `Num` (a bare number in `pixel-font`, ADR-0003).

Styling is inline `style` objects with the CSS variables and `pixel-*` classes from `index.css`.
`OfficeColumn` picks one of four Сцены by `floor(generation / 2)`, preloads its neighbours when the
index changes, and keeps every readable label either off the artwork or on a darkened HUD band of
its own, so text contrast never depends on what the painting happened to put there (ADR-0002).

## The rest of `src/`

- `App.tsx` — the shell above the columns: the desktop/mobile switch, the 50 ms tick, the modals and
  toasts it mounts. `main.tsx` is the entry point.
- `layout.ts` — the single source of every layout number, including `THREE_COL_MIN`, the
  desktop/mobile switch. `layout.test.ts` covers the constants.
- `render/sceneGrade.ts` — grades the four Сцены into one frame. Pure, tested by
  `sceneGrade.test.ts`.
- `audio/` — `sound.ts` (context, buses, voices), `sfx.ts` (one-shot effects), `music.ts` (the
  procedural loop and its scheduler), `thermal.ts` (heat and hallucination audio). Synthesized, no
  audio files, no asset pipeline.
- `index.css` — theme variables, `pixel-*` classes, and every animation. Keyframes live here.
- `index.test.ts` — asserts CSS and cleanup wiring by reading sources as text.
- `issues.test.ts` — one `describe` per fixed issue, each pinning its regression. Also the enforced
  banned-word list for `glossary.ts`; `economy/quips.test.ts` holds the same list for the quip table.
- `node-fs.d.ts` — the single `readFileSync` declaration the source-reading tests need; the repo
  carries no `@types/node`.

## Outside `src/`

- `scripts/sync-aa.mjs` — the maintainer-only Artificial Analysis fetch. The only code allowed to
  write `aa-snapshot.json`; it merges into the existing file, writes atomically, and keeps only the
  slugs the seeds reference.
- `tools/sim.ts` — the balance simulator. Runs the real engine with no renderer and prints when
  each milestone lands: `npx tsx tools/sim.ts`, `--prestige`, `--gen 90`. Read this before changing
  the ladder; the comment at the top says why it exists.
- `public/scenes/scene-1..4.png`, `public/sprites/` — committed art. `public/sprites/raw/` is
  gitignored source art.
- `docs/adr/` — the decisions, reached by topic: AA snapshot and Ранг balance; the neutral UI base
  and four Сцены; pixel font for numbers only; pair Синергия and Поколение perks; the Престиж
  overlay; Температура as a live parameter; the unified palette with eight Поколение accents.
- `docs/vision.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/research/` — working notes from
  the synthesis of the two overhaul branches. History, not instructions.
- `docs/agents/` — how the engineering skills consume the tracker, the triage labels and the domain
  docs.
