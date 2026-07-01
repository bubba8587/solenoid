# Solenoid — Formula.js vs Native Nodes: Overlap & Backing Audit

Decision-input doc, **no build commitment**. The app computes through **two parallel function
implementations**: the ~150 native nodes (`nodes/*.ts`, `mathUtils.ts`) with hand-rolled JS,
and **Formula.js** (`@formulajs/formulajs` v4.6.0), reached *only* via the Expression/LAMBDA
engine (`excelFormula.ts` → `dispatch`). The same operation (e.g. `ROUND`) therefore exists
twice and can diverge. This audit lays out which families overlap, where backing one with
Formula.js is safe vs. dangerous, and a recommended per-family policy — the concrete input to
the "where do functions live" decision parked in `dev-notes.md:2175`.

Companion: `docs/archive/formula-engine-array-semantics.md` (the engine's array/error gaps),
`docs/excel-pain-points.md` §3 (Excel's documented statistical inaccuracy — the reason some
families are hand-rolled on purpose).

**Note on rigor:** Formula.js was not installed in this clone, so this audit reasons about its
*category* coverage (it's a comprehensive Excel-function port — that's its entire purpose) and
the **divergence axes**, not an exact per-function export list. Before relying on any specific
Formula.js function, verify it exists in the v4.6.0 build. The recommendations below don't hinge
on exact function lists; they hinge on the axes, which are certain.

---

## 1. The user's stated principle (the lens)

> "Fine with our differences where they matter; if it's just one line of simple arithmetic it's
> not a big deal — I don't want to maintain redundant code for no reason when we already import
> it."

So the test for each family is binary: **is there a difference that matters?** If no → prefer
Formula.js (delete redundant hand-rolled code). If yes → keep internal, and the difference is
the documented reason. The five axes a "difference that matters" can live on:

1. **Numerical correctness** — does Formula.js match Excel's *inaccuracy*, where we deliberately
   don't? (Substantiated: native variance is the stable two-pass `Σ(v−m)²/(n−1)`,
   `list.ts:836` — not Excel's unstable one-pass. `excel-pain-points.md` §3.)
2. **Semantics** — dates (Solenoid's single serial model vs Excel's `Date`/1900 conventions),
   units (the flagship — Formula.js has none), error values (`SolError` vs Formula.js's own
   returns), explicit socket types.
3. **Coverage** — families Formula.js doesn't meaningfully cover (units, complex, frames).
4. **Error integration** — Formula.js error returns aren't converted to `SolError` today
   (`archive/formula-engine-array-semantics.md` P5), so leaning on it *as-is* leaks untagged errors.
5. **Maintenance** — the pure upside: every line backed by Formula.js is a line not maintained.

---

## 2. Family-by-family verdict

Legend: **Internal** (keep hand-rolled — a difference that matters) · **Formula.js** (safe to
back / delete the native math) · **Internal-first + fallback** (own impl where it exists, library
for the long tail).

| Family (native nodes) | Overlaps Formula.js? | Difference that matters? | Recommended backing |
|---|---|---|---|
| **Plain arithmetic** (`+ − × ÷ ^`, Arithmetic node) | yes | none — IEEE-754 either way | **Formula.js** (or just JS ops; trivial) |
| **Scalar math fns** (ABS, SQRT, EXP, trig, hyperbolic, logs, rounding) | yes, fully | none meaningful (both wrap `Math.*`) | **Formula.js** — prime "delete redundant code" target |
| **Rounding family** (ROUND/MROUND/CEILING/FLOOR) | yes | minor: Excel/Formula.js round-half rules vs JS `Math.round` half-up — *this is a real edge difference* | **Internal-first + fallback**, or verify Formula.js matches and switch |
| **Combinatorics / engineering / Bessel** | partial | accuracy at extremes (large factorials, Bessel order) — verify | **Internal-first + fallback** |
| **Statistics** (Aggregate stdev/var, PERCENTILE, RANK, CORREL, STANDARDIZE…) | yes | **YES — the headline reason.** Native is numerically stable & standard-interpolation by design; Formula.js targets Excel parity (may replicate flagged inaccuracies) | **Internal** (correctness is a documented differentiator) |
| **Distributions** (normal/t/chi²/F/beta/gamma/binom/poisson + inverses) | yes | accuracy in parameter ranges (Excel's were peer-reviewed wrong; unknown for Formula.js) | **Internal** until Formula.js parity is proven correct |
| **Finance** (TVM, NPV, IRR, depreciation, bond pricing, XIRR) | yes, broadly | mostly none — these are defined formulas. Iterative ones (IRR/XIRR) differ in solver/convergence + `#CONV!` tagging | **Formula.js** for closed-form; **Internal** for the root-finders (own `#CONV!` + convergence control) |
| **Text** (CONCAT, FIND, SUBSTITUTE, TEXTJOIN, case, REGEX) | yes | none — Excel parity *is* the spec here | **Formula.js** (strong candidate; least reason to hand-roll) |
| **Date / Time** (DATE, DATEDIF, EOMONTH, WORKDAY, WEEKNUM…) | yes | **YES — serial↔`Date` interop + timezone.** `date.ts` hand-rolls everything UTC-carefully and never calls Formula.js, almost certainly on purpose (`timesavers-pack-proposal.md` §7 audit) | **Internal** (semantics differ; the existing code already chose this) |
| **Lookup** (XLOOKUP, XMATCH, Convert) | partial | XLOOKUP/XMATCH already richer than Formula.js equivalents; CONVERT overlaps unit-conversion | **Internal** (ours is the better/unit-aware version) |
| **Complex numbers** (COMPLEX, IM* ops) | Formula.js *has* IM* fns | possibly none — verify accuracy/representation match | **Internal-first + fallback** (low priority either way) |
| **Matrix / Tables** (MMULT, MINVERSE, TRANSPOSE, frames) | partial | shape/Frame semantics are Solenoid's own | **Internal** |
| **Units / Format Controller** | no — Formula.js has no unit system | **YES — the flagship.** No overlap to consolidate | **Internal** (foundation, never a question) |

---

## 3. The pattern

- **Safe to consolidate onto Formula.js (delete redundant hand-rolled math):** plain
  arithmetic, scalar math functions, text functions, closed-form finance. These are the "just
  one line of arithmetic / Excel-parity is the spec" cases the user means — no difference that
  matters, real maintenance savings.
- **Keep internal (a difference that matters, already documented):** statistics, distributions,
  dates, units, lookup, matrices/frames, and the iterative finance solvers. Each has a concrete
  reason: numerical correctness (stats/dist), serial/timezone semantics (dates), the unit
  flagship (units/format), or "ours is already better" (XLOOKUP, Convert).
- **Verify-then-decide:** rounding half-rules, combinatorics/Bessel at extremes, complex.

So the answer to "shouldn't Formula.js just be the default?" is **"for roughly half the
surface, yes — and that half is exactly the boring half."** The other half stays internal for
reasons that are each a documented product decision, not inertia.

---

## 4. The precondition before *any* consolidation: one registry + error integration

Two things must land first, or consolidating makes things worse:

1. **A single `EXCEL_FUNCTIONS` registry** (the `dev-notes.md:2175` recommendation) so that a
   function has *one* implementation that both the typed-formula path and the corresponding
   node call — otherwise you still have two code paths, just with Formula.js as one of them.
   The registry is what lets a family be backed by Formula.js **once**, visibly, with the
   internal exceptions declared in the same place.
2. **Formula.js → `SolError` conversion** (`archive/formula-engine-array-semantics.md` P5). Today a
   Formula.js `#N/A`/`#DIV/0!` return flows as untagged text/null. Any family routed through
   Formula.js needs its error returns mapped into the tagged-error system first, or
   consolidation regresses the flagship error UX.

Recommended sequence (no code here — just the order if it's ever picked up):
1. Build the `EXCEL_FUNCTIONS` registry; seed it from the existing internal exports
   (`mathUtils.ts`, `dist-*.ts`, etc.) so nothing changes behaviorally — pure decoupling.
2. Add Formula.js→`SolError` mapping at the `dispatch` boundary.
3. Per family, flip the **"safe to consolidate"** set (arithmetic, scalar math, text,
   closed-form finance) to a Formula.js backing in the registry, deleting the redundant native
   math — guarded by the existing `*.test.ts` suites so any divergence surfaces.
4. Leave the **"keep internal"** families as registry entries pointing at the native impls,
   with a one-line "why internal" note each (correctness / semantics / units).

---

## 5. Bottom line

The duplication is a real smell worth removing, and the user's instinct is right for ~half the
surface — but a blanket "Formula.js everywhere" would regress correctness (stats/dist), dates,
and the error UX. The correct move is the **registry + per-family backing**: consolidate the
boring half onto the library we already import, keep the half where a difference matters
internal, and make the line between them *explicit and one place* instead of two parallel
implementations that drift. The registry and the error-mapping are the load-bearing
prerequisites; the per-family flips are mechanical after that.
