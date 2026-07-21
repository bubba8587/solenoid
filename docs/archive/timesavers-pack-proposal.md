# Solenoid — Excel Timesavers Pack: the build-shape rule + unbuilt remainder

Condensed scoping doc. The full ~35-node proposal (all numeric/lookup/text/date rows,
sequencing, sources) is in git history; most of the [F] formula-data batch shipped. What's
kept: the **[F]/[C]/[M] build-shape taxonomy** (§2 — the axis that decides cost), the
**don't-duplicate ledger** (§3), and the **still-unbuilt rows** worth their weight (§4).

Companion docs: `docs/pack-architecture.md` (the pack mechanism), `excel-pain-points.md`
(same directory — function-level gaps), `packs.ts` (live pack definitions),
`io-visual-control-node-proposal.md` (the sibling input/output/visual proposal).

---

## 2. The build-shape rule (the real "bundling" axis)

Per `pack-architecture.md`, every pack node is one of two shapes. For Timesavers the split
is unusually favorable because **the Expression engine dispatches function calls straight to
Formula.js** (`excelFormula.ts` → `dispatch()` over the `FX` table). So a pre-set Expression
node can already call `LEFT / MID / SUBSTITUTE / TEXTJOIN / DATEDIF / EOMONTH / WORKDAY /
MROUND / SUMPRODUCT / COUNTIF …` — the whole Excel surface — and broadcast it element-wise
over lists. That collapses most idioms to data:

- **[F] Formula-data** — a pre-set **Expression** node (a fixed formula string + a result-type
  for text/date; its variables become input sockets automatically), **or** a pre-set of any
  already-parameterized native node (a preset REGEX node, an Aggregate with its op fixed).
  Both are pure data: **no new class, component, or registry entry.** Degrades gracefully when
  the pack is off. The default answer for any **scalar closed-form** idiom, and for
  element-wise list idioms the broadcaster covers.
  *Verified mechanics:* `expression.ts`'s `broadcastN` runs the **whole** compiled formula
  once per element whenever any input is a list — so an Expression node is strictly
  element-wise and **cannot aggregate a list** (it can't both `SUM(list)` and divide
  per-element in one node). That hard line forces every list→scalar *reducer* below into [C]
  or [M]. An [F] node adds **zero** redundant code — it *is* the Expression node + a string —
  so [F] is "import, don't hand-roll" in its purest form.
- **[C] Custom-logic node** — real code, the declared exception. Needed when the idiom:
  *(a)* **reduces/reshapes a whole list/range** a broadcast scalar can't express
  (last-non-blank, count-distinct, running total, rank-within-group, multi-match lookup);
  *(b)* needs **piecewise interpolation of a dataset**; *(c)* has **multiple outputs** or a
  **config widget** (split-name → first/middle/last; a fiscal-start-month selector; a
  holiday-list input); or *(d)* needs **logic Formula.js lacks** (spell-a-number-in-words,
  duration-string parsing).
- **[M] Macro / composite** — a small encapsulated subgraph of existing nodes (Pareto =
  Sort → running total → ÷ total; Join-If = Filter → TextJoin). Ship the [C] or [F] version
  first and grow into it.

**Secondary judgment — does it really belong in Timesavers?** A few proposals are general
enough to be better as **core** (or another pack); flagged inline `→ core?` / `→ other pack`.

---

## 3. Don't-duplicate ledger (already shipped — skip)

Idioms Solenoid *already* covers; **not** proposals: Clamp · Normalize / min-max · Z-score
(STANDARDIZE) · Weighted average · Running total (Cumulative) · Round-to-nearest (MROUND) ·
Mode · ArgMin/Max · Frequency binning (FREQUENCY) · linear regression fit
(FORECAST.LINEAR / TREND) · PROPER / UPPER / LOWER / TRIM / CLEAN · TEXTSPLIT / TEXTJOIN /
TEXTBEFORE / TEXTAFTER · DATEDIF intervals (DateDiff node) · NETWORKDAYS / WORKDAY ·
WEEKNUM (Week) · Rank (global).

**Deliberately excluded:** anything that only makes sense in a *cell grid* — column-letter↔
number, A1/R1C1 address munging, INDIRECT/OFFSET structural tricks — is meaningless in a node
graph (no cell addresses); a non-goal, not a gap.

---

## 4. The still-unbuilt remainder (the entries worth their weight)

The cheap [F] batch (Percent Change, CAGR, Ordinal, Clean Whitespace, Mask, Count Words,
Quarter, Age/Tenure, Date Predicates, etc.) largely shipped. What remains are the [C]
list-reducers, the duration trio, and the [M] composites:

### [C] list-reducers — build as core, tag into Timesavers
| Node | What | Excel today |
|---|---|---|
| **Rank within Group** | rank each row only against its partition | `=COUNTIFS(grp,grp,val,">"&val)+1` |
| **Count Distinct** | number of unique values in a list | `=COUNTA(UNIQUE())` / `SUMPRODUCT(1/COUNTIF(...))` |
| **Last / First Non-Blank** | value of the last (or first) non-empty cell | the famous `LOOKUP(2,1/(rng<>""),rng)` |
| **IQR Outlier Flag** | mark points outside Q1−1.5·IQR … Q3+1.5·IQR | QUARTILE combo + `OR(<lo,>hi)` |
| **Conditional Aggregate (AND/OR)** | sum/count/avg over rows matching multiple criteria, with **OR** as well as AND | `SUM(SUMIFS(...,{set}))` / SUMPRODUCT gymnastics |
| **Multi-Criteria Lookup** | look up a row matching 2+ keys at once | `INDEX(res,MATCH(1,(k1=c1)*(k2=c2),0))` (CSE) |

The **Conditional Aggregate (AND/OR)** node is the highest-leverage entry — it collapses the
SUMIFS-is-AND-only pain + the `--(condition)` SUMPRODUCT trick into one node, answering
`excel-pain-points.md` Part 2 §1; general enough to deserve **core** Aggregation placement.
(Solenoid's shipped SUMIFS node covers the AND-only case; the OR half is the remaining gap.)
Multi-Criteria / multi-return are the real remaining XLOOKUP gaps — build as **core Lookup**,
tag into Timesavers via `NODE_PACK_TAGS`.

### The duration trio ([C] — genuinely needs code)
Solenoid lacks an Excel-style elapsed-time `[h]:mm` number format, so these hand-roll,
following the `date.ts` UTC-careful pattern (the existing date nodes pointedly do **not** call
Formula.js, to dodge serial↔`Date` interop + timezone bugs):
| Node | What |
|---|---|
| **Duration ⇄ Time** | seconds (or decimal hours) → `h:mm:ss` and back — the >24h `[h]` case Excel users get wrong |
| **Humanize Duration** | `9000s → "2h 30m"` |
| **Parse Duration** | `"1h 30m" → number` (no clean Excel parser) |

High-value — elapsed-time formatting is a perennial silent-bug source (naive `hh:mm:ss` wraps
at 24h).

### [M] composites — defer until the composite/subgraph pack-node shape exists
| Node | What | Emulate meanwhile |
|---|---|---|
| **Pareto / Cumulative %** | sort desc → running total ÷ grand total (the 80/20 curve) | Sort → Cumulative → ÷ |
| **Join-If** | concatenate a list with a delimiter, filtered by a condition | Filter → TextJoin |
| **Lookup All Matches** | return *every* row matching a key, not just the first | Filter-based `→ core?` |
