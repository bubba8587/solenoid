# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-25: formulas and aggregates at scale and at the edges; author asleep, one check-in)

- **Long lists:** a list past about 125k values no longer throws. `guardFinite(result, inputs)` takes an array (callers
  spread whole data lists into it, so web GROUPBY and most range formulas threw), `mapCells` measures each operand once
  (a tall column was N²: 40k rows took 1.9 s, now 54 ms), and MAP, BYCOL, HSTACK, CONCATLISTS, Set Cells and a script's
  table result read widths with `reduce`. The remaining `Math.max(...)` spreads run over bounded counts (canvas layout,
  chart axes, Frame from Lists, Template, Triangle). SUM still throws inside Formula.js past 125k values.
- **One answer per aggregate** ([[D51]] oneAnswerOneDivergence): the statistics formulas keep a first-class ∞ and a NaN
  cell, as the Aggregate card and GROUPBY do. `aggregate()` classifies its own result and answers `#DOMAIN!` for a NaN
  input on every op but the counts; the percentile, quartile, correlation, covariance and regression kernels classify
  theirs, and percentile interpolation returns a bracketing value both ends hold (PERCENTILE.INC of 1, 2, ∞ at 1 is ∞).
  MIN and MAX are owned (Formula.js spread the list into `Math.min`) on the card's kernel; PERCENTRANK.INC and .EXC run
  the card's kernel (Formula.js said 0 below the data).
- **Retired on the author's suggestion:** AVERAGEA, MINA, MAXA, STDEVA, STDEVPA, VARA and VARPA redirect to their plain
  forms ([[C14]] currentExcelParity, a new consequence line); lists are typed, so only the logical reading was left.
- **Excel parity at the edges, card and formula alike:** YEARFRAC basis 1 is Excel's actual/actual (211/366 for Excel's
  own example), truncates its dates, takes them in either order and refuses a basis outside 0 to 4; GCD and LCM share
  one kernel (`gcdLcm`) that truncates each value and refuses a negative or one at 2^53 or more; LEFT, RIGHT, FIND
  and SEARCH refuse a negative count or a start below 1 (the text cards pass their numbers as given); PEARSON and
  FVSCHEDULE are range functions on the card kernels (`fvSchedule` in `financeOps.ts`); BASE and the `*2HEX`
  functions write uppercase.
- **Other fixes:** Nest Join keys round like Join's converted key (`roundAtLargerTerm`, shared in `frame.ts`), so 1 in
  matches 2.54 cm; a pasted Missing placeholder stays a placeholder for its node (`placeholderFor`, shared by load,
  composite hydration and paste); the signature hints mark the second value optional, as Excel's do; the `display`
  node kind is gone (charts resolve the gold slot directly).
- **Open:** inbox `aggregate-list-cells` asks how every aggregate formula reads a logical (`SUM(x > 5)` is 0 while
  `AVERAGE(x > 5)` counts); owning SUM waits on it. Backlog "Formula parity leads" holds TEXTAFTER's later arguments,
  SEARCH wildcards, and the author's call on N, T, TYPE and ERROR.TYPE (out of scope, still callable). The outbox
  still lists A1, B1, B2, B3, B7 (left alone per the backlog).

### SESSION DIGEST (2026-09-24b: the review leads closed, and the tree made ratifiable; author present, then remote)

- **Review leads:** every "2026-09-24 review rounds" lead is fixed with a failing test first, or inboxed (units,
  formulas vs Excel, frames, charts and schedule, stores, documents, engines, composite inner state), plus two
  rounds of follow-ups. One text-to-number reader everywhere (`decimalFromText`, hex is text, "1,234" is 1234,
  desktop engine included); the native engine carries error cells with their code; joins on units match 68 °F to
  20 °C. Full suite 6573 green, tsc clean, `dte validate` and `coverage --check` green.
- **Tree, the author's rulings:** a leaf is a product call a person could decide, in plain words, following
  from its parent (A thus B thus C); mechanics, code order and designs are specs (`docs/dte.md` § What is a leaf
  and what is a spec). "Leaf" means a tree item and "node" an app node. Our `dte-feedback.md` is the input to
  DTE's next version, and practice here leads the vendored text.
- **Tree, what stands:** about 190 leaves down to 127. About 70 moved into specs (new
  `tree/specs/floors/engineering.md`), four duplicates merged, the rules-about-rules (tree home, author-ruled,
  exceptions, spec-first, comments, wikilinks, outbox, enforcement labels) retired as DTE's job with Solenoid's
  practice in `docs/dte.md`; 16 leaves reparented to the leaf they follow from; two new B leaves ([[B18]]
  safeToShare, [[B19]] spreadsheetHabits). Every leaf's Why argues from its parent and its Decision names the
  rejected option. The author ratified A1, B1, B2, B3, B7 and E10, rewrote A5, A6 and those B leaves in their
  own words, and removed `made_by`/`by` and `name` (local `tools/dte.py` patch: the name is the first alias).
- **Open:** the ratification walk continues with the rest of ring B; 34 inbox items; desktop window-close check on
  the next build (backlog).
