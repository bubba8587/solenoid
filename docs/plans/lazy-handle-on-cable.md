# Plan: Lazy handle on cable (retire the eager `collect()` residue)

Backlog line: "B9 Lazy-handle-on-cable (retire the `collect()` bridge) — last, biggest."
Investigated 2026-08-25; line anchors verified that day.

**Read first:** `CLAUDE.md`, `docs/mental-model.md`, `docs/glossary.md` (FrameRef),
`docs/architecture.md` § FrameBackend (~line 158), the header comments of
`src/graph/frameBackend.ts` (lines 25–35 memo rule, 552–556 ownership rule) and
`src/graph/polarsBackend.test.ts:191-268` (the fusion contract).

## What the item actually is

Cables ALREADY carry lazy `FrameRef`s with a pending-op queue (`__plan`) that fuses into one
`engine_apply_many` per flush. The remaining eagerness is a short list, and THIS plan is that
list. Cost ordering, largest first:

1. **Per-node card preview flushes per node.** `src/graph/nodes/frame.ts:71` `emitFrame` →
   `collectPreview(out)` for every verb node on every pass, so a 4-verb chain flushes 4
   growing prefixes. The preview itself is declared non-negotiable
   (`polarsBackend.test.ts:194-195`); the FLUSH on the hot path is what goes.
2. **Coercion bridge.** `src/graph/coerceInputs.ts:277-300` (`readFrame` at `:292`): a node
   not in `LAZY_FRAME_NODES` (`:17-24`) that receives a ref gets the whole frame hauled to JS.
3. **Stale lazy allowlist (live bug).** `BindColumnsNode` (`frame.ts:912`), `FillBlanksNode`
   (`:1057`), `ReplaceValuesNode` (`:1089`), `WindowNode` (`:2302`) all emit refs but are NOT in
   `LAZY_FRAME_NODES`, so they collect their INPUT and re-source mid-chain. All four have Rust
   `WireOp` mirrors.
4. **Nine passthrough `readFrame(f)` no-op emits** (`frame.ts:339, 451, 576, 630, 797, 904,
   956, 987, 2340`) — an OWNERSHIP workaround ("must emit a value, not a borrowed ref"), not a
   data need.
5. **Consumers that collect more than they read:** `TableInfoNode` (`matrix.ts:774`, needs
   rowCount + schema), `WriteFileNode` (`sink.ts:73-105`, needs the frame only at Run),
   `SlicerNode` (`control.ts:274-300`, needs one column + a filter op; also truncates every
   chain it sits in), `SumIfsNode` (`list.ts:1034`, needs named columns).

Permanently eager, do NOT touch: Pivot (no Rust `WireOp`), cube Nest/Unnest, the JS-numeric
nodes (Describe/Corr/KMeans/PCA/Logistic), charts, Build Frame / Add Column / Get Row /
XLookup. `JsFrameBackend` (web) has a free `collect`, so every step here must be a NO-OP on
web semantics — that is what makes it testable headlessly.

## Steps (commit after each; `tsc` + the named tests green)

**Phase 0 — measure before touching**
1. In `polarsBackend.test.ts`, add a characterizing test that drives a Filter→Sort→Head chain
   through REAL node `data()` calls (not raw runners; see `pivotSeed.test.ts:1-20` for the
   editor+engine harness) and asserts the count of `engine_apply_many` + `engine_collect` IPCs.
   Record the number in the test name's expectation; this is what the plan moves.
2. `coerceInputs.test.ts` has zero `FrameRef` coverage. Add: lazy-set node receives the raw
   ref; non-lazy node receives a collected `FrameValue`; a ref nested in an array is collected
   (`coerceInputs.ts:284`).

**Phase 1 — the free win**
3. Add `"BindColumnsNode"`, `"FillBlanksNode"`, `"ReplaceValuesNode"`, `"WindowNode"` to
   `LAZY_FRAME_NODES`. Re-run step 1's counter on a Filter→FillBlanks→Sort chain: must fuse.
4. Guard test (same file as step 2): every class in `src/graph/nodes/frame.ts` that calls a
   `runFrame*` runner is in `LAZY_FRAME_NODES` (grep the source text; a static test is fine).

**Phase 2 — consumers that over-collect** (each its own commit; each adds itself to the lazy
set and reads through the cheap primitives `frameBackend().preview(h, n)` / `.column(h, name)`
after `flushRef(f)`, template = `GetColumnNode` at `frame.ts:1658-1660`)
5. `TableInfoNode`: `preview(h, 0)` for rowCount + schema.
6. `WriteFileNode`: cache the REF in `data()`, `readFrame` inside `run()` only. `sink.test.ts`
   pins the nothing-to-write refusal; keep it green.
7. `SlicerNode`: `column()` for the distinct-value picker; `runFrameUnary(filterMulti)` for the
   output so it emits a ref and no longer truncates the chain. Web oracle must give identical
   values (frameVerbCorpus has `filterMulti` fixtures).
8. `SumIfsNode`: `column()` per named column.

**Phase 3 — passthrough emits**
9. Decide the mechanism and write it as one rule beside `frameBackend.ts:552-556`: a no-op
   verb emits a NON-OWNING ref via a zero-op `extendRef` entry the backend no-ops (preferred —
   it is non-owning by the existing "only an empty-plan ref owns its handle" rule, so no
   lifecycle change), rather than forwarding the raw upstream ref.
10. Convert the nine passthroughs. Run `frameShapePassthrough.test.ts`, `seeds.test.ts`,
    `pivotSeed.test.ts`; watch `Canvas.tsx:753` (`noderemoved` drop) for a double-free.

**Phase 4 — the preview flush**
11. Re-measure with the step-1 counter. Then gate `emitFrame`'s `collectPreview` on the card
    preview being observable: skip the flush when the node is collapsed / its chip is not
    mounted / not pinned / no Cable Inspector on its output. The chip surfaces already resolve
    refs lazily on mount (`FrameChip.tsx:19`), so an unobserved card needs no eager
    `cachedResult`. Keep the `gen` double-check around the await (`frame.ts:69,72`).
    `polarsBackend.test.ts:245` ("a card preview mid-chain still flushes") must stay green —
    it exercises an OBSERVED preview.
12. Leave `collectPreview`'s small-frame full collect (`frameBackend.ts:141`) alone — it is
    load-bearing for byte-identical seed parity. If you want to remove the second round trip,
    decide from the preview's own `rowCount`, never by dropping the full read.

**Docs.** One digest line per phase in `docs/dev-notes.md`; update `docs/architecture.md`
§ FrameBackend if the seam's shape changed; delete the backlog line and this file at the end.

## Traps (each has bitten or will)
- Memo is keyed by ref OBJECT (`frameBackend.ts:30-33`) — never key a new cache by handle
  without adding it to `clearHandleKeyedCaches` (`:363-369`).
- Sketch-mode maps (`_sampleFactor`/`_sketchInfo`/`_aggGuardInfo`, `:438-446`) populate at
  flush time and apply at READ time; moving a flush moves where they populate.
- The aggregate guard reads the UNSAMPLED base handle (`:445,459`); an earlier drop degrades
  it silently to null.
- Per-cell `SolError`s cannot ride the wire (`frameVerbs.test.ts:20-23`); moving a consumer
  from JS to an engine op changes error-cell behaviour on desktop only.
- `FrameValue.__ref` is structurally typed on purpose (`frame.ts:38-41`).

## Out of scope (separate items, raise with the author)
- Rust store as `LazyFrame` plans instead of eager `HashMap<String, SolFrame>`
  (`engine.rs:136,169`, `apply_ops` collects at `:2507-2513`) — makes an intermediate flush
  free but invalidates the "eager independent frames → drop is always safe" lifecycle.
- A `WireOp::pivot` so Pivot stops being a materialization boundary.

## Done when
- Step-1 counter shows one `engine_apply_many` and zero `engine_collect` for an unobserved
  4-verb chain; the observed-preview test still passes.
- All Phase-1/2/3 nodes emit refs; guard test from step 4 is green.
- Full `npx vitest run` + `tsc` green; web seeds byte-identical; not pushed.

## Findings (append one line each; no fixes)

(none yet)
