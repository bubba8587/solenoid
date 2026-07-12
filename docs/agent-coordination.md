# Agent Coordination

Shared scratchpad for when several agents work this repo in parallel. Dormant in a solo session — claim nothing, ignore it.

**Protocol.** Check here before starting a task and claim it in one line so two agents don't pick the same thing. Update on claim and on hand-off, not on every edit. Delete an entry once it lands; prior history is in `git log`. Agent 1 is Lead. The durable role split, shared-file policy, and commit/push rules live in the agent's memory; a session may post a short "This session" block here that overrides them where they conflict.

## COMPLETE 2026-07-12 — all four streams integrated to `develop` @ `8c8a298`, green (tsc clean, 2641 tests)

A → B → C → D all merged and pushed; worktrees/branches cleaned up. What LANDED vs what's FLAGGED for the author:
- **A (units):** foundation modules only (`unitValue.ts`/`unitDimExpr.ts`, 41 tests), NOT wired into the live engine; `unitFlow.ts` untouched. Steps 4/5/7 (wiring, FC header keys, socket lattice) left for the author-present arc.
- **B (drill-in):** trueany+Auto-trig+Isolate inside composites DONE. Group/Cleanup/Autofit/Expand, navigator+lasso, and D2 toolbar reroute FLAGGED (DOM-verified/cross-cutting — author-present).
- **C (run modes):** Monte Carlo + uncertainty (`{value,error}`, author-confirmable) + solver params + D-2 sim display + seeds DONE, all composite-scoped. Inside-solve stale dot left (fragile).
- **D (data-quality):** per-cell error scan, Clamp seeding, Tornado diverged-marker, byte-order strings all DONE. One comment-only `engine.rs` change (author verify on desktop build).

Detail in the 2026-07-12 dev-notes digests + `1.2-plan.md`/`backlog.md`.

## (superseded) This session — OVERNIGHT 1.2 BUILD (author asleep, reviews in morning)

Integration branch: **`develop`** (standing order — never `claude/*`). Author runs from mobile + Vercel preview of `develop`; **Rust/`cargo test` cannot run in this container** (no Tauri GTK deps) — Rust changes are written but verified only by the author on Windows. Keep **tsc + vitest green at every commit**; author eyeballs UI on the preview.

Four Opus agents run in **isolated worktrees**, each on its own branch. The lead session integrates each green branch into `develop` serially (tsc + vitest before every push), resolving conflicts. Merge order: **A → C → B → D** (A owns the value-model core; C rebases uncertainty onto it).

## Streams

- **A — FC A4 units by dimensionality** (`docs/v2.0/05-units-format-controller.md`). Owns `valueKinds.ts` unit tags, `frame.ts` per-column units, arithmetic ops, `unitFlow.ts` replace, FC header keys, aggregators, socket lattice. Biggest / most cross-cutting.
- **B — Composite drill-in parity + D2 toolbar reroute** (backlog "First-class composite drill-in", `1.2-plan.md` Tier 2). Group/Cleanup/Autofit/Isolate + navigator + lasso taught the `activeGraph.ts` seam; trueany adoption + Auto-trig inside drill-in; reroute the real top toolbar / mobile bar (D2) to the active subgraph.
- **C — Composite run modes** (`1.2-plan.md` Tier 2, `docs/v2.0/12`). Monte Carlo run mode + uncertainty values **scoped to composites and their internal inputs only** (NOT the whole app), solver params (max-iter/tol/bounds + MC sample+seed), D-2 simulation inner display, run-mode seeds, inside-solve stale dot.
- **D — Data-quality + mechanical** (`1.2-plan.md` Tier 1/3, backlog). Bounded per-cell error scan for Problems panel + model fuzzer; trust-node follow-ups (+Clamp seeded with the finding's safe range; Tornado normalization/diverged marker); string lt/gt ordering decision.

**Explicitly NOT overnight:** Tidy/Cleanup-around-expanded-groups movement fix (needs author), conditional formatting D4, the Excel transpiler, MODE.SNGL tie-break (author call), the border-seam (UNSOLVED).

## Claims

_(agents update below)_
