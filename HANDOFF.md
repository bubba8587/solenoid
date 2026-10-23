# port-lambda-qr: handoff (delete on merge)

Status: the λ wire change and the QR encoder are done and tested; LambdaNode, RandArrayNode and QrCodeNode are split
into shells with Rust bodies written and registered (`nodes/lambda.rs`, `list.rs`, `nodes/qr.rs`) but NOT refrozen or
checked. None of the three classes is moved; no TS body deleted.

The wire: `coreValue`'s `__lambda` is `{params, expr, captured, capturedValues (with units), readValues (unit-blind),
descriptions?}`. `LambdaV` gains `src`, `units` (`env` keeps readValues) and `descriptions`; an old λ with no
readValues reads capturedValues as both. `Out` writes a λ with text as `{lambda:{...}}` (`values::serialize_lambda`);
a text-less λ is still `{lambda:true}`. `nodeWire.ts` rebuilds it (`wiredLambda`: lazy `compilePositional`,
`readCapturedColumn`, `withCaptures`, non-enumerable `fn`). `Outs`/`Shows` keep λ identity by `Rc::ptr_eq`. Frame
Input's `lambdaCaptures` workaround is gone. `tests/nodes.rs` has a Lambda arm (params, src, eta, captured,
descriptions, env and units item by item). REVIEW: the FrameInputNode fixture was migrated by script (dropped
`init.lambdaCaptures`, λ inputs gain readValues/capturedValues; answers untouched; one 1 km case).

QR: `crate::qr` ports qrcode 1.5.4 (segments via the dijkstrajs path with its tie order and buildGraph's shared
`lastCount`, versions, Reed-Solomon, mask penalty; Kanji off). `fixtures/core/qr-encoder.json.gz` (669 cases, from
`tests/graph/coreQr.test.ts` with FREEZE_CORE=qr-encoder); `tests/qr.rs` passes all.

Next:
1. Under the lock: `FREEZE_NODES=LambdaNode,RandArrayNode,QrCodeNode npx vitest run`, then
   `node scripts/freeze-nodes.mjs LambdaNode RandArrayNode QrCodeNode`; commit the fixtures.
2. `NODES=... cargo test --test nodes`; then the full replay and full `coreNodes.test.ts` (not run since the wire change).
3. Switch each `body()` (QR's `data()`) to `nodeOnCore`; delete the TS bodies and `qrCode.ts` (move `QrTemplate` into
   `nodes/qr.ts`; `QrNode.tsx` imports it); drop the qrcode dependency (`npm uninstall qrcode`, keep the `@solenoid/*`
   links in the lockfile).
4. clippy native and wasm32 (wasm32 never run), tsc, rebuild the wasm (wasm-bindgen 0.2.100), run lambda, map/reduce,
   computed-column vitest files.

RandArray split: the shell clears `rolls` on a new recalc generation; the body answers `list: null` with
`rollsNeeded = count` when it holds the wrong number, and the shell draws that many and calls again
(`static coreFields = ["rolls"]`). QR: `_cache` dropped, `static coreFields = ["height"]`.
Likely TS bugs the Rust matches: RANDARRAY reads an error Min/Max as a number (NaN, or text); a count of -0 answers [].
Stale: node-bodies.md (the λ wire, `{lambda:true}` wording, Frame Input's captures).
