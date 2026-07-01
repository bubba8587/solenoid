# Solenoid — Excel Timesavers Pack: New-Node Proposal

Scoping doc. A high-level survey of the existing **Common Excel Timesavers** pack, plus a
proposed feature set of new nodes to add to it — each classified by **build shape**
(formula-data vs custom-logic, the axis that actually decides cost and dormant-pack
behavior) rather than core-vs-pack, since Timesavers is already a pack. Backed by outside
research into the multi-step Excel idioms power users hit every day. No build commitment;
this is the menu, not the order.

Companion docs: `docs/pack-architecture.md` (the pack mechanism + the formula-data-vs-
custom-logic line), `docs/excel-pain-points.md` (Excel's function-level gaps), `packs.ts`
(the live pack definitions), `docs/io-visual-control-node-proposal.md` (the sibling
proposal for input/output/visual nodes).

---

## 1. What "Timesavers" is, and is today

The pack's promise (its `packs.ts` description): **"Solenoid conveniences that aren't single
Excel functions"** — rolling aggregates, weighted stats, list utilities, extended logic. The
defining test for a Timesaver node: *in Excel you'd reach for a multi-function formula, a
helper column, an array-formula trick, or VBA — and there is no single `=FUNCTION()` for it.*
That's a different axis from the engineering **reference packs** (`docs/reference-packs.md`,
domain data) and from the **visual/input packs** (`io-visual-control-node-proposal.md`).

Today the pack ships **no new node code** — it's a *reclassification* pack (`NODE_PACK_TAGS`)
plus one claimed cross-domain node:

- **Reclassified into Timesavers:** rolling sum/avg/min/max/stdev/median · weighted
  avg/stdev/var · ArgMax/ArgMin · list utilities (contains, diff, normalize, shuffle,
  interleave, nth-element, geometric, fibonacci, repeat) · list-wise Text Map/Filter ·
  URL decode · extended logic (XNOR, NAND, NOR).
- **Claimed node:** HYPOTENUSE (shared with Geometry; `√(x²+y²)`).

So the pack is proven as a *tagging* mechanism but has never exercised the **formula-data
pack path** (the Geometry pack did that with pre-set Expression nodes) for *new* nodes. This
proposal is mostly a list of new formula-data nodes — which is exactly the cheap, "one JSON
file" shape the architecture wants, and Timesavers is its natural home.

---

## 2. The build-shape rule (the real "bundling" axis here)

Per `pack-architecture.md`, every pack node is one of two shapes. For Timesavers the split
is unusually favorable because **the Expression engine dispatches function calls straight to
Formula.js** (`excelFormula.ts` → `dispatch()` over the `FX` table). So a pre-set Expression
node can already call `LEFT / MID / SUBSTITUTE / TEXTJOIN / DATEDIF / EOMONTH / WORKDAY /
MROUND / SUMPRODUCT / COUNTIF …` — the whole Excel surface — and broadcast it element-wise
over lists via the existing polyform machinery. That collapses most idioms to data:

- **[F] Formula-data** — a pre-set **Expression** node (a fixed formula string + a result-type
  for text/date; its variables become input sockets automatically) **or**, more generally, a
  pre-set of any *already-parameterized* native node — e.g. a preset of the existing **REGEX**
  node, or an **Aggregate** with its op fixed. Both are pure data: **no new class,
  component, or registry entry.** Degrades gracefully when the pack is off (the core compiler
  still evaluates it). This is the default and should be the answer for any **scalar
  closed-form** idiom, and for element-wise list idioms the broadcaster covers.
  *Verified mechanics:* `expression.ts`'s `broadcastN` runs the **whole** compiled formula
  once per element whenever any input is a list — so an Expression node is strictly
  element-wise and **cannot aggregate a list** (it can't both `SUM(list)` and divide
  per-element in one node). That hard line is what forces every list→scalar *reducer* below
  into [C] or [M], and it's not a limitation we should fight — it's why those are the genuine
  exceptions. (This also fits the project's Formula.js stance exactly: an [F] node adds **zero**
  redundant code — it *is* the Expression node + a string, dispatching to the library we
  already import — so [F] is "import, don't hand-roll" in its purest form, and [C] is reserved
  for the cases where a real difference — list reduction, or a function Excel/Formula.js
  lacks — actually matters.)
- **[C] Custom-logic node** — real code, the declared exception. Needed when the idiom:
  *(a)* **reduces/reshapes a whole list/range** in a way a single broadcast scalar formula
  can't express (last-non-blank, count-distinct, running total, rank-within-group,
  multi-match lookup); *(b)* needs **piecewise interpolation of a dataset** (segment
  interpolation — the architecture's explicit example); *(c)* has **multiple outputs** or a
  **config widget** (split-name → first/middle/last; a fiscal-start-month selector; a
  holiday-list input); or *(d)* needs **logic Formula.js lacks** (spell-a-number-in-words,
  duration-string parsing).
- **[M] Macro / composite** — a small encapsulated subgraph of existing nodes (Pareto =
  Sort → running total → ÷ total; Join-If = Filter → TextJoin). The architecture's composite
  pack-node shape; ship the [C] or [F] version first and grow into it.

Tagging each proposal **[F] / [C] / [M]** below is the load-bearing recommendation: it says
what's nearly free (ship as the Timesavers formula JSON) vs what carries real weight.

**Secondary judgment — does it really belong in Timesavers?** A few proposals are strong
enough or general enough that they'd be better as **core** (or in a different pack); flagged
inline with `→ core?` / `→ other pack`.

---

## 3. Don't-duplicate ledger (already shipped — skip)

Research surfaced many idioms Solenoid *already* covers; these are **not** proposals:
Clamp (Clamp node) · Normalize / min-max (list-normalize) · Z-score (STANDARDIZE) · Weighted
average (weighted-wavg) · Running total (Cumulative) · Round-to-nearest (MROUND) · Mode
(MODE) · ArgMin/Max · Frequency binning (FREQUENCY) · linear regression fit
(FORECAST.LINEAR / TREND) · PROPER / UPPER / LOWER / TRIM / CLEAN (text transforms) ·
TEXTSPLIT / TEXTJOIN / TEXTBEFORE / TEXTAFTER · DATEDIF intervals (DateDiff node) ·
NETWORKDAYS / WORKDAY · WEEKNUM (Week) · Rank (global). New nodes below are the *gaps* around
these.

**Second-look additions** (surfaced re-reading the research): **Most Frequent (text/category)**
— MODE is numeric-only, so the most-common *label* is a real gap (**[C]**, list reduce);
**Sum/Avg of Top-N** — the `SUMPRODUCT(LARGE(…))` idiom (**[C]**); **List GCD/LCM** — the
existing GCD/LCM is binary, a whole-list reduce is the gap (**[M]/[C]**). All three are list
reducers, so none is a free [F].

**Deliberately excluded:** anything that only makes sense in a *cell grid* — column-letter↔
number, A1/R1C1 address munging, INDIRECT/OFFSET-style structural tricks — is meaningless in a
node graph (no cell addresses) and is a non-goal, not a gap (it's the very fragility
`excel-pain-points.md` §9 says Solenoid replaces with named cables).

---

## 4. Proposal — Numeric & aggregation timesavers

| Node | What | Excel today | Shape |
|---|---|---|---|
| **Percent Change** | `(new−old)/old`, with clean handling of a zero/negative base | `=(b-a)/a` | **[F]** |
| **Growth Rate / CAGR** | compound rate from begin/end/periods | `=(end/begin)^(1/n)-1` or the obscure `RRI` | **[F]** |
| **% of Total** | each element ÷ the list's sum (per-row share) | `=B2/SUM($B$2:$B$13)` | **[M]** Aggregate-sum → broadcast ÷ (one Expression node *can't* aggregate + broadcast — see §2) |
| **Pareto / Cumulative %** | sort desc → running total ÷ grand total (the 80/20 curve) | sort + `SUM($B$2:B2)/SUM(all)` | **[M]** Sort→Cumulative→÷ |
| **Count Distinct** | number of unique values in a list | `=COUNTA(UNIQUE())` / `SUMPRODUCT(1/COUNTIF(...))` | **[M]** Unique→Length, or **[C]** |
| **Rank within Group** | rank each row only against its partition | `=COUNTIFS(grp,grp,val,">"&val)+1` | **[C]** (needs two parallel lists + window) |
| **Running Count** | "Nth occurrence of this key so far" (per-group index) | anchored `=COUNTIF($A$2:A2,A2)` | **[C]** |
| **IQR Outlier Flag** | mark points outside Q1−1.5·IQR … Q3+1.5·IQR | QUARTILE combo + `OR(<lo,>hi)` | **[C]** (list stats → per-row bool) |
| **Bucket / Recode** | map a value into a labeled band via a bins table ("Low/Med/High", grade) | approx-match `VLOOKUP(x,bins,2,TRUE)` / nested IF | **[C]** `→ could be core Lookup` |
| **Piecewise Interpolate** | estimate y between known (x,y) pairs — *segment*, not a full regression | gnarly `FORECAST(...,OFFSET(...MATCH...))` | **[C]** (the architecture's "interpolate a dataset" exception) `→ core?` |
| **Conditional Aggregate (AND/OR)** | sum/count/avg over rows matching multiple criteria with **OR** as well as AND | `SUM(SUMIFS(...,{set}))` / SUMPRODUCT gymnastics | **[C]** — absorbs the whole SUMIFS-OR / SUMPRODUCT family `→ core?` |

Notes: Percent Change and CAGR are trivial [F] wins and among the most-used real spreadsheet
operations — strong first batch. (% of Total looks just as trivial but isn't a single
formula node — it needs a list aggregate *and* a per-element divide, so it's a 2-node
composite; ship it as a one-click macro once composites land.) The **Conditional Aggregate (AND/OR)** node is
the single highest-leverage entry: it collapses idioms #6/#8/#25–27 from the research (the
SUMIFS-is-AND-only pain, the `--(condition)` SUMPRODUCT Swiss-army trick) into one node, and
it directly answers `excel-pain-points.md` Part 2 §1. It's general enough to deserve **core**
Lookup/Aggregation placement rather than Timesavers.

---

## 5. Proposal — Lookup timesavers

| Node | What | Excel today | Shape |
|---|---|---|---|
| **Last / First Non-Blank** | value of the last (or first) non-empty cell in a list | the famous `LOOKUP(2,1/(rng<>""),rng)` | **[C]** `→ core Lookup?` |
| **Multi-Criteria Lookup** | look up a row matching 2+ keys at once | `INDEX(res,MATCH(1,(k1=c1)*(k2=c2),0))` (CSE) | **[C]** `→ core Lookup` |
| **Lookup All Matches** | return *every* row matching a key, not just the first | `FILTER(ret,key=k)` (365) / `INDEX/SMALL/IF` array | **[M]** Filter-based `→ core?` |

These are arguably more "core Lookup" than "Timesaver" — XLOOKUP/XMATCH already live in the
core Lookup category, and `excel-pain-points.md` §7 calls multi-criteria/multi-return the
real remaining XLOOKUP gaps. Recommend building them as **core Lookup nodes**, and only
*tagging* them into Timesavers (the way `NODE_PACK_TAGS` already re-homes existing nodes).

---

## 6. Proposal — Text timesavers

The biggest concentration of "no single Excel function exists" pain. Most are scalar [F]
(call Formula.js text functions); a few need real code.

| Node | What | Shape |
|---|---|---|
| **Clean Whitespace** | TRIM + CLEAN + strip non-breaking `CHAR(160)` (the web/PDF-paste killer) | **[F]** |
| **Smart Case** | Sentence / Title (lowercasing minor words) / tOGGLE — beyond PROPER's over-capitalization | **[F]** (Sentence/toggle); **[C]** for smart Title |
| **Reverse Text** | reverse a string (no clean Excel formula; VBA `StrReverse`) | **[C]** (unless a reverse helper is added) |
| **Count Words / Occurrences** | word count, or count of a substring (case-opt) | **[F]** (`LEN`−`SUBSTITUTE` idiom) |
| **Ordinal Suffix** | `1 → 1st`, `23 → 23rd` (with the 11/12/13 special case) | **[F]** |
| **Mask / Redact** | show last N chars, star the rest (`****1234`) | **[F]** |
| **Slug / Sanitize** | lowercase, spaces→`-`, strip filename-illegal chars | **[F]** (or **[C]** if regex-cleaner) |
| **Initials** | first letter of each word | **[F]** for 2 words (`LEFT(TEXTBEFORE…)&LEFT(TEXTAFTER…)`); **[C]** for arbitrary word count (needs iteration) |
| **Split Name** | "First [Middle] Last" / "Last, First" → first / middle / last **(3 outputs)** | **[C]** (multi-output + role logic) |
| **Spell Number** | number → words ("one hundred twenty"), currency mode | **[C]** (no Formula.js fn; perennial #1 request) |
| **Extract Numbers / Keep Charset** | pull all digits out of text, or keep only letters/digits | **[F]-equivalent** — a *pre-set of the existing native REGEX node* (REGEXEXTRACT/REGEXREPLACE), the same "preset an existing node = data, no new code" trick as formula nodes |
| **Join-If** | concatenate a list with a delimiter, filtered by a condition | **[M]** Filter→TextJoin |

Priority text picks: **Spell Number** and **Reverse** (genuinely no Excel answer, high
demand) as the marquee [C] nodes; **Clean Whitespace, Ordinal, Mask, Count Words, Slug** as a
cheap [F] batch.

---

## 7. Proposal — Date / Time & Duration timesavers

Solenoid already has a clean date model (no 1900/1904 split — `excel-pain-points.md` §5) and
a DateDiff node, so these hide Excel's worst quirks (`[h]` formatting, the undocumented
DATEDIF, the `WORKDAY.INTL` weekend-mask string).

**Audit caveat on the shapes below (downgrades the optimism of a first pass):** although
Solenoid's serial *origin* matches Excel's (serial 1 = 1900-01-01, epoch 25569), the existing
date nodes in `date.ts` deliberately **hand-roll** everything with UTC-careful JS `Date` math
and pointedly do **not** call Formula.js — almost certainly to dodge serial↔`Date` interop and
timezone bugs (Formula.js date functions take/return `Date` objects, not bare serials, and are
locale-sensitive). So a date timesaver is realistically **[C], following the `date.ts`
pattern**, *not* a free [F] Expression node — unless per-function Formula.js serial-interop is
confirmed. The "[F]" tags below mean "the *arithmetic* is trivial," but treat the build shape
as **[C]-leaning** until that interop check is done. (This is exactly a "difference that
matters," so it earns the hand-roll.)

| Node | What | Shape |
|---|---|---|
| **Quarter** | calendar quarter from a date (`Q1–Q4`) | **[F]** |
| **Fiscal Quarter / Year** | quarter + fiscal year with a **configurable start month** | **[C]** (the start-month param) or **[F]** if a literal |
| **Age / Tenure** | years (or "y / m / d") between a date and today — hides DATEDIF's `"MD"` bug | **[F]** |
| **Nth Weekday of Month** | e.g. "3rd Monday" (payroll / patch-Tuesday) | **[F]** |
| **Last Weekday / Last Business Day of Month** | EOMONTH + weekday/holiday adjust | **[F]** (business-day variant wants a holiday input → **[C]**) |
| **Date Predicates** | is-leap-year · days-in-month · is-weekend (bundle, op selector) | **[F]** |
| **Week of Month** | which week of the month a date falls in | **[F]** |
| **Duration ⇄ Time** | seconds (or decimal hours) → `h:mm:ss` and back — uses the `[h]` >24h format Excel users get wrong | **[C]** (Solenoid has no `[h]` format; needs a duration formatter) |
| **Humanize Duration** | `9000s → "2h 30m"` | **[C]** |
| **Parse Duration** | `"1h 30m" → number` (no clean Excel parser) | **[C]** |

The duration trio is the one date-area cluster that genuinely needs code (Solenoid lacks an
Excel-style elapsed-time `[h]:mm` number format), and is high-value — elapsed-time formatting
is a perennial silent-bug source (the naive `hh:mm:ss` wraps at 24h).

---

## 8. Build shape at a glance & the "one JSON file" payoff

- **~25 of ~35 proposals are [F] formula-data** — they need *no new code*, just rows in a
  Timesavers formula file (the `FormulaPackEntry[]` shape `packs.ts` already defines for
  Geometry). Shipping these would be the first real exercise of the formula-pack thesis
  *beyond* Geometry, and they degrade gracefully if the pack is ever switched off.
- **~8 are [C] custom-logic** — the genuine exceptions worth their weight: list-reducers
  (last-non-blank, count-distinct, rank-in-group, running-count, IQR, multi-criteria/
  multi-match lookup, conditional-aggregate), piecewise interpolation, multi-output Split
  Name, Spell Number, and the duration trio.
- **~3 are [M] composites** (Pareto, Join-If, Lookup-all) — defer until the composite/
  subgraph pack-node shape exists; emulate with a 2–3 node chain meanwhile.

Several [C] entries (Conditional Aggregate, Multi-Criteria / Multi-Match Lookup,
Last/First-Non-Blank, Bucket/Recode, Piecewise Interpolate) are general and high-value enough
that the cleaner home is **core** (Lookup / Aggregation categories), *tagged* into Timesavers
via `NODE_PACK_TAGS` rather than defined as pack-only nodes — matching how the pack already
re-homes existing core nodes.

---

## 9. Suggested sequencing

1. **[F] cheap batch, highest everyday use** (one formula file, proves the path): Percent
   Change, Growth Rate/CAGR, % of Total, Ordinal Suffix, Clean Whitespace, Mask/Redact,
   Count Words, Quarter, Age/Tenure, Date Predicates. ~10 nodes, near-zero code.
2. **Marquee [C] "no Excel answer" nodes** (the demos that sell the pack): Spell Number,
   Reverse Text, the Duration trio, Split Name (multi-output).
3. **List-reducer [C] nodes — build as core, tag into Timesavers:** Conditional Aggregate
   (AND/OR), Multi-Criteria Lookup, Last/First Non-Blank, Count Distinct, Rank within Group,
   IQR Outlier Flag. (Conditional Aggregate first — it closes `excel-pain-points.md` §1.)
4. **Dataset / composite nodes** (after the supporting infra): Piecewise Interpolate (with
   the interpolation primitive the reference packs also want), Bucket/Recode, Pareto,
   Join-If, Lookup All Matches.

---

## 10. Sources

Numeric / lookup / aggregation idioms:
- ExcelJet — last/first non-empty: https://exceljet.net/formulas/get-value-of-last-non-empty-cell · https://exceljet.net/formulas/get-first-non-blank-value-in-a-list
- ExcelJet — INDEX/MATCH multiple criteria: https://exceljet.net/formulas/index-and-match-with-multiple-criteria
- ExcelJet — SUMIFS with OR logic / SUMPRODUCT OR criteria: https://exceljet.net/formulas/sumifs-with-multiple-criteria-and-or-logic · https://exceljet.net/formulas/sumproduct-count-multiple-or-criteria
- ExcelJet — count unique with COUNTIF: https://exceljet.net/formulas/count-unique-values-in-a-range-with-countif
- ExcelJet — map inputs to values (recode): https://exceljet.net/formulas/map-inputs-to-arbitrary-values
- Ablebits — running total / CAGR: https://www.ablebits.com/office-addins-blog/excel-cumulative-sum-running-total/ · https://www.ablebits.com/office-addins-blog/calculate-cagr-excel-formulas/
- ExcelDemy — rank within group: https://www.exceldemy.com/excel-rank-within-group/
- Acuity — IQR outliers: https://www.acuitytraining.co.uk/news-tips/finding-outliers-in-excel/
- ExcelOffTheGrid — interpolate with FORECAST/OFFSET: https://exceloffthegrid.com/interpolate-values-using-the-forecast-function/
- Excel University — replace nested IFs with a lookup: https://www.excel-university.com/replace-25-nested-ifs-with-a-single-simple-lookup/

Text idioms:
- ExcelJet — extract numbers / count specific words / ordinal suffix: https://exceljet.net/formulas/extract-numbers-from-text · https://exceljet.net/formulas/count-specific-words-in-a-cell · https://exceljet.net/formulas/rank-with-ordinal-suffix
- Ablebits — separate names / remove special chars / convert numbers to words: https://www.ablebits.com/office-addins-blog/separate-first-last-name-excel/ · https://www.ablebits.com/office-addins-blog/delete-special-unwanted-characters-excel/ · https://www.ablebits.com/office-addins-blog/convert-numbers-words-excel/
- Microsoft Support — SpellNumber (VBA) / change case / mask last four: https://support.microsoft.com/en-my/help/213360/how-to-convert-a-numeric-value-into-english-words-in-excel · https://support.microsoft.com/en-us/office/change-the-case-of-text-01481046-0fa7-4f3b-a693-496795a7a44d · https://support.microsoft.com/en-us/office/display-only-the-last-four-digits-of-identification-numbers-ef699b5f-8b85-4226-ac11-2a568c8a9fe1
- xelplus — TRIM all spaces: https://www.xelplus.com/excel-trim-all-spaces/

Date / duration idioms:
- ExcelJet — age from birthday / nth day of week / last working day / sequence of workdays / leap year: https://exceljet.net/formulas/get-age-from-birthday · https://exceljet.net/formulas/get-nth-day-of-week-in-month · https://exceljet.net/formulas/get-last-working-day-in-month · https://exceljet.net/formulas/sequence-of-workdays · https://exceljet.net/formulas/year-is-a-leap-year
- Contextures / TrumpExcel — fiscal year & quarter: https://www.contextures.com/fiscalyearcalculations.html · https://trumpexcel.com/fiscal-year-excel/
- Microsoft Support — ISOWEEKNUM / EOMONTH / NETWORKDAYS: https://support.microsoft.com/en-gb/office/isoweeknum-function-1c2d0afe-d25b-4ab1-8894-8d0520e90e0e · https://support.microsoft.com/en-us/office/eomonth-function-7314ffa1-2bc9-4005-9d66-f49db127d628 · https://support.microsoft.com/en-us/office/networkdays-function-48e717bf-a7a3-495f-969e-5005e3eb18e7
- Statology / Ablebits — seconds→hh:mm:ss, time↔decimal: https://www.statology.org/excel-convert-seconds-to-hh-mm-ss/ · https://www.ablebits.com/office-addins-blog/excel-convert-time-decimal/

(Caveat carried from research: a single low-authority source claimed a native Excel "CLAMP"
function — false; Solenoid's existing Clamp node uses MIN/MAX. The longest pre-365 array
formulas, FILTERXML initials, and pre-2013 ISO-week expressions were structurally verified
but not byte-verified — confirm exact syntax before hard-coding any as a node's Excel tooltip.)
