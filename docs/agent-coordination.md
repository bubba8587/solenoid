# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Agents message each other directly for live coordination; this board is only the durable claim list (one line per claim, delete on land) so a late-joining or restarted agent knows what's taken. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory.

**Session 2026-09-04c (author remote, on a phone).** A1 = Han Solo (Lead) = `solenoid-9e`. Friends: Chewie = `solenoid-36`, Lando = (joins next; self-identify here). All three run a 20-min cron wake. Message directly via SendMessage; this board is the durable record only. Commit freely on `develop` by pathspec (`git status` first; `git commit -m msg -- paths`); NEVER push — Han pushes only when the author's eyeball is needed. Run `tsc` + vitest before every commit. One code file has one editor at a time; docs edit freely.

(The repo-local `/continue` command was deleted 2026-09-01 by the author — it duplicated a generic. Board sync is by reading this file.)

## Claims

- Chewie — **Expand pop-up on every Display frame / table / list** (backlog § Display). Spec: the backlog line; `ChartExpandButton` + `chartPopupCoverage.test.ts` are the pattern; opens the same `TablePopup` the chip opens. Read DESIGN.md + subsystem-invariants § React Flow surface contract first.
- Lando — **FC style dropdown blank = inherit** (backlog § Formatting & units). Spec: the backlog line; the frame column row's `—` (212770a0) is the exemplar; `formatModel`/`format-model.md` + the FC card. 
- Han — lead; backward review of the friends' commits; the author's eyeball queue below, one item per turn.

**Awaiting the author's eyeball from this session:** Set card (8d77cf7f: 8-op merge, result-socket-driven accent) — the three finance merges (discount securities, ACCRINT/ACCRINTM, BondPrice/OddCoupon; specs in git 68bf5679) stay HELD on that verdict; the anydata hollow-square glyph + Socket Legend row; the catalog description sweep (8d5c8f74); Merge Plots figure + expand button; Vite 8 (desktop `tauri build` ride-along result per A3's last message).
