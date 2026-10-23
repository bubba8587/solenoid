# port-backend-verbs: handoff (delete on merge)

Status: Join, Append, Bind Columns, Table Info, Slicer and Pivot are split into shells (backend I/O only) and pure
`body()`s, refrozen with hand tests (`tests/graph/backendVerbCards.test.ts`), and their Rust bodies
(`crates/solenoid-core/src/nodes/backend_verbs.rs`) pass every frozen case natively (`NODES=... cargo test --test
nodes`). The TS is NOT switched or deleted; clippy, the wasm rebuild and dte validate not run since the Rust.

Pivot: the body answers `fieldNames` and the shell prunes the saved fields to them (a body that pruned them froze
answers no replay could reach). Slicer and Pivot run as two calls over a ref (schema -> `read` -> answer).
`adoptPivot` split into `pivotWireOnto` + `attachPivotLayout`; a temporary `pivotOnCore` that `pivotOnEngine` wraps.

Next:
1. Switch each `body()` to `return nodeOnCore(this, inputs) as ...`.
2. Delete the TS the core covers: the bodies, `slicerUniques`, `filterFrameByMembership`, `distinctKeys`,
   `pivotCellKey`, `combineFilter`, `passRef`, and `pivotOnCore` (`pivotOnEngine` back to `adoptPivot`; GroupBy totals
   still use it).
3. clippy native + wasm32, tsc, rebuild the wasm (wasm-bindgen 0.2.100), run `backendVerbCards`, `pivotNodeFilter`,
   `pivotLayout`, `lazyFrameReads`, `lazyChain`, `persistenceSweep`, then the full suite. The last freeze run's
   failures (coerceInputs bridge, localFileRace, sketchExport, sink) are the usual freeze-mode ones; confirm against
   the base.

Frozen oddities (TS bugs the Rust matches): a lazy verb on a failing ref still fails at `emitFrame` (its preview isn't
in `materialize`); Slicer's value path compares a text pick "3" to the number 3 by identity (no match) while its ref
path compares as text (match); Slicer picks its column by getColumn rules on a value but exact name on a ref.
Stale: node-bodies.md (no row), frame-verbs.md ("Who receives a ref", the PIVOTBY paragraph).
