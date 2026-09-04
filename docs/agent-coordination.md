# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Session 2026-09-04c (author remote, on a phone).** A1 = Han Solo (Lead) = `solenoid-9e`. Friends: Chewie = `solenoid-36`, Lando = `solenoid-87`. All three run a 20-min cron wake. Message directly via SendMessage; this board is the durable record only. Worktrees: Chewie works in `../solenoid-chewie` (branch `chewie`), Lando in `../solenoid-lando` (branch `lando`), both cut from develop; each commits freely to its own branch and messages Han a hash when green (tsc + vitest); Han merges into `develop` and pushes only when the author's eyeball is needed. Only Han touches the main checkout and this board.

(The repo-local `/continue` command was deleted 2026-09-01 by the author — it duplicated a generic. Board sync is by reading this file.)

## Claims

- Chewie — B4 shared column picker (backlog § Tables). B2.2 chips (f4b88d37) merged. Display expand, finance review, A3 hover peek, FC inherit review (6960fc0b) LANDED, merged.
- Lando — C1 widget nodes in order (Geocode + Weather first; backlog § Sources). C2 (b5725d52) merged. E2 LANDED (8c9c6f11), merged. FC inherit pick + F5 findings LANDED, merged.
- Han — lead; merges; walking the 1.4 cut with the author one item per turn (Tracks A–C settled; D2 in, D4 incremental, D7 split; at D8).

**Awaiting the author's eyeball:** three finance cards (Finance > Other / Bonds), the FC `—` inherit pick, the Display corner expand on frames/tables/lists, the socket hover peek (A3), the mobile delete button inside a drill-in (E2), the Record List view / cardsize / #title / clamp (B1) + the four new record-cards seed exhibits, the Quarter `start` / Age / Nth Weekday presets (C5), the text-cell suggestions in the table popup (B2.1), the popup's frozen-header toggle + record arrow keys (B3), the Chip style on the FC + popup column row (B2.2), the foreign-document network gate + Allow notice (C2); from earlier: the anydata hollow-square glyph + Socket Legend row; the catalog description sweep (8d5c8f74); Merge Plots figure + expand button; Vite 8 (desktop `tauri build` ride-along result per A3's last message).
