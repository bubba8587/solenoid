# Solenoid — Excel Pain Points & Function Gaps

The known frustrations, bugs, and structural problems with Excel and spreadsheets
generally. Context for what Solenoid improves on and what pitfalls to avoid
replicating. Sourced from academic research, power-user forums, and press coverage.

(Merged from the former `excel-pain-points.md` + `excel-gaps.md`. Part 1 is the
structural/data-integrity story; Part 2 is the function-level gap analysis.)

---

# Part 1 — Structural & data-integrity failures

## The gene naming incident: Excel's most notorious bug

Excel auto-converts certain text values that look like dates into actual date
serial numbers silently, with no warning and no easy undo. The classic examples
are gene names like SEPT2 (Septin 2) and MARCH1, which Excel converts to "2-Sep"
and "1-Mar".

First documented in 2004. A 2016 study found it affected roughly 20% of Excel
spreadsheets in scientific literature. The damage is real: the underlying value
changes from a string to a float (Excel's internal date representation), so gene
names are permanently corrupted, not just displayed differently.

The problem became so entrenched that in 2020 the Human Genome Organisation
renamed 27 genes specifically to avoid Excel's auto-conversion. SEPT1 became
SEPTIN1. The scientific community found it easier to rename genes than to fix Excel.

The key insight: **errors occur silently, can hide among thousands of rows, and
are difficult to audit.** This is the core structural problem of spreadsheets.

## The data type ambiguity problem

Excel has no explicit type system. Every cell can contain a number, text, a date
(secretly a number), or a formula. The displayed value may not reflect the
underlying value. Categories of silent error:

- **Numbers stored as text.** A cell showing "42" may be the number 42 or the
  string "42". SUM/AVERAGE/MIN/MAX silently skip text values, so a total can be
  wrong with no error. Causes: CSV import, a leading apostrophe (`'42`), or a
  cell formatted as Text before entry. The only hint is a small green triangle
  most users never notice.
- **The "looks like a date" trap.** Part numbers ("12-14" → Dec 14), product
  codes ("3-5" → Mar 5), version numbers ("1-2" → Jan 2), gene names — anything
  with a hyphen between numbers gets converted to a date serial. The original is
  gone. Microsoft made this opt-out in 2023, but it's buried in File > Options.
- **Concatenation drops number formatting.** `="Total: "&A1` where A1 is currency
  returns "Total: 1234.56", not "$1,234.56". You need `TEXT(A1,"$#,##0.00")`.
- **Leading zeros vanish.** "007" becomes 7, "00.5" becomes 0.5, unless the cell
  was pre-formatted as Text.
- **Hidden spaces.** A cell that looks empty may contain spaces; a numeric-looking
  value may have a leading space. `EXACT("hello","hello ")` is FALSE but you can't
  see it. TRIM/CLEAN exist for this, but users don't know they're needed.

## The date system disaster

Excel has two competing date systems that silently corrupt data across files.

- **1900 vs 1904.** Windows Excel counts from Jan 1, 1900; older Mac Excel from
  Jan 2, 1904 — a difference of exactly 1,462 days. Copy dates between workbooks
  on different systems and every date shifts four years and a day, silently. Both
  systems remain active today.
- **The phantom Feb 29, 1900.** Serial number 60 represents a day that never
  existed (1900 was not a leap year). A deliberate bug copied from Lotus 1-2-3 for
  compatibility, never fixed because fixing it shifts every pre-March-1900 serial.
- **No dates before Jan 1, 1900.** `DATE(1899,12,31)` errors. Historians and
  archivists cannot use Excel dates at all; they store text and lose arithmetic.
- **MM/DD vs DD/MM ambiguity.** 04/05/2025 is April 5 in the US, May 4 in the UK.
  Excel resolves by machine locale, so the same file shows different dates on
  different machines, with no in-file indicator. ISO 8601 (2025-04-05) is the only
  safe format and most users never use it.
- **DATEDIF: undocumented and buggy.** One of the most-used date functions (age,
  tenure), yet absent from the function list and autocomplete, with known bugs in
  the "MD" interval. Users find it from blog posts, not Excel's UI.
- **NETWORKDAYS / WORKDAY: no timezone awareness.** Business-day math treats all
  days as equal regardless of timezone.

## The decimal separator / CSV delimiter catastrophe

A circular problem with no clean solution. US/UK use period for decimals, comma
for thousands (1,234.56); most of Europe is the reverse (1.234,56). Because
European Excel needs the comma for decimals, it saves "CSV" files with semicolons
— same `.csv` extension, different format, no in-file flag.

An American exports CSV and sends it to a German colleague. It opens as one
column (Excel expected semicolons). Manual import at the comma splits "1,234.56"
into "1" and "234.56" — the thousands separator becomes a column delimiter.
European Excel reads "1,234" as 1.234; US Excel reads it as 1234. Same string,
two values, no warning from either.

## The invisible dependency problem

Arguably the most structurally important problem for Solenoid's purposes, because
the node graph explicitly solves it.

Field audits find errors in 24%–94% of real organizational spreadsheets, and
developers are "highly overconfident" in their own. The most dangerous errors
produce plausible-looking wrong answers, not obvious error codes.

A cell's formula is hidden by default. "Trace Precedents" shows one level at a
time and vanishes when you click away. There is no persistent dependency-graph
view. So you can change a value without knowing what it affects; deleting a row
sprays #REF! through unrelated-looking areas; and complex logic is impossible to
reconstruct months later.

The hard errors cascade: **#REF!** (deleted reference) propagates downstream;
**#VALUE!** (wrong type) silently corrupts containing formulas; **#DIV/0!** is
often masked with IFERROR; **#N/A** may be a real gap or a silent type mismatch.
The most dangerous pattern is wrapping formulas in IFERROR to hide errors — the
sheet looks clean while problems propagate underneath.

The node graph makes every dependency a visible wire. Nothing is hidden.

## Formula syntax and learning curve

- **VLOOKUP**, among the most-used and most-broken functions: takes a column
  *index number* (insert a column and it silently points wrong), only looks
  right, defaults to approximate match (silently wrong on unsorted data). XLOOKUP
  fixes most of this but is M365/2019+ only.
- **Nested IF**: complex conditionals nest deeply (limit 7 in old versions, 64
  now). Written left-to-right but evaluated inside-out, parentheses counted by
  hand, impossible to debug line by line, and they break if conditions are
  checked in the wrong order.
- **The one-dimensional formula bar**: every formula is a single text string — no
  line breaks, no comments, no named sub-expressions. A sophisticated calculation
  is 200+ characters of nested calls with nowhere to explain any part.

## The auto-correction problem

Excel's auto-formatting "helpfulness" corrupts data: part numbers become dates,
leading zeros vanish, long IDs become scientific notation (1.23457E+16) and lose
precision, `=$1,000` breaks because the comma reads as an argument separator,
cells formatted as Text make later formulas display instead of calculate. The
opt-outs are buried, off by default, and don't recover already-corrupted data.

## Collaboration and versioning

Email a spreadsheet to five people and you have six versions with no merge tool.
Track Changes misses formula, format, and deletion changes. Co-authoring still
has silent concurrent-edit conflicts. And there's no audit trail — Excel can't
say who changed a value, when, or from what, without a third-party add-in.

---

# Part 2 — Function-level gaps

## 1. OR logic in conditional aggregation

SUMIFS / COUNTIFS / AVERAGEIFS use AND logic only — every criterion must be true
at once. "Sum where status is Complete OR Pending" requires added SUMIFs, the
array-constant trick `SUM(SUMIFS(E:E, D:D, {"Complete","Pending"}))`, or SUMPRODUCT
gymnastics. ORing across multiple columns explodes combinatorially. This is just
SQL `WHERE col IN (...)`, which Excel makes a puzzle.

**Solenoid.** Filter's single comparison op is the same limitation alone, but
nodes compose: two Filters merged (VStack → Unique) give OR. Opportunity: a
multi-predicate Filter with AND/OR mode.

## 2. Floating-point precision surprises

All numbers are IEEE 754 doubles. `=0.1+0.1+0.1-0.3` returns 5.55E-17; `=A1=0.3`
is silently FALSE when A1 summed 0.1 three times. Microsoft calls it "by design";
"Precision as Displayed" permanently destroys precision. The practical fix —
ROUND every intermediate — clutters formulas.

**Solenoid.** Same underlying issue (JS is also IEEE 754), but showing every
intermediate value makes drift visible. Opportunity: a decimal-safe mode or a
float-equality warning.

## 3. Statistical function inaccuracy (peer-reviewed)

Independent studies (McCullough & Wilson, 2002–2008) document systematic errors:
the STDEV/VAR family uses a numerically unstable one-pass algorithm; PERCENTILE
interpolates incorrectly in edge cases; RANK.EQ uses a non-standard tie
convention; BINOM.DIST/POISSON.DIST were wrong in parameter ranges; the RNG
failed DIEHARD randomness tests. The research conclusion: *"No statistical
procedure in Excel should be used until Microsoft documents that it is correct."*

**Solenoid.** We implement our own statistical nodes in JS, so we can use
numerically correct algorithms (Welford's for variance, standard percentile
interpolation) from the start. A genuine accuracy advantage worth documenting.

## 4. Regex (BUILT — was a 30-year Excel gap)

Excel had no regex until REGEXTEST/REGEXEXTRACT/REGEXREPLACE landed in M365 in
late 2024 — and those are subscription-only, absent from Excel 2024 perpetual,
2021, and older. For 30 years users glued together LEFT/RIGHT/MID/FIND/SUBSTITUTE,
or reached for VBA / Power Query / add-ins.

**Solenoid: shipped.** The Regex node covers REGEXTEST / REGEXEXTRACT (first or
all) / REGEXREPLACE with a flags field, native from the string socket. A strong
differentiator for anyone on pre-M365 Excel.

## 5. The date system disaster (function-level)

Covered structurally in Part 1. The function-level upshot: no pre-1900 dates, the
phantom Feb 29 1900, the 1900/1904 split, undocumented buggy DATEDIF, and
timezone-blind NETWORKDAYS/WORKDAY.

**Solenoid.** Date support uses a single internal representation (no 1900/1904
split), and DATEDIF's functionality is exposed transparently under a documented
DateDiff node with an interval selector. Never silently shift dates.

## 6. Dynamic array #SPILL and #CALC errors

Dynamic arrays (FILTER, UNIQUE, SORT, SEQUENCE; 2019, M365) are Excel's best
recent feature but add silent failures: **#SPILL!** when any destination cell is
occupied (errors the whole result), **#CALC!** when FILTER matches nothing (Excel
has no empty array — you must remember `if_empty`), dynamic arrays can't live
inside Excel Tables, cross-workbook arrays break when the source closes, and
whole-column arrays evaluate a million cells per recalc.

**Solenoid.** None apply — no cells to spill into, no Tables-vs-formula split.
Arrays flow through cables; an empty array is an empty array, not an error.

## 7. XLOOKUP gaps

XLOOKUP fixed VLOOKUP's column-index fragility but still: returns one column at a
time; match modes ±1 silently return wrong results on unsorted data; the
if_not_found arg is easy to forget (so #N/A propagates); wildcard mode is
text-only; whole-column lookups re-evaluate on every change.

**Solenoid.** XLookup and XMatch nodes both implement the full set: exact /
next-smaller / next-larger match modes, forward / reverse / binary search modes,
and an explicit if_not_found input. (XMatch supersedes the classic MATCH, which we
don't ship — same as VLOOKUP/HLOOKUP/LOOKUP.) The only real gap is wildcard / text
pattern matching, since these nodes are numeric. The if_not_found case is explicit:
an unmatched lookup shows "not found" on the node face, it doesn't poison
downstream nodes.

## 8. Text and number type confusion

The function-level face of Part 1's type-ambiguity problem: SUM silently skips
text-formatted numbers, auto-conversion eats part numbers and gene names, IS
functions are unreliable diagnostics, leading zeros vanish.

**Solenoid.** Explicit socket types prevent the whole category. A number socket
only carries numbers; type mismatches are caught at connection time.

## 9. Structural fragility: position-dependent formulas

Cell references break on row/column deletion (#REF! cascades), absolute vs
relative (`$A$1` vs `A1`) confusion silently references wrong cells on copy-paste,
and structural edits (insert a column mid-VLOOKUP) corrupt formulas.

**Solenoid.** Data flows through named cables on named sockets. No row numbers, no
column indices. Moving or adding a node breaks nothing unless you remove a wire.

## 10. LAMBDA and LET: powerful but steep, version-gated

LET (named variables in a formula) and LAMBDA (custom functions) are M365-only,
open as broken formulas in older Excel, have difficult recursive syntax, no
multi-line/comment support, and store named LAMBDAs in the Name Manager (built for
ranges, not code).

**Solenoid.** A node graph gives every sub-computation a label and visual
structure for free. LET ≈ naming intermediate Display nodes; the Expression node
covers inline formulas; reusable named lambdas would map to collapsed subgraphs
(not yet built). No version gates.

## 11. Performance: volatile and large-range functions

Volatile functions (NOW, TODAY, RAND, INDIRECT, OFFSET) recalc the whole workbook
on every edit anywhere. Whole-column references force million-row evaluation.
INDIRECT/OFFSET are both volatile and commonly used as structural workarounds.

**Solenoid.** The DataflowEngine recalculates only nodes downstream of a change.
RANDBETWEEN is "generation-volatile" (re-rolls only on explicit recalc, not on
every graph change). A stronger model than Excel's recalculation semantics.

## 12. No native type detection or error context

Excel's error values (#VALUE!, #REF!, #N/A, #DIV/0!, #NUM!, #NAME?, #NULL!) name a
category but not a cause. #N/A from XLOOKUP and from MATCH look identical. IFERROR
hides sources rather than explaining them. There's no "WHY_ERROR(A1)".

**Solenoid.** Each node can show its error state inline on its face. Future work:
distinguish null-because-no-input from null-because-error from null-because-
not-found, and surface that in the UI.

## 13. Conditional formatting: limited for formulas

Rules can't reference other sheets, can't call custom LAMBDAs, evaluate in an
opaque priority order, and run outside the normal recalc chain (so they can be
stale).

**Solenoid.** Not directly applicable, but the equivalent (Alert/threshold display
nodes) can be built with explicit inputs and clear logic.

## 14. Multi-condition logic is formulaically explosive

Five conditions means five levels of nested IF; the classic failure is testing
conditions in the wrong order so an early branch captures values meant for a later
one. IFS is cleaner syntax with the same ordering trap; SWITCH only does exact
equality.

**Solenoid.** The If node handles the 2-branch case; Ifs and Switch nodes exist.
Cascaded IF nodes make evaluation order explicit rather than implicit.

## 15. What Excel recently fixed (and what it means for Solenoid)

| Fixed in M365 | When | Still broken in |
|---|---|---|
| VLOOKUP column-index fragility | XLOOKUP, 2019 | — |
| No regex | REGEXTEST/EXTRACT/REPLACE, late 2024 | Excel 2024 perpetual, 2021, all older |
| One-pass STDEV inaccuracy | Improved 2003 | Some edge cases remain per research |
| No array output | Dynamic arrays, 2019 | Excel 2019 and older |
| FILTER empty-array error | `if_empty` arg | #CALC! if you forget it |
| Named formula reuse | LAMBDA, 2021 | Excel 2021 and older |
| Named intermediate variables | LET, 2021 | Excel 2021 and older |

The pattern: Microsoft fixes slowly, gates fixes behind subscriptions, and leaves
structural problems (floating point, date system, OR logic, SPILL-in-Tables)
indefinitely unfixed because fixing them would break existing workbooks. Solenoid
starts clean and addresses them at the design level.

---

# What Solenoid avoids / addresses

- **Explicit type system** — sockets have declared types; incompatible
  connections are prevented at connection time, not via silent wrong results.
- **Visible dependencies** — every dependency is a wire; the full graph is always
  visible.
- **No auto-conversion** — a number is a number because it came from a number
  socket. Solenoid never parses ambiguous user text as numbers or dates.
- **No formula syntax** — connect nodes instead of writing strings. No paren
  matching, no column indices, no nested-IF nightmares.
- **Local-first single user** — no version conflicts, no email-attachment chains.
- **Correct numerics by construction** — own implementations use numerically
  sound algorithms (Welford's, standard percentile interpolation).

Active design rules drawn from Excel's failure modes:

- Error messages are plain-language and specific — never a raw exception or code.
- Type errors are caught at connection time, not at evaluation, never silently.
- Values are always visible inline on node faces.
- No silent failures — a node that can't produce a value says so clearly.
