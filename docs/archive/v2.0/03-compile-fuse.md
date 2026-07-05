# Bundle 03 — Compile/fuse execution (Bet 1)

**Source:** `future-directions.md` Bet 1. **Verdict:** IN, with one hard condition:
**per-node previews stay** (non-negotiable). **Depends on:** nothing. **Gates:** bundle
06 (sketch mode rides the fused engine), bundle 09's what-if run modes (running a graph
thousands of times only makes sense once it's one compiled function).

## What exists today — exact current dispatch

**Every verb in `src-tauri/src/engine.rs` is a plain Rust fn taking `&SolFrame` (a
wrapper around an EAGER Polars `DataFrame`, lines 96-99), returning a new `SolFrame`.**
A handle store maps id strings → `SolFrame` (lines 128-141). **Every verb builds a
one-op `LazyFrame` and immediately `.collect()`s it** — this is the fusion target:
- `verb_filter` (632-711): `frame.df.clone().lazy().filter(expr)` → `collect_lazy` at
  line 706.
- `verb_select` (482-492): same pattern, `collect_lazy` at line 489.
- `verb_join` (891+): `left.df.clone().lazy().join(right.df.clone().lazy(), ...)` →
  `collect_lazy` at line 910.
- **`verb_group_by` (781-890) is NOT even Polars-lazy** — it's hand-rolled HashMap
  bucketing (lines 792-830), fully eager Rust, no `.lazy()` at all. **Fusing group_by
  into a shared lazy plan requires rewriting it onto Polars' native
  `.group_by()/.agg()`** — this is the one verb that needs a real rewrite, not just
  "stop collecting early."

Dispatch: `engine_apply` (1103-1121) pattern-matches `WireOp` (386-418) to the `verb_*`
fn; `engine_join` (1124-1142) and `engine_append` (1145-1147) are separate IPC commands.
Each call clones the frame out of a mutex (`with_frame`, 158-170), collects, registers a
NEW handle (`register()`, 151-156). No `WireOp::Pivot` variant exists — Pivot is
deliberately eager per the comment at lines 419-422 (richer spec than the engine op
set) — **leave Pivot/Frame-Lookup/Split-Column/Add-Index/Cube ops eager, unchanged.**

JS call sites: `PolarsBackend.apply/join/append` — `src/graph/frameBackend.ts:236-246`,
using `ipcInvoke("engine_apply"|"engine_join"|"engine_append", ...)`.

**The lazy-handle-on-cable work (2026-06-30) already exists** and is the foundation to
build on:
- `FrameBackend` interface: `frameBackend.ts:117-142` (`source/apply/join/append/
  preview/collect/column/drop`).
- `_sourceCache` (line 339): `WeakMap<FrameValue, Promise<FrameHandle>>` keyed by
  object IDENTITY, dedupes uploading the same source across fan-out consumers (comment
  330-338); populated/read in `inputHandle` (349-361); GC-evicted via
  `FinalizationRegistry` (`_dropReg`, 340-343).
- `FrameRef`: `frameBackend.ts:31` (`{ readonly __frameRef: FrameHandle }`), `isFrameRef`
  (32), `wrapRef` (35), `FrameInput = FrameValue | FrameRef` (39).
- Verb runners producing refs (never collecting): `runFrameUnary` (368-380),
  `runFrameJoin` (383-395), `runFrameAppend` (398-410) — call `be.apply/join/append`,
  wrap the resulting handle.
- `collectPreview` (86-96): head-N via `frameBackend().preview()`, returns full
  `FrameValue` if small, else a head-N `FrameValue` tagged `__totalRows` (frame.ts:55,
  set at `frameBackend.ts:78`) + `__ref` (frame.ts:56-59, consumed by
  `FrameChip.tsx:64-87` to fetch the full frame on demand).
- **Materialization boundary — `src/graph/coerceInputs.ts` (219 lines), not a single
  function:** `LAZY_FRAME_NODES` set (lines 16-23) names the verb node classes allowed
  to receive a raw `FrameRef` (Distinct/Head/SortFrame/FilterFrame/Join/SelectColumns/
  DropColumns/GroupByFrame/Unpivot/Append/Rename/GetColumn). `wrapNodeData` (142-204) is
  the actual boundary: if a node's class isn't in `LAZY_FRAME_NODES` (a `lazy` flag,
  line 146) and any input contains a `FrameRef` (184-188), it awaits `readFrame(v)`
  (190-199) before calling the node's real `data()`. Wired via `installInputCoercion`
  (212-219), called from `Canvas.tsx:89`.

**`compileFormula` is confirmed dead code today** — `src/graph/excelFormula.ts:272`, only
referenced from `excelFormula.test.ts` (lines 4,50,52,93,99,100,104,105,109,115); no
production call site. Comments at `excelFormula.ts:478,594,608` and
`nodes/tableLambda.ts:29` call it "dormant."

**`perfProbe.ts`** (100 lines) — `recordNode(id,type,ms)` (39-46), `recordIpc(command,ms,
bytes)` (48-55) into `nodeStats`/`ipcStats` Maps (27-28). `window.__solenoidStats()` →
`dumpStats()` (73-86). `ipcSnapshot()` (58-60) gives per-pass IPC-call delta —
**use this to measure the "engine trips drop from ~3 to ~1" claim directly.**
`beginPass()`/`passTopNodes(n)` (63-70) for per-pass slowest-node lists. Gated on
`window.__solenoidPerf = true` (`perfEnabled()`, 19-21).

## Build order

1. **Rewrite `verb_group_by`** (`engine.rs:781-890`) onto Polars' native
   `.group_by()/.agg()` behind `.lazy()` — this is the prerequisite fusion work; every
   other verb already routes through `.lazy()...collect_lazy()`.
2. **Accumulate instead of collect**: change each `verb_*` fn to build onto an existing
   `LazyFrame` plan (threading a plan handle instead of a `SolFrame`) and defer
   `.collect()` to: (a) a preview request, (b) `coerceInputs.ts`'s materialization
   boundary (a non-`LAZY_FRAME_NODES` consumer), or (c) an already-eager op (Pivot et al,
   unchanged).
3. **Non-negotiable check:** verify every verb card's head-N preview still renders
   correctly mid-plan — add this as an explicit assertion, not just an eyeball check,
   since regressing it is the one thing that kills the bet outright.
4. Measure via `perfProbe.ts`'s `ipcSnapshot()`: a 3-verb chain should show IPC calls
   drop from ~3 to ~1.
5. **Scalar fusion**: route a connected region of pure scalar nodes through
   `compileFormula` (`excelFormula.ts:272`, currently dead) instead of per-node `data()`
   calls. Scope to the same subset Expression supports (scalars + 1-D lists,
   broadcast) — don't widen the compiler's ambitions past what Expression itself is
   capped to (see `nodes/expression.ts:133-146`'s `#SHAPE!` cap, detailed in bundle 09).
6. JS oracle (`frameVerbs.ts`) stays fully eager — parity tests (`frameBackend.test.ts`,
   `polarsBackend.test.ts`) confirm results still agree; only the Rust execution
   *strategy* changes.
7. This closes `v1.1-plan.md` WS-E's "lazy-plan fusion" item — don't build it twice.

## Exit criteria

`verb_group_by` runs through Polars' native lazy group-by; a multi-verb desktop chain
collects once via `perfProbe.ts`'s measured IPC-call count, not once per verb; every
verb's preview still renders correctly mid-plan; a connected scalar region compiles
through `compileFormula` (now live, not dead code); parity tests confirm the JS oracle
and fused Rust engine still agree.
