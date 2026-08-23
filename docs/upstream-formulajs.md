# Upstream candidates — Formula.js bugs we carry overrides for

Ready-to-paste issue texts for `formulajs/formulajs` (verified against 4.6.1, 2026-08-23).
These are the overrides in `excelFunctions.ts` whose reason is a genuine Formula.js
defect against Excel — NOT Solenoid design choices (null-skip, `#AMBIGUOUS!`, DATE's
literal year, the units system, number-only VALUE stay ours; see
`formulajs-divergences.md`). Submitting is the author's call, from the author's account.
An upstream fix changes nothing here: every override stays (the null/error contract needs
it); `tripwireVendorDrift` is what tells us when the vendor catches up.

Per entry: title · repro (node, `import * as FX from "@formulajs/formulajs"`) · expected ·
where our fix lives (the patch shape when it is a clean drop-in).

---

**MOD takes the dividend's sign; Excel takes the divisor's**
`FX.MOD(10, -3)` → `-1`. Excel: `-2` (`n - d*INT(n/d)`).
Fix: `n - d * Math.floor(n / d)` (ours: `registerInternal("MOD")`). One-liner PR.

**ATAN2 argument order is reversed**
`FX.ATAN2(1, 2)` → `0.4636` (= `Math.atan2(1, 2)`). Excel `ATAN2(x_num, y_num)` is
`atan2(y, x)` → `1.1071`. Fix: `Math.atan2(y, x)`. One-liner PR; note it's a breaking change
for anyone who worked around it.

**T.TEST ignores `tails` and `type`**
`FX.T.TEST([1,2,3,4], [2,4,6,9], tails, type)` returns `0.1419` for every combination of
tails ∈ {1,2}, type ∈ {1,2,3}. Excel: one-tailed is half the two-tailed p; type 1 (paired)
→ `0.0486`, 2 (pooled) → `0.1419`, 3 (Welch) → `0.1647` two-tailed. Fix shape: ours is `statsOps.tTestP(a, b, tails, type)` — a
paired/pooled/Welch t plus a Student-t CDF; the library already has T.DIST for the tail.

**F.TEST returns the variance ratio, not the p-value**
`FX.F.TEST([1,2,3,4,5], [2,4,6,8,11])` → `0.2049` (= var₁/var₂ = 2.5/12.2). Excel: the
two-tailed p-value of that F on (4, 4) df, `0.1539` (ours: `statsOps.fTestP`). Fix: `2 * min(F.DIST.RT(f, d1, d2), 1 - F.DIST.RT(f, d1, d2))` with
`f = var₁/var₂`.

**TRIMMEAN trims too many points**
`FX.TRIMMEAN([2,4,4,4,5,5,7,9], 0.2)` → `4.8333`. Excel: `5` (trims
`FLOOR(n·percent/2)` = `floor(0.8)` = 0 per end → plain mean). FX rounds instead of
flooring. Fix: `Math.floor(n * percent / 2)` per end (ours: `excelTrimmean`). One-liner PR.

**VALUE returns 0 for unparseable text**
`FX.VALUE("abc")` → `0`. Excel: `#VALUE!`. Silent corruption for any mis-typed cell.
Fix: return the library's `error.value` when the parse fails. (Our VALUE also refuses
date text on purpose — don't upstream that half.)

**IRR answers 1000 (100 000 %) when the root is near the rate floor; non-sign-changing
flows return an Error object instead of #NUM!**
`FX.IRR([-4943, -2458, 285])` → `1000`; the true IRR is `-0.903`. `FX.IRR([100, 200, 300])`
→ `{}` (an Error instance in the result, not `#NUM!`). Fix shape: Newton, then bracket +
bisect on NPV sign change, `#NUM!` when no root (ours: `financeOps.solveDiscountRate`).

**QUARTILE.INC / QUARTILE.EXC reject quart = 0 and 4**
`FX.QUARTILE.INC([1,2,3,4], 0)` → an Error. Excel: `1` (MIN); quart 4 = MAX. Fix: allow
0..4 in INC (EXC legitimately errors on 0 and 4). (Ours: `statsOps.quartile`.)

**DAYS360 / YEARFRAC basis 0 mishandle the US 30/360 end-of-month rule**
`FX.DAYS360(2024-01-31, 2024-03-01)` → `31`; Excel (US method, default) → `30`
(a start day of 31 becomes 30). `FX.YEARFRAC(2024-01-31, 2024-03-01, 0)` → `0.0861`;
Excel → `0.0833`. Fix: apply the US 30/360 day adjustments (start 31→30; end 31→30 only
if start ≥ 30; February end-of-month rules) before `360·Δy + 30·Δm + Δd`. Ours:
`dateOps.dateDiff`.

**DOLLAR formats negatives as `$(1,234.57)`**
`FX.DOLLAR(-1234.567, 2)` → `"$(1,234.57)"`. Excel: `"($1,234.57)"` (the currency symbol
inside the parentheses). Fix: place `$` after `(`. One-liner PR.

---

Not submitted (debatable or ours): PROPER's capitalise-after-any-non-letter rule (Excel
does it too: `PROPER("o'neil")` = `O'Neil`), NUMBERVALUE nulling on a decimal-separator-only
call (we differ; Excel accepts it — borderline, include if the rest lands), RANK/PERCENTRANK
(FX exposes them only as `RANK.EQ`/`PERCENTRANK.INC`; the #N/A-for-missing gap is in RANK.EQ
and is a fair issue too).
