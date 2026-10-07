# AGENTS.md

Token Clicker: a Russian-language browser idle/clicker — the player hires real AI models for Токены and climbs Поколения via Престиж. React + Vite + Zustand, one page, no backend.

- **Before your first edit or code review:** `CODING_STANDARDS.md` — the invariants in detail, where each rule lives in the code, tests, UI checks, PRs.
- **Touching balance, AA data, Синергия or Поколение perks, the palette or Сцены, the pixel font, the Престиж overlay or Температура?** Its ADR in `docs/adr/` first; contradict one only out loud.
- **Issue tracker, triage labels or domain-doc layout?** `docs/agents/`.

## Never compromise on these

1. **A run survives every change.** `localStorage['ai-tycoon-save']` and `['ai-tycoon-save:corrupt']` each hold a player's only copy; a change to `GameState`, a catalog id or `SAVE_VERSION` ships with its migration and its test.
2. **Idle time is paid once, and capped.** `lastTick` moves with every income mutation; a long gap goes through `applyOffline` and its cap.
3. **Balance stays monotonic in Ранг** so the Флагман stays reachable; `src/economy/economy.test.ts` asserts it over the whole catalog — keep it asserted.
4. **No Artificial Analysis key and no live AA call reach the client**; `src/data/aa-snapshot.json` changes only through `npm run sync:aa`.
5. **The player reads Russian, in the words of `CONTEXT.md`** — read it before naming a concept in text, code, a test or a commit.

## Guardrails

- **Stop at a verified working tree**: `npm test` and `npx tsc -b` green — there is no linter and no CI. The developer commits, pushes and opens the PR; never commit, publish or deploy on your own initiative.
- **Kill only the PID you captured at spawn** — a `pkill -f` or a name match can hit your own process.
- **Keep credentials and personal data out of code, logs, fixtures and messages.**
- **Your browser profile holds a real save.** `npm run dev` takes the next free port and each origin keeps its own save: note the port, and check UI in a private window or on a throwaway port.
- **Report the fog of war**: what changed, how it was verified, what stayed unverified, the blast radius, anything out of scope you noticed. Say a one-way door out loud; flag a rule that fights the task and get sign-off before breaking it.
