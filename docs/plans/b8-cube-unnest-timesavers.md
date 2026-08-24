# B8.3 — collapse the XLOOKUP frame + cube lookup paths

B8.1 (Unnest peels one cube level, 5a5b3ab6) and B8.2 (SUMIFS all/any toggle + Aggregate
First/Last, 2567631d + copy touch-up f42b42d0) LANDED 2026-08-24. B8.3 remains — a delicate
internal simplification with no user-facing change. Do it fresh, not rushed: the whole-row
frame-vs-cube shape edge is the trap.

**Read first.** `docs/socket-reference.md` (cube and trueany rungs); `docs/code-comments.md`;
the A4 dependency (retire XLOOKUP rawInputs bypass, ec15cdf2) is landed.

**Held-out B8.2 Findings (recorded, build nothing):** Duration trio wants an elapsed `[h]:mm`
FC format first (format-model question, not a node); Split Name is a new multi-output text
node with an output-shape judgment call — both stay in `docs/pack-composite-plans.md`.
Multi-Criteria Lookup / Lookup All Matches reopen the recorded XLOOKUP shape decision (asked +
declined 2026-08-11) — not ours. Fiscal Quarter / Age / Nth Weekday are author calls
(`docs/deferrals.md`).

---

**Goal.** One row-finder, one cell-getter, one whole-row getter; `XLookupNode.matchOne`
loses its `isCubeValue` fork on the single-cell path (the whole-row path keeps ONE branch).

**Where it is.** `src/graph/frameVerbs.ts`: frame side `lookupFrameCell`, `lookupFrameRowIndex`,
`frameRowAt`; cube side `lookupCubeCell`, `lookupCubeRowIndex`, `cubeRowAt`, `requireCubeColumn`,
`inferCubeKeyType`; the shared entry `asLookupSource`. Node fork: `nodes/frame.ts` `matchOne`.
The two row-finders already share `lookupNeedle` + `xmatchIndex`; the only divergences are the
key-type source (`key.type` vs `key.type ?? inferCubeKeyType`), the orderable check
(`isOrderableKey` vs an inline number/date test), the ragged-cube slice
(`key.cells.slice(0, cubeRowCount(c))`), and the error text.

**Design.** Since a frame is a legal cube input and `frameToCube` carries `col.type`, the
collapse is: the cube functions become THE functions (rename `lookupCubeCell` → `lookupCell`,
`lookupCubeRowIndex` → `lookupRowIndex`), fed `frameToCube(frame)` for a frame source; the frame
variants are deleted; `isOrderableKey` used in the one orderable check; one error string (keep
the frame wording, "Approximate lookup requires a numeric or date column"). `frameRowAt` and
`cubeRowAt` STAY — the whole-row return must keep its shape (a frame source returns a FRAME row,
a cube source a CUBE row), so `matchOne` keeps exactly ONE branch there:
`isCubeValue(src) ? cubeRowAt(src, idx) : frameRowAt(src, idx)`, using `lookupRowIndex` on the
cube form. `errorValue.test.ts:283-311` pins the node — run it before and after.

**Steps.** 1. Run `frameLookup.test.ts` + `errorValue.test.ts` green as the baseline.
2. Rename/merge in `frameVerbs.ts`; rewire `frameLookup.test.ts`'s frame arms (~lines 28-117)
to feed `frameToCube(...)` to the unified functions — keep every case. 3. Simplify `matchOne`
(single-cell via `lookupCell` on the cube form; one whole-row shape branch). 4. `tsc`;
`frameLookup.test.ts`, `errorValue.test.ts`, then the full suite. Commit separately. Nothing to
sync in Rust (lookup is JS-only; confirm with `grep -in xlookup src-tauri/src`).

**Done when.** Named tests + full suite + `tsc` green; committed; one digest line in
`docs/dev-notes.md`; backlog "B8.3" line deleted; this file deleted. Final message for the
author to eyeball at http://localhost:1420: a frame-source XLOOKUP whole-row still returns a
frame chip, a cube-source whole-row still returns a cube chip, single-cell lookups unchanged.
