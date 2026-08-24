# A2 — Formula-surface containment, safe slice

**Goal.** An FX-backed (Formula.js) name with NO declared meta that receives a MATRIX
(rank-2) argument returns ONE clean `SolError` — never broadcasts into an array of
`#VALUE!` cells, never throws. Rank-1 (list) broadcast of undeclared scalar names
(`SIN`, `POWER`, `ROUNDUP`…) stays as it is: broadcasting is the correct answer there.

**Read first.** `docs/rules.md` `hideMatrixFromVendor` (body ~826-850), `blockedFailFast`
(~808-816), `docs/formulajs-divergences.md` (skim the header only).

**Backlog line to delete when done:** `docs/backlog.md` "A2 Formula-surface containment".
The "allowlist FLIP" follow-on is NOT part of this plan.

## Where it is

- Matrix gate: `src/graph/excelFormula.ts:867-879` inside `evalAst` `case "call"`:
  ```ts
  if (argv.some((a) => isMatrix(a)) && !EXCEL_IMPL_META[name]?.matrixArgs) {
    if (RANGE_POSITIONAL.has(name)) return solError("#SHAPE!", ...);
    if (RANGE_FUNCTIONS.has(name)) argv = argv.map((a) => (isMatrix(a) ? a.flat() : a));
    else if (takesWholeArgs(name)) return solError("#SHAPE!", ...);
  }
  ```
  The missing branch: an undeclared FX name falls through to `broadcastCall` at `:905`.
- `dispatch` at `excelFormula.ts:367-371` throws `Unknown function` — leaks as `#ERROR!`
  via the outer guard.
- `broadcastCall` at `:728-744` (turns per-cell throws into per-cell errors — this is the
  broadcast-into-array symptom).
- Declared-meta predicate MUST be dynamic (packs write meta at runtime,
  `src/graph/formulaExtensions.ts:46-50`): use `EXCEL_IMPL_META[name] !== undefined`.
  Precedent: `src/graph/formulaNodeParity.ts:116`.
- Internal registry: `src/graph/excelFunctions.ts:189-196` `registerInternal`,
  `:341-343` `internalFunctionNames()`; FX resolution `:207-224`.
- `solError(code, message)`: `src/graph/errorValue.ts:84`. Reuse `#SHAPE!`; add no code.

## Steps

1. In the matrix gate, add the missing arm: after the `takesWholeArgs` branch, if
   `EXCEL_IMPL_META[name] === undefined` and `!internalFunctionNames().has(name)`
   (check the exact return type of `internalFunctionNames` first) → `return
   solError("#SHAPE!", \`${name} works on values and 1-D lists, not a 2-D matrix\`)`.
   Keep the same message text as the existing `takesWholeArgs` branch so the two read
   identically.
2. In `dispatch`, replace the `throw new Error("Unknown function")` with `return
   solError("#NAME?", \`Unknown function ${name}\`)` ONLY IF the callers of `dispatch`
   handle a SolError return (check every `dispatch(` call site — `broadcastCall` and the
   whole-arg branches). If a call site would wrap the SolError as a value in an array,
   short-circuit earlier instead: in `case "call"`, right after the frame-verb
   short-circuit (`:851-856`), `if (!resolveExcelFunction(name)) return solError("#NAME?", …)`.
   Prefer step-2b (the early short-circuit); do not do both.
3. Tests — add to `src/graph/broadcastRules.test.ts` under "the matricesInFormulas
   containment rule" (`:110-126`):
   - an undeclared FX name (pick one from: `BIN2DEC`, `ROMAN`, `UNICHAR`, `MROUND` — verify
     it is NOT in `EXCEL_IMPL_META` at test time with `expect(EXCEL_IMPL_META[n]).toBeUndefined()`)
     called with a 2×2 matrix arg → `isSolError(result)` and `result.code === "#SHAPE!"`,
     and `Array.isArray(result)` is false.
   - the same name with a rank-1 list arg still broadcasts (result is an array, same length).
   - an unknown name (`NOTAFUNCTION(1)`) → SolError `#NAME?`, not a throw.
   Use whatever evaluator helper the surrounding tests already use (`compileEvaluator`
   from `src/graph/excelFormula.ts:911`).
4. `docs/rules.md` `hideMatrixFromVendor`: amend the one sentence that claims the
   fallthrough "only ever receives scalars" to state the new arm and name the test.
   One sentence; no history.
5. `docs/backlog.md:218` says "~232 with declared meta" — it is 377. Fix the number in
   the "Formula surface is open-by-default" entry while there.

## Done when

- Both new tests + the full `formula*.test.ts` / `excelFunctions.test.ts` /
  `broadcastRules.test.ts` set pass; `tsc` clean.
- Digest line in `docs/dev-notes.md`; backlog A2 line deleted; this file deleted.
