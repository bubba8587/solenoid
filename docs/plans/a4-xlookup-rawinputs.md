# A4 (remainder) — retire the XLOOKUP `rawInputs` bypass

**Goal.** `XLookupNode` no longer opts its `frame` input out of `coerceInputs`; a wired
Frame still arrives as a typed Frame (date/logical columns intact) and a Cube as a Cube.
The hand-rolled shape guard in the node goes away if the socket coercion now does it.

**Read first.** `docs/socket-reference.md` (the cube / frame variants and the coercion
boundary), `docs/value-semantics.md` "Reading an input", `docs/rules.md` SOCK rules.

**Backlog line to delete when done:** `docs/backlog.md` "A4 (remainder)".

## Where it is

- The bypass: `src/graph/coerceInputs.ts:255` `if (rawInputs?.has(key)) { coerced[key] = arr; continue; }`;
  declaration `:216`; doc comments `:40` and `:219` (`noWidenInputs` sibling).
- `XLookupNode`: `src/graph/nodes/frame.ts:1946` `rawInputs = new Set(["frame"])`;
  socket `cubeIn("Table / Cube")` at `:1956`; the shape guard `:1985-1992`;
  `asLookupSource` (`src/graph/frameVerbs.ts:1369-1375`; its header comment at
  `:1367-1368` still says the socket is `any` — stale).
- Why the bypass exists: `coerceInputs.ts:116-117` `case "cube": return toCube(v)`, and
  `toCube` of a Frame strips typed columns; the kernels key off `column.type`
  (`frameVerbs.ts:1283` `lookupNeedle(lookup, key.type)`; the cube fallback
  `inferCubeKeyType` `:1298-1314` never infers `date`).
- Other `rawInputs` users (NOT in scope, leave them): chart nodes
  `src/graph/nodes/visual.ts:102` and `:788`.
- Pins: `src/graph/frameLookup.test.ts:112-115` (typed columns survive), `:131` (nested
  cell identity), `src/graph/errorValue.test.ts` "XLOOKUP node SPILLS".

## Decide, then build (option 1 unless it fails a test)

1. **Make the `cube` coercion frame-preserving** (preferred, smallest): in
   `coerceInputs.ts` `case "cube"`, if `isFrameValue(v)` return `v` unchanged. First
   confirm in `src/graph/sockets.ts` `accepts()` and `docs/socket-reference.md` that
   frame→cube is a legal cable (the backlog says "with typed frame→cube the bypass is
   unneeded"). Then delete `rawInputs` from `XLookupNode`. Delete the `tabular` guard
   ONLY if coercion already rejects a scalar / bare 1-D list on a cube socket — write
   that test first (wire a number and a 1-D list; expect the `#VALUE!` "Build Frame two
   aligned lists first" error); if coercion silently widens, keep the guard.
2. Fallback: a `noWidenInputs`-style opt-out that applies element coercion but skips
   `toCube`. Only if option 1 breaks another cube-socket node (run the full suite).

## Steps

1. Failing test first in `frameLookup.test.ts`: build an `XLookupNode`, feed a typed
   frame with a DATE key through the normal `data()` wrapper path (copy how
   `errorValue.test.ts` "XLOOKUP node SPILLS" drives the node), assert a date lookup
   matches. Plus the scalar / 1-D rejection case.
2. Apply option 1. Delete `rawInputs` on `XLookupNode`. Fix or delete the
   `asLookupSource` header comment.
3. `rawInputs` then has only the chart users. Leave the mechanism; do NOT generalize.
4. `src/graph/persistenceSweep.test.ts:164` lists `rawInputs` as an allowed instance
   field — that is a different field (pass diagnostics). Leave it.
5. Full suite + `tsc`.

## Done when

- New tests green; `frameLookup.test.ts` + `errorValue.test.ts` + full suite green.
- Digest line (say that the chart nodes are now the only `rawInputs` users — feeds B8's
  "collapse the frame+cube lookup paths"); backlog line deleted; this file deleted.
