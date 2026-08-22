# Formula.js divergences — why Solenoid owns each overridden name

LIVE reference, routed from `excelFunctions.ts` (docs/README.md). Read before
deleting an override, widening the Formula.js fallthrough, or "simplifying" a
registration away: each entry is the evidence that the library's answer is wrong
for us. A divergence is owned and tripwired (rules.md tripwireVendorDrift), never absorbed.

- **Scalar math** (full sweep 2026-06-25): MOD — Excel's result takes the DIVISOR's
  sign (`MOD(10,-3) = -2`), FX returns −1. ATAN2 — Excel's `ATAN2(x, y)` is
  `atan2(y, x)` (x first); FX computes `atan2(x, y)`. QUOTIENT/MOD ÷0 — a real
  `#DIV/0!`, not FX's null. LN/LOG10/SQRTPI/ASIN/ACOS/ACOSH/ATANH out-of-domain —
  ours tags `#DOMAIN!`; FX silently returns null/blank for some.
- **RANK / TRIMMEAN / PERCENTRANK**: RANK returns `#N/A` for a value not in the list
  (FX: 0). TRIMMEAN trims `floor(n·pct/2)` per end (FX over-trims:
  `TRIMMEAN([2,4,4,4,5,5,7,9],0.2)` is 5 in Excel, 4.83 in FX). PERCENTRANK
  interpolates + truncates to significance.
- **Statistical tests FX gets wrong**: its T.TEST ignores tails/type; its F.TEST
  returns the variance ratio instead of the p-value.
- **T.TEST / F.TEST are deliberately NOT range-paired**: their arrays are two SAMPLES
  which may legitimately differ in length for an independent test — the paired
  min-length zip would silently discard the longer tail on every such call, while the
  pooled policy misaligns only a paired test that also contains a null (rarer and
  narrower). Excel requires equal lengths for type 1 anyway.
- **Text/number parsing**: VALUE — FX returns 0 for ANY unparseable text (silent
  corruption); Excel is strict `#VALUE!`. Ours also deliberately does NOT parse
  date/time text (routes through DATEVALUE; keeps VALUE number-only — a documented
  deviation). NUMBERVALUE — FX nulls when only a decimal separator is given. DOLLAR —
  FX prints `$(1,234.57)` where Excel's accounting form is `($1,234.57)`. CONVERT —
  FX.CONVERT errors even on C→F.
- **TEXT** stays FX with patched holes (the 2026-07-05 B-4b sweep: non-numeric text
  passes through instead of THROWING; `@`/General use our numberToText; pure zero-pad
  codes actually pad; scientific formats as 1.23E+06) and KNOWN-BROKEN, deliberately
  unchased codes: section codes ("pos;neg"), fractions ("# ?/?"), time tokens (hh:mm
  renders the date part only). FX formats via UTC getters — a local-wall-clock rebuild
  is the ELIMINATED approach (double-shifted the day on any non-UTC machine: "green in
  UTC CI, red locally").
- **Array-returning names**: FX writes them against 2-D ranges with unvetted quirks
  and has been caught mutating arguments in place (a reason for the matricesInFormulas
  matrix-containment rule). Before internal registration, UNIQUE/SORT/MODE.MULT/
  FREQUENCY dispatched through FX and BROADCAST element-wise (`UNIQUE([3,1,3,2])`
  answered a column of singletons); TREND/GROWTH/LINEST/LOGEST were the last
  array-returning names still broadcast (plausible-looking garbage, the class
  `rangeRouting.test.ts` pins). FX's text-complex IM* was the split-brain: string
  args worked while the graph's own tagged complex values answered `#VALUE!`.
- **The dispatch/name-walk parity class**: a Formula.js FUNCTION is a walkable
  container (`FX.CEILING` is the CEILING function AND the home of CEILING.MATH). An
  object-only walk advertised ten current-Excel names (CEILING.MATH, FLOOR.PRECISE,
  T.TEST, NETWORKDAYS.INTL, …) that then threw "Unknown function" at dispatch, and a
  one-level walk missed two-deep namespaces (NORM.S.DIST) and function-parented
  children while advertising FX's internal `utils` namespace in autocomplete.
  **Autocomplete and dispatch must walk identically** — the mismatch is exactly what
  the parity program exists to catch (machine-checked by `formulaPathIsReteFree` /
  parity tests).
