# B8 — cube-aware Unnest (peel one level) · Timesavers remainder · XLOOKUP path collapse

Three independent sub-items; commit each separately. B8.3 depends on A4 having landed
(check `git log` for "rawInputs" / the A4 digest line; if not, do B8.1 and B8.2 and leave
B8.3 with a note in your final message).

**Read first.** `docs/value-semantics.md` "Reading an input"; `docs/socket-reference.md`
(cube and trueany rungs); `.claude/skills/add-node/SKILL.md` in full (it is the node
checklist — every touchpoint and every sweep test that bites a new node);
`docs/code-comments.md`.

**Backlog line to delete when done:** `docs/backlog.md` "B8". If B8.3 is left, edit the line
down to just that remainder instead of deleting it.

---

## B8.1 — Unnest peels ONE cube level

**Goal.** `UnnestNode` on a depth-2 cube (nested cells are cubes, e.g. the Region→Rep→Orders
chain from a cube-aware Nest Join) yields a depth-1 cube; on a depth-1 cube (nested cells
are frames) it yields a flat frame, as today. A depth-2 input today silently yields an
EMPTY frame — that is the bug to pin first.

**Where it is.**
- `src/graph/nodes/frame.ts:835-862` `UnnestNode`: sockets `:848-850` — `cubeIn("Cube")`,
  `strIn("Nested column")`, **`frameOut("Flat")`** (the hard-frame output is the blocker);
  `data()` `:853-861`, synchronous, `runVerb(() => unnestCube(c, col))`.
- Kernel `src/graph/frameVerbs.ts:1182-1215` `unnestCube`. The silent-empty path: `schemaFrame`
  is found via `isFrameValue(cell)`; on a depth-2 cube no cell is a frame → `childCols = []`,
  `childRows = 0` → zero rows, parent column names only.
- Cube model: `src/graph/frame.ts:458` `CubeCell`; depth `cellCubeDepth` `:484-488`,
  `computeCubeDepth` `:491-495` (cube-in-cube grows depth; frames are leaves). The
  cube-aware Nest Join whose inverse this is: `relateCubeToFrame` `frame.ts:660-675` (its
  rule "the nested column is the FIRST column holding a frame/cube" is the tie-break to
  mirror when `column` is blank — see design).
- Component `src/graph/components/FrameNodes.tsx:517-525` `UnnestComponent` uses
  `FrameDisplay`; the Nest sibling at `:507` uses `CubeDisplay`.
- Catalog `src/graph/nodeCatalog.ts:1011` (paired with Nest at `:1009-1012`).
- No Rust mirror; cube ops are eager JS by rule (`docs/archive/dev-notes-history.md:4060`).
  Nothing to sync.
- Tests: `src/graph/frameVerbs.test.ts:233-270` (round-trip, `#REF!`);
  `src/graph/cubesSeed.test.ts:71-72` (depth-1 flatten = 36 rows) — the depth-2/3 cubes it
  asserts at `:62-68`, `:83` are the fixtures to peel. Seeds that must keep loading:
  `src/graph/seedGraphs/cubes.json:213-218`, `seedGraphs/table-verbs.json:255-260`.

**Design (decided).**
- Output socket becomes `staticTrueAnyOut("Flat")` (precedent `XLookupNode`
  `frame.ts:1963`) — keep the key `frame` so the seeds and `cubesSeed.test.ts` still read
  `.frame`. `catalogRegistry.test.ts:122` (`trueanyNeedsPassthrough`) will then demand a
  `passthrough()` declaration or a sanction; the output is NOT an input passthrough, so add
  the class to that test's sanctioned list with the reason "result rank depends on input
  depth (frame at depth 1, cube at depth ≥2)". Read the test first; follow its existing
  sanction shape.
- Kernel: `unnestCube` gains one branch. Detect the child kind from the first non-null
  nested cell: `isFrameValue` → existing flat path; `isCubeValue` → peel path: the output is
  a CUBE whose columns are the parent flat columns (repeated per child row) plus the child
  cube's columns (cells copied as-is, so a child's own nested column stays nested). Build
  it with the cube constructors already used by `cubeRowAt`/`cubeFromColumns`
  (`frameVerbs.ts:1361-1365`). Mixed frame/cube cells in one nested column → `#TYPE!`
  ("nested cells must all be tables or all be cubes"). Still: a parent row with an
  empty/missing nested value disappears (the existing `socketDocs` sentence stays true).
- `column` blank stays an empty result (current behaviour, `frame.ts:855`) — do NOT add
  the first-container default here; note it as a Finding (it would be a second convention
  next to `relateCubeToFrame`'s).
- Component: render `CubeDisplay` when `isCubeValue(result)`, else `FrameDisplay`. Look at
  how `XLookupNode`'s component handles a polymorphic value before writing a branch.
- Catalog description: rewrite so it's true — "Expands a Cube's nested column one level:
  nested tables flatten to a Frame, nested cubes peel to a shallower Cube. Each parent row
  repeats per nested row. The inverse of Nest." Check DESIGN.md §7 (no em dashes, no
  trailing parenthetical) and run `uiCopy.test.ts`.
- `docs/node-coverage.md:39` roster line: no new node, so only touch it if it describes
  Unnest's output shape.

**Steps.**
1. Failing tests in `frameVerbs.test.ts`: (a) depth-2 cube (build via `relateCubeToFrame`
   twice, or reuse the `cubesSeed` fixture) → result `isCubeValue`, depth 1, row count =
   sum of child row counts, parent columns repeated, child columns intact; (b) peel then
   Unnest again → flat frame equal to the original leaf rows (the two-step inverse of the
   chain); (c) mixed cells → `#TYPE!`; (d) the existing depth-1 round-trip unchanged.
2. Kernel branch. 3. Socket + sanction + component. 4. Catalog copy.
5. `tsc`; `frameVerbs.test.ts`, `cubesSeed.test.ts`, `cubeNodes.test.ts`,
   `catalogRegistry.test.ts`, `socketReference.test.ts`, `persistenceSweep.test.ts`,
   `uiCopy.test.ts`; then the full suite. Commit.

---

## B8.2 — Timesavers remainder: what is actually still missing

The proposal's list (`docs/archive/timesavers-pack-proposal.md:72-107`) has been mostly
absorbed since it was written: Count Distinct = Aggregate `countdistinct`
(`src/graph/nodes/list.ts:1865-1895`); Rank within Group / Running Count = Window
(`nodes/frame.ts:2282-2322`, fns `frameVerbs.ts:1881-1886`); IQR Outlier Flag = Outliers
(`nodeCatalog.ts:528`); Bucket/Recode = Bin. Don't rebuild any of those.

Build these two. Both are ops/toggles on existing families, not new nodes (the add-node
skill's first rule, `SKILL.md:16-40`):

**(a) Conditional Aggregate OR** — `SumIfsNode` (`nodeCatalog.ts:976`; class in
`nodes/frame.ts`, grep `class SumIfsNode`) matches criteria rows with "all must pass". Add a
`match: "all" | "any"` selector (persisted like the node's other selector fields — follow
`extractInit`/`INIT_FIELD_ORDER` in `copyPaste.ts`, `SKILL.md:131-158`), default `all`,
rendered as a `SegToggle` (grep `SegToggle` in `components/FrameNodes.tsx` for the idiom).
The predicate combinator is one `every` → `some` swap at the criteria fold — find it, and
check whether a Polars/Rust mirror exists for SUMIFS (`grep -in sumifs src-tauri/src`); if
it does, the Rust side must gain the same flag and the cargo parity test must cover it —
if you can't run cargo on this machine, say so and keep the JS oracle + Rust source in step
anyway. Catalog description gains "all or any criteria". Tests next to the existing SUMIFS
tests (grep `SumIfs` in `src/graph/*.test.ts`): `any` with two criteria where each row
passes exactly one; `any` with zero criteria = same as `all` with zero criteria.

**(b) First / Last non-blank** — Aggregate ops `first` and `last` on `ReduceOp`
(`list.ts:1865`; meta table `:1867-1895`, `satisfies Record<ReduceOp,…>` makes tsc list every
switch you missed). Aggregate already skips null/blank (value-semantics: aggregators skip
null), so "first non-blank" is just the first surviving element — verify that in the fold
before relying on it, and pin it. Result dim per `aggregateResultDim` `:1903-1914`: same as
`min`/`max` (per-column on a frame). `fx` names: `FIRSTNONBLANK` / `LASTNONBLANK` (declare
`fx` explicitly — CLAUDE.md's `fx ?? despace(label)` rule). Optgroup: "Basics" (the dropdown
groups landed 2026-08-24, commit ce4f3354 — add to the right group). Excel parity: no
direct equivalent; the catalog note may point at `INDEX/MATCH` with `<>""` if it reads
naturally, otherwise leave the anchor as the description carries it. Tests in the Aggregate
test file (grep `countdistinct` in `src/graph/*.test.ts` to find it): list with leading
nulls; all-blank → null; frame per-column; error cell → error (the Aggregate convention —
check what `min` does with a `SolError` element and match it).

**Held out of B8.2 (record in the digest, build nothing):**
- Duration trio (Duration⇄Time, Humanize, Parse) — `docs/pack-composite-plans.md:29-30`:
  wants an elapsed `[h]:mm` FC format first; that is a format-model question
  (`docs/format-model.md`), not a node. Leave it there.
- Split Name — a multi-output text node (first/middle/last/suffix). Real, small, but it is
  a NEW node with a judgment call on the output shape (4 sockets vs a frame). Leave in
  `pack-composite-plans.md`; one Finding line.
- Multi-Criteria Lookup / Lookup All Matches — reopens the recorded XLOOKUP shape
  decision (backlog "NOT a frame/cube input", asked + declined 2026-08-11). Not ours.
- Fiscal Quarter / Age / Nth Weekday — author call (`docs/deferrals.md:186-188`).

---

## B8.3 — collapse the XLOOKUP frame + cube lookup paths (after A4)

**Goal.** One row-finder, one cell-getter, one whole-row getter; `XLookupNode.matchOne`
loses its `isCubeValue` fork.

**Where it is.** `src/graph/frameVerbs.ts`: frame side `lookupFrameCell :1261-1268`,
`lookupFrameRowIndex :1275-1288`, `frameRowAt :1355-1357`; cube side `lookupCubeCell
:1319-1327`, `lookupCubeRowIndex :1333-1351`, `cubeRowAt :1361-1365`, `requireCubeColumn
:1292-1296`, `inferCubeKeyType :1302-1314`; the shared entry `asLookupSource :1369-1375`.
Node fork: `nodes/frame.ts:1998-2019` `matchOne`. The two row-finders already share
`lookupNeedle` + `xmatchIndex`; the only divergences are the key-type source
(`key.type` vs `key.type ?? inferCubeKeyType`), the orderable check (`isOrderableKey` vs an
inline number/date test), the ragged-cube slice (`key.cells.slice(0, cubeRowCount(c))`), and
the error text.

**Design.** Since a frame is a legal cube input and `frameToCube` carries `col.type`
(`frame.ts:523-525`), the collapse is: `asLookupSource` returns a CUBE always (frame →
`frameToCube`), and the cube functions become THE functions — renamed to `lookupCell`,
`lookupRowIndex`, `lookupRowAt`; frame variants deleted; `isOrderableKey` used in the one
orderable check; one error string (keep the frame one, "Approximate lookup requires a
numeric or date column"). Whole-row return on a frame source must still return a FRAME row
(check what `frameRowAt` returns vs `cubeRowAt` and what the node's `staticTrueAnyOut`
consumers expect — `errorValue.test.ts:283-311` pins the node; run it before and after).
If the whole-row shape can't be preserved without a frame branch, keep ONE branch there and
nowhere else.

**Steps.** 1. Run `frameLookup.test.ts` + `errorValue.test.ts` green as the baseline.
2. Rename/merge in `frameVerbs.ts`; update `frameLookup.test.ts` imports (its frame arms
`:28-117` become tests of the unified functions fed a frame; keep every case). 3. Simplify
`matchOne`. 4. Full suite. Commit. Nothing to sync in Rust (lookup is JS-only; confirm with
`grep -in xlookup src-tauri/src`).

---

## Done when

- Each sub-item: its named tests + full suite + `tsc` green; committed separately.
- One digest line per landed sub-item in `docs/dev-notes.md`, plus the held-out list from
  B8.2 as Findings; backlog line deleted (or trimmed to the unlanded remainder); this file
  deleted (or trimmed likewise).
- Final message: for the author to eyeball at http://localhost:1420 — the `cubes` seed's
  Unnest cards still show 36 flat rows; a Nest Join → Nest Join → Unnest chain shows a cube
  chip; SUMIFS with the toggle on `any`; Aggregate's dropdown shows First / Last.
