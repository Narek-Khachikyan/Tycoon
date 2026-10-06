# CODING_STANDARDS.md

The standard applied to code you are writing or reviewing in this repo. `AGENTS.md` holds the
invariants that must never be traded; this file holds everything that is otherwise good practice,
and it is the place a rule lives when it is not an invariant. Read it before the first edit of a
session, or when a reviewer pushes back.

The tree is the source of truth for all of it. Where this file and the tree disagree, the tree is
right and this file is stale — fix this file in the same change.

## Understand before changing

- Read the module, its callers and its tests. Find the local convention and the local verification
  command instead of guessing either.
- Separate fact from assumption. Ask when the ambiguity changes the outcome; otherwise assume, and
  say which you assumed.
- Before adding code, know the **blast radius**: who reads this, what crosses the boundary, what
  breaks if it is wrong. A change to `GameState`, to a catalog id or to `SAVE_VERSION` is a change
  to live player data — see invariant 1 in `AGENTS.md`.

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
  into the change. Know when to stop and honour the developer's intent minimally and realistically.
- If one of these fights the task in front of you, say so and get sign-off before breaking it.

## Code quality

- Strict TypeScript, with `noUnusedLocals` and `noUnusedParameters`; `npx tsc -b` is the gate. Prefer
  inferred types. Content that varies in shape is a discriminated union (`Upgrade`, `PerkEffect`),
  never a bag of optional flags.
- One concept, one name, everywhere. If a comment is needed to say *what* a thing is, rename it.
- Comments are for **why** — domain context and constraints a name cannot carry — and they are
  written in Russian, like the ones already in the tree. They describe how a thing is used, move
  with it, and are corrected or deleted the moment they stop being true. They never narrate the
  next line, and they never excuse confusing code.
- **Language by audience**, which is not "identifiers are English": identifiers and type names are
  English; player-facing strings are Russian (invariant 5); a commit *type prefix* is English
  (`feat(ui):`) while its subject names what the player sees, and the history is mostly Russian
  subjects — `fix(ux): не спрашивать про Испытание Забега до первого Престижа`.
- `any` does not belong in shipped code. The handful of casts in tests exist to drive deliberately
  invalid input at `advance`; do not spread that pattern.
- Errors: define them out of existence where you can, handle them where a real decision exists,
  never disguise failure as success. Validate untrusted input at the boundary and trust invariants
  inside.
- Minimize implicit side effects and undocumented call-order. Make illegal states unrepresentable
  where it is cheap.
- Follow the conventions already around you. If they block a correct solution, explain the
  conflict instead of quietly starting a competing style.

## Dependencies

- `npm install` from the committed lockfile. React, Vite, TypeScript, Zustand and Vitest move only
  when the task is about them.
- Before adding anything, check what the project already has and weigh the maintenance cost out
  loud. `tools/sim.ts` runs under `npx tsx`, which is not a declared dependency; the repo carries no
  `@types/node`, and `src/node-fs.d.ts` declares exactly the one call its source-reading tests need.

## Tests

- Assert observable behaviour, public contracts and invariants — not implementation shape. A test
  that only proves a callback is wired mirrors the line it checks.
- The exception, and it is a real one: when the contract *is* the source — the CSS gate under
  `[data-motion="reduced"]`, a cleanup handler, a banned word in a Russian table — read the file as
  text with `readFileSync` and assert on it. `src/index.test.ts` and `src/issues.test.ts` do this.
- Group by area in `describe` blocks and assert over the **whole catalog**, not one hand-picked
  generation. Invariant 3 lives as tests, and a test that shrinks its loop is a deleted invariant.
- No golden snapshots of markup. No arbitrary sleeps: wait on the signal, or poll under a bound so
  the test cannot hang.
- Build state with `newGame(T0)` plus `buyAgents` / `buyUpgrade` / `prestige`, or a literal spread
  (`rich`). There is no fixture directory and none should appear. Late-game volumes are the point:
  a suite that only ever sees a fresh state hides the rounding and overflow bugs in `formatNumber`,
  `maxAffordable` and prestige gains.

## Documentation

- Most code changes need no doc change. The code records the implementation; what you cannot read
  from it is a maintainer's reasoning, which is the only thing worth writing down.
- Internal docs hold decisions and their reasons, cross-component constraints, and traps that are
  hard to find from source. Before adding a paragraph, ask what a maintainer would get wrong
  without it; if the code answers it, leave it out.
- Never enumerate fields or methods, narrate control flow, or maintain a file catalog — that is
  `CODE_MAP.md`'s job, and it goes stale faster than code does.
- When a documented decision changes, rewrite the affected text. Never keep a second account.
- `CONTEXT.md` and `docs/adr/` are the internal docs. `README.md` is for players and stays thin: what
  the game is, how to run it, what Температура means. A merged PR is the implementation record — do
  not commit plans, research notes, screenshots or checklists.
- No new doc files unless the developer asks.
- **Do not cache what the tree already answers.** Counts, file lists and test inventories go stale
  silently and cost a reader more than a `ls` would: the previous `AGENTS.md` claimed "174 tests
  across three files" against a tree that has seventeen.

## Performance

- Judge against representative volumes, not empty states. This game is played at `1e300` Токенов
  in Поколение 8; a fast path on a fresh state proves nothing.
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

## Reporting back

Your final message states, briefly: what changed, how it was verified, what remains unverified,
and anything out of scope you noticed. Communicate blockers and risks the moment they appear, not
in the final paragraph.
