# port-formula-columns: handoff (delete on merge)

Status: Computed Column and Cube Input are split into a TS shell around a pure `body()`, and their Rust bodies are
written (`crates/solenoid-core/src/nodes/columns.rs`). Neither class is refrozen, so neither body calls `nodeOnCore`
yet and no TS is deleted. App behaviour is unchanged.

Do NOT merge before step 1: the `columns::run` arm is registered, so `cargo test --test nodes` fails for
ComputedColumnNode (897/903) and CubeInputNode (21/21) against the old fixtures (ref cases froze backend handles).

Next:
1. Under the test lock: `FREEZE_NODES=ComputedColumnNode,CubeInputNode npx vitest run`, then
   `node scripts/freeze-nodes.mjs ComputedColumnNode CubeInputNode`. Commit with the split.
2. Fix the Rust against the new fixtures.
3. Switch both `body()` methods to `nodeOnCore`.
4. Delete what the core covers: `cubeRows.ts`, `computedColumnUnits.ts`, `computeCubeColumnCells`,
   `tagCubeComputedCell`, `computedColumnType`, `cubeWithColumn`, `exprYieldsDate`, `fillFormulaColumns`,
   `cubeFromSource`, `runVerb` if unused. Keep `computeColumnCells` (the TS reference in coreConformance, wasmEngine,
   rangeCallMemo, bench tests).
5. Point `CubeInputNode.tsx` at the card's `cachedResult` (it calls `cubeFromSource` directly) and refresh the popup
   after `processGraph()` resolves.
6. Update `lambdaCaptures`' entry in `persistenceSweep.test.ts` (names Frame Input only).
7. Rebuild the wasm (wasm-bindgen 0.2.100, see the port brief) and run the card vitest files.

Changes outside the cards: `eval.rs` `ColumnInputs.frame` became `table: Table::Frame | Table::Rows` with
`column_with(spec, inputs, tag)` (`column()` tags as before); callers updated in `frame_backend.rs`,
`examples/colbench.rs`, `tests/caches.rs`. Shared unit-plan helpers moved from `docs.rs` to `columns.rs`
(`pub(crate)`). Computed Column gained `static coreFields = ["lambdaCaptures"]` (drop once λs cross the wire whole
with unit-bearing captures, here and in Frame Input).

Check on the port: a bail now answers a #VALUE! column where the TS evaluator used to run the formula (only for
functions the core lacks). Frozen oddities: `@d - MIN(d)` types as Date; `SORT(@s)` on a row's list leaves it unsorted.
Stale docs: node-bodies.md (no rows), computed-columns.md and unit-flow.md name the TS functions.
