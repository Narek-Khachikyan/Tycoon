# CODING_STANDARDS.md

The standard applied to code you are writing or reviewing in this repo. `AGENTS.md` holds the
invariants that must never be traded; this file holds everything that is otherwise good practice,
and it is the place a rule lives when it is not an invariant.

The tree is the source of truth for all of it. Where this file and the tree disagree, the tree is
right and this file is stale — fix this file in the same change.

## Understand before changing

- Ask when the ambiguity changes the outcome; otherwise assume, and say which you assumed.

## Design

- **Smallest correct model.** Complexity is the knowledge someone needs to change the system
  safely, not the line count. It arrives one reasonable special case at a time and is far easier to
  add than to remove — so do not preserve it just because it already exists, and do not pay
  **sunk cost** into a design that predates you.
- **Design it twice** when the decision is consequential: two plausible approaches, the trade-off,
  a short note. Planning is not a separate project.
- **Deep modules, small interfaces.** Hide complexity behind a surface a caller understands without
  reading the inside. Encapsulate what is likely to change. Keep a wrapper that carries a real
  contract; delete one that only adds a hop.
- **Boundaries hold the mess.** External quirks live in adapters and parsers. Separate domain logic
  from transport, storage and presentation where that reduces complexity, not to satisfy a diagram.
- **Abstract knowledge, not similar-looking code.** One source of truth per rule and contract.
  Merge fragments that share a *reason to change*, never fragments that merely look alike; an
  abstraction that accumulates flags and special cases is asking to be split.
- **Reversible wins ties.** Say out loud what a migration, a compatibility break or a new
  dependency costs before you take it.
- **Good enough.** Fix rot you touch or flag it in your final message; do not fold unrelated work
  into the change.

## Code quality

- Prefer inferred types. Content that varies in shape is a discriminated union (`Upgrade`, `PerkEffect`),
  never a bag of optional flags.
- One concept, one name, everywhere. If a comment is needed to say *what* a thing is, rename it.
- Comments are for **why** — domain context and constraints a name cannot carry — and they are
  written in Russian, like the ones already in the tree. They describe how a thing is used, move
  with it, and are corrected or deleted the moment they stop being true.
- **Language by audience**, which is not "identifiers are English": identifiers and type names are
  English; player-facing strings are Russian (invariant 5); a commit *type prefix* is English
  (`feat(ui):`) while its subject names what the player sees, and the history is mostly Russian
  subjects — `fix(ux): не спрашивать про Испытание Забега до первого Престижа`.
- Shipped code is typed without `any`. The handful of `as any` casts in tests exist only to feed
  deliberately invalid input or to reach through a `Proxy` target.
- Errors: define them out of existence where you can, handle them where a real decision exists,
  never disguise failure as success. Validate untrusted input at the boundary and trust invariants
  inside.
- Minimize implicit side effects and undocumented call-order. Make illegal states unrepresentable
  where it is cheap.

## Dependencies

- `npm install` from the committed lockfile. React, Vite, TypeScript, Zustand and Vitest move only
  when the task is about them.
- Before adding anything, check what the project already has and weigh the maintenance cost out
  loud.

## Tests

- Name every test `*.test.ts`: `vite.config.ts` includes only `src/**/*.test.ts`, so a `.test.tsx`
  is skipped silently. Run one case with `npm test -- -t '<name>'`.
- A bug fix ships with a test that goes **red** on the bug. `src/issues.test.ts` collects such
  regressions, one `describe('Issue #N: …')` per fixed issue.
- Assert observable behaviour, public contracts and invariants — not implementation shape. A test
  that only proves a callback is wired mirrors the line it checks.
- The exception, and it is a real one: when the contract *is* the source — the CSS gate under
  `[data-motion="reduced"]`, a cleanup handler — read the file as text with `readFileSync` and
  assert on it. `src/index.test.ts` and `src/issues.test.ts` do this. The repo carries no
  `@types/node`: `src/node-fs.d.ts` declares exactly the one call those tests need, so extend it
  rather than adding the package.
- Group by area in `describe` blocks and assert over the **whole catalog**, not one hand-picked
  generation. Invariant 3 lives as tests, and a test that shrinks its loop is a deleted invariant.
- Assert on values, not golden snapshots of markup. An async test waits on the real signal, or
  polls under a bound so it cannot hang.
- Build state with `newGame(T0)` plus `buyAgents` / `buyUpgrade` / `prestige`, or a literal spread
  (`rich`). There is no fixture directory and none should appear. Late-game volumes are the point:
  a suite that only ever sees a fresh state hides the rounding and overflow bugs in `formatNumber`,
  `maxAffordable` and prestige gains.

## Checking the UI by hand

Component behaviour is checked by hand, not by browser automation.

- Every layout band from `src/layout.ts`: three columns at or above `THREE_COL_MIN`, one tab at a
  time below it, and the compressed header at or below `NARROW_MAX`, where the footer's AA
  attribution must still show.
- The states you touched: empty first run, no income yet, the offline report at its cap, Престиж
  confirmation, the content finale, an import error.
- To reach a late state on a throwaway origin, export a run as a code from «Настройки» and import it
  there.

## Documentation

- Most code changes need no doc change. The code records the implementation; what you cannot read
  from it is a maintainer's reasoning, which is the only thing worth writing down.
- Internal docs hold decisions and their reasons, cross-component constraints, and traps that are
  hard to find from source. Before adding a paragraph, ask what a maintainer would get wrong
  without it; if the code answers it, leave it out.
- **Leave to the tree what the tree already answers.** Fields, methods, control flow, counts, file
  lists and test inventories go stale silently and cost a reader more than a `ls` would.
  `CODE_MAP.md` is an ownership map for the same reason: it records boundaries and traps, not files.
- When a documented decision changes, rewrite the affected text in place so one account remains.
- `CONTEXT.md` and `docs/adr/` are the internal docs. `README.md` is for players and stays thin: what
  the game is, how to run it, what Температура means. A merged PR is the implementation record — do
  not commit plans, research notes, screenshots or checklists.
- No new doc files unless the developer asks.

## Performance

- Judge against representative volumes, not empty states: all eight Поколения, and Токены up to
  the `1e300` the tests already drive. A fast path on a fresh state proves nothing.
- Critical paths here: `advanceTime` every 50 ms, per-render income in the shop, serialization on
  save, and audio scheduling.
- Justify a non-trivial optimization with a measurement. If speed needs a more complex design,
  record the measured problem and the trade-off.

## Pull requests

Reached only when the developer asks for one. The developer pushes.

- **Title:** Conventional Commits with a scope, matching the history — `feat(economy):`,
  `feat(ui):`, `fix(format):`, `fix:`. Say what the player sees.
- **Body:** the problem in a sentence or two, the fix, and the alternatives you rejected and why.
  `Closes #N` for GitHub Issues (`Narek-Khachikyan/token-clicker`, driven by `gh`). Macroscope
  appends its own summary and review sections between invisible markers — leave them alone and
  never paste them into another document.
- **One concern per PR.** If the description says "also", split it.
- **Evidence:** before/after screenshots for UI changes, uploaded to the PR, never committed.
- **Babysitting:** poll checks and comments newer than the last push, verify each finding against
  the source, fix the real ones, dismiss false positives in writing. Stay quiet when nothing is new.
  Stop when checks are green on the latest commit.
