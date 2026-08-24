# C — Evict live material still cited from `docs/archive/`

**Goal.** No CODE file points at `docs/archive/` as if it were current. The archived
docs stay (finished record); their still-load-bearing half moves to a live home.

**Read first.** `docs/README.md` "Code → spec routing" table, `docs/code-comments.md`.

**Backlog line to delete when done:** `docs/backlog.md` "Finish evicting live material
from `docs/archive/`".

## The four code citations (all of them — verified 2026-08-24)

| file:line | cites | action |
|---|---|---|
| `scripts/formula-node-parity.ts:4` | `formula-node-parity.md` | replace the pointer with `docs/rules.md` (the parity ratchet rules) |
| `src/graph/formulaNodeParity.test.ts:9` and `:59` (a FAILURE MESSAGE the user sees) | `formula-node-parity.md` "Tier 1" | the message must explain itself without the doc: state the rule inline ("a node's Excel name must be registered as a formula, or listed in `EXCEL_NAMED_GAP` with a reason") and point at `docs/rules.md` |
| `src/graph/nodes/cube.ts:7` | `cube-node-scope.md` | delete the comment line (routed file → zero pointers, per `code-comments.md`) |
| `src/graph/frameLookup.test.ts:136` | `cube-node-scope.md` | delete the "See …" clause; keep the behavioral sentence |

`formulajs-vs-native-audit.md` has ZERO code citations — the backlog claim is stale. The
live half is already in code: `FAMILY_BACKING` (`src/graph/excelFunctions.ts:80-95`)
carries every verdict as a `why` string, guarded by `excelFunctions.test.ts:37-80`. No move
needed; just say so in the digest.

## Steps

1. Grep to confirm nothing new appeared: `grep -rn "docs/archive" src scripts` — expect
   exactly the four rows above.
2. Apply the four actions. For the routing check: open `docs/README.md` "Code → spec
   routing" and confirm `cube.ts` / `frameLookup.test.ts` / `formulaNodeParity.test.ts`
   rows point at a live doc; if a row is missing, add it pointing at `rules.md`.
3. Check whether `docs/archive/cube-node-scope.md` and `formula-node-parity.md` contain
   any rule that is NOT already in `docs/rules.md` and is still true of the code. If yes,
   add it to `rules.md` as a rule row (id + test that enforces it, or UNENFORCED). If no,
   nothing moves.
4. `npx vitest run src/graph/docsPointers.test.ts src/graph/formulaNodeParity.test.ts`.

## Done when

- `grep -rn "docs/archive" src scripts` returns nothing.
- Tests green; digest line; backlog line deleted; this file deleted.
