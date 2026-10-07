# AGENTS.md

Token Clicker: a browser idle/clicker where the player hires real AI models that generate Токены and climbs through Поколения via Престиж. React + Vite + Zustand, one page, no backend. `README.md` is the player's; this file is the router for you — invariants, guardrails, the verify gate, and pointers to the rest.

## Never compromise on these

1. **A player's run survives every change.** The only copy of a run is `localStorage['ai-tycoon-save']`, hand-serialized; `localStorage['ai-tycoon-save:corrupt']` holds quarantined bytes after a corrupt load, so both keys are someone's progress. `migrate` silently drops model, upgrade and perk ids that have left the catalog; `importSave` rejects a whole export over one bad `generation`; a `SAVE_VERSION` bump with no matching `MIGRATIONS` entry rewrites old saves. Nothing in this repo can recover a lost run, so a change to `GameState`, to catalog ids, or to `SAVE_VERSION` ships with its migration and its test in the same commit.
2. **Idle time is paid once, and capped.** `lastTick` moves together with every income mutation, and any gap past `OFFLINE_THRESHOLD_SEC` goes through `applyOffline` and its cap. Break either and hours of income are silently created or destroyed — a background tab or a sleeping laptop hands `advanceTime` a huge `dt`.
3. **Balance order stays monotonic.** Within a Поколение, cost and income strictly increase with Ранг, and every Модель's payback (cost ÷ income) stays within 3× of every other in its Поколение — that bound is what keeps the Флагман, the only key to Престиж, reachable. Each Поколение scales ×1000; the real price bends cost within ±30% only, and speed is reference-only. `src/economy/economy.test.ts` asserts every one of these across the whole catalog; keep them asserted.
4. **No Artificial Analysis key and no live AA call ever reach the client.** Metrics ship as a committed snapshot; `npm run sync:aa` is a maintainer-only tool that takes the key inline or from a gitignored `.env`. Vite hands only `VITE_`-prefixed variables to the bundle, so the key stays unprefixed and out of `index.html`. The visible attribution stays in `Footer.tsx` and the shop's «Справка AA»; monetization would additionally require a commercial AA license. Rewrite `src/data/aa-snapshot.json` only through the sync script; to override a number, `pin` it on the seed instead of hand-editing the JSON.
5. **The player reads Russian, in the words of `CONTEXT.md`.** Токен, Клик, Доход, Модель, Агент, Лаборатория, Поколение, Забег, Престиж, Compute, Перк, Справка AA. The avoided synonyms — монета, тап, здание, юнит, сессия — stay out of player-facing text, identifiers and commit messages; `src/issues.test.ts` enforces them over the glossary, `src/economy/quips.test.ts` over the quip table.

## Keep the human in the loop

- **You stop at a verified working tree.** The developer commits, pushes and opens the PR. Never commit, publish or deploy on your own initiative.
- **Kill only what you spawned.** Stop a server by the PID you captured at spawn. Never `pkill -f` or kill a PID found by matching a name or path; your own process can match.
- **Keep credentials and personal data out of code, logs, fixtures and messages.** Invariant 4 is the sharp case, not the only one.
- **Your browser profile holds a real save.** `npm run dev` is the only server; Vite takes the next free port and every origin keeps its own save, so note the port you got and check UI in a private window or on a throwaway port.
- **One game clock, one persistence path.** `App.tsx`'s 50 ms tick drives `advanceTime`, and every `localStorage` write goes through the store's throttled save. New code hangs off that tick through the store; a bounded one-shot `setTimeout` (a toast's dwell) is the only other timer it starts.
- **Report the fog of war.** Raise blockers and risks the moment they appear. The final message states what changed, how it was verified, what stayed unverified — an expectation is not a result — and anything out of scope you noticed.
- A rule that fights the task in front of you gets flagged out loud, with sign-off, before you break it.

## Verify

- `npm test` before you finish any economy, save, content or layout change. `npx tsc -b` is the only static gate: there is no linter, no formatter and no CI.
- Know the **blast radius** before calling it done: who reads what you changed, which UI states it reaches, and whether it crosses the save contract. A one-way door is a bug unless the irreversibility is deliberate and said out loud.

## Pointers

Reach for these before you decide, not after.

- **Opening or adding a module?** `CODE_MAP.md` — who owns what, the reading order, and the rules that attach to a place (money math, transitions, number formatting, layout).
- **Writing or reviewing code, a test, a hand UI check, or a PR?** `CODING_STANDARDS.md`.
- **Touching balance, the AA data flow, Синергия or Поколение perks, the palette and Сцены, the pixel font, the Престиж overlay, or Температура?** The matching ADR in `docs/adr/` first; if your change contradicts one, say so out loud instead of overriding it.
- **Naming a domain concept** — in code, a commit, a test, an issue? `CONTEXT.md`, including seed and snapshot. A concept that is not there is either invented language or a real gap; say which.
- **Issue tracker, triage labels, domain-doc conventions?** `docs/agents/`.
