# 18 — The backend parity corpus (FX: one fixture set, both engines)

**Status: DESIGNED, not built.** The last item on the spec-promotion queue and the
largest: today the Polars engine (`src-tauri/src/engine.rs`) and the JS oracle
(`src/graph/frameVerbs.ts`) are kept in agreement by HAND-MIRRORED tests — each
side re-encodes its own fixtures, and the "vitest twin" comments in
`engine/tests.rs` are the only thread tying a Rust case to its JS counterpart.
That discipline has held (the oracle-key work pinned byte-identical row keys),
but nothing FAILS when a new verb, a new option, or a new edge lands on one side
only — the drift class the whole parity program exists to close, one seam over.

## The one design decision that matters

**The corpus format IS the wire format.** A fixture is a recorded IPC payload:
the frames as the engine deserializes them and the op as a `WireOp`-shaped JSON
object (`{ kind: "sort", by, dir }` — serde's tagged form and `FrameOp`'s union
are ALREADY the same shape by construction). No third representation, no
per-side encoding, nothing to keep in sync: if a fixture parses on one side and
not the other, that itself is the parity failure surfacing at load instead of
at compute.

## Layout

```
fixtures/frame-verbs/
  select.json  drop.json  rename.json  sort.json  distinct.json  head.json
  filter.json  filterMulti.json  groupBy.json  unpivot.json  pivot.json
  join.json  append.json  …one file per FrameOp kind / engine verb…
```

Each file:

```json
{ "verb": "sort",
  "cases": [
    { "name": "numbers ascending, nulls last",
      "frames": { "in": { "columns": [ …wire-shaped columns… ] } },
      "op": { "kind": "sort", "by": "v", "dir": "asc" },
      "expect": { "columns": [ … ] } },
    { "name": "unknown column",
      "frames": { "in": … },
      "op": { "kind": "sort", "by": "missing", "dir": "asc" },
      "expectError": "#REF!" }
  ] }
```

- `frames` is a map so multi-frame verbs (join/append/lookup) name their inputs.
- `expect` is a full wire-shaped frame — compared STRUCTURALLY, column order and
  dtype included. `expectError` is the SolError code (the engine's error mapping
  and the oracle's must agree on the CODE; messages are per-side prose).
- Value-model edges live IN the cases, not in special machinery: `null` cells,
  `Infinity`/`NaN` (which JSON-serialize as `null` — the corpus therefore writes
  non-finite values with the same `["#", null]` convention the oracle keys
  already pinned; a case needing a REAL ∞ input encodes it as the string
  sentinel `"__Infinity"`, decoded by both runners), `-0` (keys as `0`),
  mixed-type columns, empty frames, empty column lists.

## Runners

- **JS**: one vitest file (`frameVerbCorpus.test.ts`) globs `fixtures/frame-verbs`,
  runs each case through the oracle (`applyFrameOp`/the verb functions), compares
  structurally. It.each per case so a failure names `sort › unknown column`.
- **Rust**: one `#[test]` in `engine/tests.rs` (or `corpus.rs` beside it) walking
  `../fixtures/frame-verbs` via `CARGO_MANIFEST_DIR`, deserializing with the
  EXISTING serde types (`WireOp`, the frame wire shape), running the same verb,
  comparing the same way. No new Rust fixture code — the deserializers are the
  production ones, which is the point.

## The completeness guard (the ratchet)

Two `every`-quantified checks on the JS side (SSOT-8):

1. **Every verb has fixtures**: the set of `verb` values across fixture files
   must equal the declared verb inventory. The inventory is DERIVED, not
   hand-kept: `FrameOp["kind"]` is a type, so a runtime `FRAME_OP_KINDS` const
   is added to frameVerbs.ts and pinned against the dispatch switch (a kind in
   the switch but not the const, or vice versa, fails — the SSOT-4 shape guard).
   Multi-frame verbs (join and friends) get their own entries.
2. **Every case runs on both sides**: the cargo runner counts cases per file and
   writes nothing — instead, the JS side asserts every fixture file is
   non-empty and every case has `expect` XOR `expectError`, and CI runs BOTH
   suites (vitest + `cargo test`), so a case that passes JS and fails Rust is a
   red build, which is the whole point. (A "cargo ran N cases" cross-check was
   considered and dropped: both runners iterate the same files; a runner that
   silently skips a file fails check 1 on the other side the moment that verb's
   fixture exists.)

## Migration, not big-bang

The hand-mirrored tests are not deleted up front. Build order:

1. `FRAME_OP_KINDS` + the two runners + THREE seed verbs (sort, distinct,
   filter) moved into fixtures — proves the loop end to end, incl. one
   `expectError` case and one non-finite case.
2. Verb-by-verb migration: move each hand-mirrored pair's cases into the verb's
   fixture file, delete the pair (both sides in one commit — the "vitest twin"
   comments are the map of what pairs exist).
3. Flip the completeness guard from a WHITELIST of not-yet-migrated verbs
   (shrinking, visible) to the full `every` — the ratchet closes when the
   whitelist empties.
4. Promote as FX-12 ("the verb pair computes from ONE fixture corpus; a verb
   without corpus cases does not ship") once step 3 lands.

## Out of scope

- Property-based/fuzz generation (a later layer ON the corpus format — the
  format already supports generated files).
- The lazy `FrameRef` FUSION path's plan-shape testing — the corpus tests verb
  SEMANTICS; fusion is an optimization with its own tests.
- Non-frame parity (scalar formulas already have `formulaDivergence.test.ts`).
