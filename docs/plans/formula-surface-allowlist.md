# Formula surface: close the open-by-default hole (allowlist)

**STATUS — AUTHOR-GATED PROPOSAL. DO NOT EXECUTE UNTIL THE AUTHOR GREENLIGHTS.**
The backlog ("Formula surface is open-by-default") and `docs/plans/README.md` both flag
this "raise with the author first." This file is the concrete artifact for that
conversation, not an approved plan. It carries a real DECISION (Option A vs B) the author
owns. Written by A2 2026-08-25, plan-only, no code touched. Line numbers verified against
`excelFormula.ts` / `excelFunctions.ts` on 2026-08-25 — grep the symbol if they drift.

## Read first
`CLAUDE.md`; `docs/rules.md` (the FX rules + `hideMatrixFromVendor`); `docs/formulajs-divergences.md`
(why each `registerInternal` override exists — read before deleting a fallthrough);
`docs/subsystem-invariants.md` § error values.

## The problem (grounded)

The formula surface is defined by SUBTRACTION from Formula.js's full export, not by an
allowlist:
- `FX_FUNCTION_NAMES` (`excelFunctions.ts:229`) walks the Formula.js export tree → the
  advertised parse/autocomplete surface (~445 flat + namespaced names). Added to the
  known-name set at `excelFormula.ts:293`.
- `EXCEL_IMPL_META` (`excelFunctions.ts:407`) is the DECLARED-meta table (~377 names): the
  arity/returns/family/`matrixArgs`/`cxArgs` a name opts into.
- `resolveExcelFunction` (`excelFunctions.ts:208`) resolves ANY name — internal override
  first, then `fxLookup` — so an undeclared FX name still dispatches.

The gap = `FX_FUNCTION_NAMES` minus (`EXCEL_IMPL_META` keys ∪ internal ∪ frame/node/eliminated
redirects) ≈ **~68 names that resolve and run with NO declared contract.** The predicate the
code already uses for "undeclared" is `EXCEL_IMPL_META[name] === undefined && !isInternalFunction(name)`
(`excelFormula.ts:883`).

**What's already contained** (do not re-solve): in the matrix gate
(`excelFormula.ts:877-888`) an undeclared FX name with a MATRIX arg already short-circuits to
`#SHAPE!` (the `takesWholeArgs || (EXCEL_IMPL_META[name] === undefined && !isInternalFunction)`
clause, `hideMatrixFromVendor`). Blocked spellings, frame verbs, node verbs, eliminated names,
and genuinely-unknown names are each already a clean SolError above (`excelFormula.ts:851-863`).

**The remaining hole:** an undeclared FX name with a **1-D LIST** arg (not a matrix) passes
every gate and reaches `return broadcastCall(name, argv)` (`excelFormula.ts:914`), which maps
it element-wise. For a name that expects a whole array, or that throws on a per-element value,
the result is a LIST of `#VALUE!`s or a throw that leaks as `#ERROR!` from the dispatch. That
is the treadmill: correctness for the ~68 names is discovered breakage, one report at a time.
Scalar-only args are fine (they dispatch and work); the hole is array args specifically.

## The decision the author owns

**Option A — near-term containment only (small, 1.3-safe, keeps the subtraction model).**
Make an undeclared FX name refuse ARRAY args cleanly instead of broadcasting. One guard,
placed just before `broadcastCall` at `excelFormula.ts:914` (mirrors the matrix clause at
883-886): if `EXCEL_IMPL_META[name] === undefined && !isInternalFunction(name)` and any arg
`isArr`, return `solError("#VALUE!", \`${name} isn't a supported list function\`)` (or `#NAME?`
— the author picks the code; `#VALUE!` reads as "bad arg shape", `#NAME?` as "not really a
function here"). Scalar dispatch is unchanged. Turns the treadmill into one honest refusal.
Cost: a handful of undeclared names that HAPPENED to broadcast fine now refuse on lists — but
they are undeclared, i.e. unsupported by contract, so this is making the real surface visible.

**Option B — the full allowlist (root fix, larger, the backlog's "longer term").**
"A name exists iff declared." Gate undeclared FX names to `#NAME?` at the top
(`excelFormula.ts:863`, where `!resolveExcelFunction` already lives) and delete the
broadcast fallthrough for them; drop the ~68 undeclared names from `FX_FUNCTION_NAMES` so
autocomplete stops advertising them. **The bulk of the work is the AUDIT**, which needs the
author's per-name calls: each of the ~68 is either (a) a real Excel function we WANT →
declare its `EXCEL_IMPL_META` (and any `registerInternal` divergence per
`formulajs-divergences.md`), or (b) unwanted → let it fall to `#NAME?`. This cannot be done
mechanically — declaring a name is a product decision about the surface.

**Recommendation (A2):** do **Option A now** (it removes the user-visible footgun and is
1.3-safe), and treat **Option B as a separate, author-driven audit** of the ~68 names (its own
tranche, likely post-1.3). A closes the correctness hole immediately; B tidies the surface
definition and is where the author's taste on "which functions exist" belongs. A does not
block B — B later replaces A's guard with the top-level `#NAME?` gate.

## Steps — Option A (only if greenlit)

0. **Enumerate the gap** (throwaway, not committed): a one-off that logs
   `FX_FUNCTION_NAMES.filter(n => !EXCEL_IMPL_META[n.toUpperCase()] && !isInternalFunction(n) && !FRAME_SURFACE_NAMES[...] && !NODE_SURFACE_NAMES[...] && !ELIMINATED_FUNCTIONS.has(...))`.
   Paste the real list into the dev-notes digest so the author sees exactly what A refuses.
1. Add the guard before `excelFormula.ts:914` as above. Reuse the existing `isArr` and the
   883 predicate; do NOT duplicate the predicate — factor `isUndeclaredFx(name)` if it reads
   cleaner, used by both 883 and the new guard.
2. Tests → `excelFunctions.test.ts` (or `broadcastRules.test.ts` if it fits the table): pick
   two names from step 0's list, assert `=NAME({1,2,3})` returns the SolError (not a `#VALUE!`
   array, not `#ERROR!`), and that `=NAME(scalar)` still dispatches unchanged. Add a guard test
   that the undeclared set from step 0 is non-empty (so a future declaration sweep that empties
   it flips this test, signalling A's guard is now dead and can go).
3. `npx tsc --noEmit`; `npx vitest run excelFunctions broadcastRules formulaMatrix`; full
   `npx vitest run` before commit.
4. Rule: add a one-line `FX-n` to `docs/rules.md` ("an undeclared FX name refuses array args")
   citing the test. Dev-notes digest line. This is a containment, not the allowlist — leave the
   backlog "open-by-default" item OPEN, noting A landed and B (the audit) remains.

## Steps — Option B (only if the author drives the audit; sketch, not a routine plan)

B is not a smaller-model plan — it is an author-in-the-loop audit. Sketch only:
1. Author walks step-0's ~68 names; for each: declare `EXCEL_IMPL_META` (+ `registerInternal`
   if it diverges) OR mark it drop.
2. Replace A's guard: gate undeclared names to `#NAME?` at `excelFormula.ts:863` (extend the
   `!resolveExcelFunction(name)` check to `|| isUndeclaredFx(name)`), delete the `broadcastCall`
   fallthrough for them.
3. Remove dropped names from `FX_FUNCTION_NAMES` (a declared-only filter at `:229`, or a
   subtraction set). Autocomplete + `=` help now show only real names.
4. Tests: the surface is exactly the declared set; a dropped name is `#NAME?` everywhere;
   `formulaNodeParity` / `nameCase` / `rangeRouting` stay green. Delete A's guard + its test.

## Done-definition
- **A:** the two chosen undeclared names refuse array args with a clean SolError, scalar
  dispatch unchanged, full suite green, `FX-n` rule + test pinned, dev-notes digest, THIS plan
  stays (B still open) — or is trimmed to the B sketch.
- **B:** `resolveExcelFunction`/the surface is declared-only, the ~68 are resolved (declared or
  dropped), fallthrough deleted, autocomplete matches, full suite green, backlog item deleted,
  this plan deleted.
