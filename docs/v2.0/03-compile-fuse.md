# Bundle 03 — Compile/fuse execution (Bet 1)

**Source:** `future-directions.md` Bet 1. **Verdict:** IN, with one hard condition:
**per-node previews stay** (non-negotiable — every verb card keeps its head-N preview
exactly as today; under fusion a preview is "collect head-N of the plan at this node's
point"). **Depends on:** nothing. **Gates:** bundle 06 (sketch mode + calc-mode
integration ride the fused engine), bundle 09's what-if run modes (running a graph
thousands of times is only reasonable once it's one compiled function).

## What exists today

**Relational side:** each verb (Filter, Join, Group By…) sends its own operation to the
Polars engine independently and pulls back its own preview — a three-node chain means
three engine round-trips. The lazy-handle-on-cable work (2026-06-30) already got most of
the way here: cables carry a lazy `FrameRef` and a verb card is a head-N preview via
`collectPreview`. What's missing is that each verb still **materializes eagerly** in Rust
instead of composing into one plan.

**Scalar side:** a chain of scalar nodes is still walked one node at a time. A formula
*compiler* already exists (`compileFormula` in `excelFormula.ts:272`) that turns a
formula into one fast function — it's built but not used in production execution.

## The change

Treat a connected run of nodes as one thing to hand off whole, not a sequence to execute
step by step.

- **Relational:** let a Filter→Join→Group By chain build up a single Polars `LazyFrame`
  plan and collect it **once**, at the point a result is actually needed (a preview
  request or a materialization boundary, per the existing `FrameBackend` seam in
  `frameBackend.ts`). Polars' own query optimizer then skips columns/rows it doesn't need
  — something impossible while each verb collects eagerly.
- **Scalar:** compile a connected region of scalar nodes into one function via the
  existing `compileFormula`, instead of one `data()` call per node.

## Build order

1. **Relational fusion.** Change the desktop engine's per-verb call to *accumulate* into
   a `LazyFrame` plan instead of collecting immediately (`src-tauri/src/engine.rs`).
   Collect only at: (a) a preview request, (b) a non-verb consumer via `coerceInputs`
   (the existing materialization-boundary rule), or (c) explicit eager ops that already
   must materialize (Pivot, Frame Lookup, Split Column, Add Index, Cube ops — unchanged).
2. Verify the preview contract survives: every verb card's head-N preview must still
   render correctly when it's mid-plan, not just at the final collect. Add this as an
   explicit assertion in the perf/parity tests — regressing this is the one thing that
   would have killed the bet outright.
3. Measure: a 3-verb chain should show engine trips drop from ~3 to ~1
   (`perfProbe.ts`/`window.__solenoidStats()` already instruments this).
4. **Scalar fusion.** Route a connected region of pure scalar nodes through
   `compileFormula` instead of per-node `data()` calls. Scope to the same subset
   Expression already supports (scalars + 1-D lists, broadcast — the capped Expression
   scope from CLAUDE.md applies; don't widen the compiler's ambitions beyond what
   Expression itself is capped to).
5. JS oracle stays eager throughout (per the VERDICT) — parity tests pin that both
   backends still agree on results, only the desktop engine's *execution strategy*
   changes.
6. Fold in `v1.1-plan.md` WS-E's **lazy-plan fusion** item here — it's the same work,
   just named differently in that doc; don't build it twice.

## Exit criteria

A multi-verb desktop chain collects once, not once per verb, with measured engine-trip
reduction; every verb's preview still renders correctly mid-plan (the non-negotiable
invariant); a connected scalar region compiles through `compileFormula` instead of
per-node walks; parity tests confirm the JS oracle and fused Rust engine still agree.
