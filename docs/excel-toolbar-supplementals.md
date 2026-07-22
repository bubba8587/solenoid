# Solenoid — Excel Toolbar Supplementals

A systematic walk through **every part of Excel that isn't a worksheet function**
— the ribbon, the chrome, and the cross-cutting features (tables, pivots,
validation, conditional formatting, form controls, data types…). For each, a
verdict: do we need it, and if so, what shape does it take in a node graph?

Functions (the `=FUNC(...)` library) are covered elsewhere: `node-coverage.md`
is the inventory, the in-app Function Reference (Ctrl+/) is the parity list, and
`archive/excel-pain-points.md` is the gap analysis. This doc is the **non-function**
half of "Excel parity": the toolbar and the features behind it.

Companion to `archive/excel-pain-points.md` (why Excel hurts).

> **How current is this?** The per-ribbon tables below are the durable MAPPING
> (which bucket each Excel feature lands in) — those verdicts don't age. Build
> STATUS lives in the "Consolidated verdicts" section at the end, reconciled
> 2026-07-05; inline "not yet built / roadmap Phase N" asides in the tables may
> lag it. `backlog.md` is the task truth.

---

## How to read the verdicts

Every item gets one tag. The whole point of the exercise is that Excel collapses
six very different kinds of thing onto one grid + one ribbon; a node graph pulls
them apart, and *which bucket* a feature lands in is the actual design decision.

| Tag | Meaning | Where it lives |
|---|---|---|
| **[NODE]** | A data transformation — it takes values in and emits values out. | The graph (`nodeCatalog.ts`), existing or proposed. |
| **[SETTING]** | A global mode that changes how the whole app/document behaves. | The Settings bag (`settingsStore.ts`) or a document property. |
| **[FORMAT]** | Per-value display/format/unit — Excel's number-format surface. | The Format Controller (per-socket), not a node or a global. |
| **[CHROME]** | An editor affordance — it acts on the canvas, not on data. | Toolbars / shortcuts / panels. |
| **[STRUCTURAL]** | The node-graph model **dissolves** the feature; there's nothing to build. | The architecture itself. |
| **[SKIP]** | Out of scope for a local-first, grid-less, single-user instrument. | Nowhere — a deliberate non-goal. |

The decision rule, stated once:

- **Does it transform values?** → NODE. (Filter, Sort, Pivot, Goal Seek.)
- **Does it change a global behaviour or a default?** → SETTING. (Calc mode,
  date system, CSV locale.)
- **Is it about how a single value looks?** → FORMAT. (Currency, %, decimals,
  units — all one surface, the Format Controller.)
- **Does it act on the editor, not the data?** → CHROME. (Find, zoom, undo,
  copy/paste, freeze-pane-equivalents.)
- **Has the model already eaten it?** → STRUCTURAL. (Cell refs → wires, named
  ranges → labels, dependency tracing → the graph being visible.)
- **Is it a grid/print/VBA/sharing concern?** → SKIP.

A recurring theme: **Excel's "form controls" and "data tools" are mostly nodes;
its "view" and "page layout" are mostly skip-or-chrome; its formatting is one
Format Controller; and a surprising amount is already structural** — the graph
*is* the dependency tracer, the audit trail, the name manager.

---

## File tab

| Feature | Verdict | Notes |
|---|---|---|
| New / Open / Save / Save As | [STRUCTURAL] | Documents + `persistence.ts`. Multiple docs already exist; autosave + save-format `v` guard in place. |
| Recent files | [STRUCTURAL] | The documents list. |
| AutoSave / AutoRecover | [STRUCTURAL] | Autosave exists; interval could become a [SETTING] if it ever needs tuning. |
| Export → **PDF / image** | [NODE] *(weak)* or [CHROME] | "Export canvas as PNG/SVG" is a chrome action, not data. A *plot* export already lives in the chart popup. Low priority. |
| Export → **CSV / data out** | [NODE] | A real gap: an **Export/Write sink node** that takes a frame and writes a `.csv` (desktop) or to clipboard. The mirror of the CSV Connection *source* node. The graph currently has no "write data out" terminus. |
| Print / Print Area / Print Titles | [SKIP] | No pages, no grid. A node canvas isn't paginated output. |
| Share / Publish | [SKIP] | Local-first, single user (PRODUCT.md). The whole co-authoring story is a non-goal. |
| Info → Properties (author, title, tags) | [SETTING] *(document-level)* | Cheap document metadata if ever wanted; not urgent. |
| Options | [SETTING] | This *is* the Settings page. Everything Excel buries under File ▸ Options that we keep maps here. |
| Account / theme | [SETTING] | App theme + accent already exist (`appTheme`). |

---

## Home tab

The busiest ribbon tab, and the one that splits most cleanly across buckets.

### Clipboard
| Feature | Verdict | Notes |
|---|---|---|
| Cut / Copy / Paste | [CHROME] | Ctrl+C/V with topology preserved — done. |
| **Paste Special** (values / formats / transpose) | mixed | *Paste values* → [STRUCTURAL] (cables already carry values, not formulas). *Paste transpose* → [NODE] (TRANSPOSE exists). *Paste formats* → [FORMAT] (copy a Format Controller config — minor). |
| Format Painter | [SKIP] | A formatting-copy gesture with no grid analogue. Format Controller config-copy covers the real need if it ever surfaces. |

### Font / Alignment / number formatting
| Feature | Verdict | Notes |
|---|---|---|
| Font, size, bold, colour, fill, borders | [SKIP] | Per-cell text styling has no place in a typed node graph. Node/Note styling is its own (small, deliberate) surface — tints, not a font ribbon. |
| Wrap text / Merge & Center / orientation | [SKIP] | Grid-cell layout. No grid. |
| Indent / alignment | [SKIP] | Same. |
| **Number format** (General, Number, Currency, Accounting, Date, Time, %, Fraction, Scientific, Text, **Custom**) | [FORMAT] | The entire Number-Format dropdown is **one surface: the Format Controller** (per-socket number format + unit label). This is the flagship mapping — Excel scatters format across cells; we attach it to the value's socket and propagate it. Custom format codes → the FC's format string. |
| Increase/Decrease Decimal | [FORMAT] | Sig-figs/places on the FC. A document-level **default places** could also be a [SETTING]. |
| Comma / thousands separator | [FORMAT] | FC number format. |

### Styles
| Feature | Verdict | Notes |
|---|---|---|
| **Conditional Formatting** | [NODE] | Partly shipped: **Alert** (threshold → toast/HUD, status-edge-triggered) is the scalar case; **Heatmap** (frame → colour grid) is the data-bar/colour-scale case. Gap: a **rule-based cell highlight** on a frame display (e.g. "colour cells where > x") — a natural Heatmap extension, *not* a new opaque rules engine. Excel's CF is stale-prone and runs outside recalc; ours would be on the live graph. |
| Format as Table | [STRUCTURAL] | An Excel "Table" (structured refs, auto-expand) ≈ our **frame** type. See Tables deep-dive below. |
| Cell Styles | [SKIP] | Visual cell theming. |

### Cells / Editing
| Feature | Verdict | Notes |
|---|---|---|
| Insert / Delete / Format cells, rows, cols | [STRUCTURAL] | No grid to insert into; this whole class of "#REF! on delete" pain (pain-points §9) simply doesn't exist. |
| Row height / col width | [SKIP] / [CHROME] | Frame preview column sizing is a display detail, not a feature. |
| **AutoSum** | [NODE] | The **Aggregate** node (sum/avg/min/max/count/… op selector). |
| **Fill** → Down/Right/**Series** | [NODE] | Series → **Sequence / Range / LinSpace / Geometric / Repeat / Pad**. The fill *handle* gesture is [SKIP] (no grid); the *capability* is nodes. |
| **Flash Fill** | [NODE] *(speculative)* | By-example text transformation. Could be a node ("derive a transform from input→output examples"), but it's fuzzy/ML-ish and off the critical path. Today: Regex / Text Map / Expression cover the deterministic cases explicitly. |
| **Sort & Filter** | [NODE] | **Sort** and **Filter** nodes (and the relational Filter on the roadmap). The button-dropdown is the node. |
| **Find & Select** | [CHROME] | Find → Ctrl+F / navigator search (exists). "Go To Special" (find all formulas/constants/errors) → an interesting [CHROME] idea: select-all-error-nodes / select-by-type, riffing on the navigator. |
| Clear (All/Formats/Contents) | [STRUCTURAL]/[CHROME] | Delete node = clear. "Clear formats" → reset a Format Controller. |

---

## Insert tab

| Feature | Verdict | Notes |
|---|---|---|
| **PivotTable** | [NODE] | **GroupBy** is the shipped 1-D case; full pivot (cross-tab) = **Pivot / Unpivot** nodes on the relational roadmap (Phase 3). The single most important "feature, not function" to land. |
| **Recommended PivotTables** | [SKIP] | A wizard over the above; not needed. |
| **Table** | [STRUCTURAL] | = frame. See deep-dive. |
| Pictures / Shapes / Icons / SmartArt | [NODE]/[SKIP] | Pictures → the **Image** node (annotation). Shapes/SmartArt/diagramming → [SKIP] (not a drawing tool). |
| **Charts** (column, line, pie, scatter, combo, …) | [NODE] | **Chart / Sparkline / Gauge / Heatmap** visual nodes (recharts). Chart Builder configures via matplotlib-style options. Pie/scatter are coverage gaps to fill within the existing Chart node, not new infrastructure. |
| **Sparklines** | [NODE] | **Sparkline** node (line/area/column inline). Shipped. |
| **Slicers** | [NODE] | **Slicer** input node exists. (In Excel a slicer filters a pivot; here it's an interactive value source feeding a Filter — same idea, wired explicitly.) |
| **Timeline** (date slicer) | [NODE] | A DatePicker / date-range input feeding a Filter. Largely covered by DatePicker + Filter. |
| Links (hyperlinks) | [SKIP] | Note markdown can hold a link; no cell-hyperlink concept. |
| Text Box / Header-Footer / WordArt | [NODE]/[SKIP] | Free text → the **Note** node. The rest → skip. |
| Symbols / Equation | [SKIP] | (Math rendering already exists where it matters — KaTeX in displays.) |
| Object / OLE | [SKIP] | — |

---

## Draw tab
| Feature | Verdict | Notes |
|---|---|---|
| Pen / ink / draw | [SKIP] | Not a sketching tool. Notes + tints are the annotation surface. |

---

## Page Layout tab

Almost entirely about paginated print output, which doesn't exist here.

| Feature | Verdict | Notes |
|---|---|---|
| **Themes** (colours/fonts/effects) | [SETTING] | App theme + accent (exists). Fonts are a *fixed* accessibility constraint (Atkinson Hyperlegible) — deliberately **not** themeable (PRODUCT.md). |
| Margins / Orientation / Size / Print Area / Breaks / Background / Print Titles | [SKIP] | Print/page concerns. |
| Scale to Fit | [SKIP] | — |
| Sheet Options → Gridlines / Headings (view & print) | [SETTING] | "Show gridlines" ≈ the canvas dot-grid; a **show/hide grid dots** toggle is a reasonable [SETTING] (snap already is one, `gridSnapStore`). |
| **Arrange** → Bring Forward / Send Back / Align / Group / Rotate | [CHROME] | These already exist as graph operations: z-order (standoffs < groups < conduits < nodes), **Align** ≈ Tidy, **Group** (G), **Rotate** ≈ Conduit angle. The Conduit even rotates. This is the one Page-Layout cluster we fully have. |

---

## Formulas tab (the non-function parts)

The function library itself is out of scope here; the *rest* of the tab:

| Feature | Verdict | Notes |
|---|---|---|
| **Name Manager** / Define Name / Use in Formula | [STRUCTURAL] | A node's title **is** its name; a cable **is** a reference to it. No separate registry, no "names built for ranges storing code" (the LAMBDA-in-Name-Manager wart, pain-points §10). |
| **Formula Auditing** → Trace Precedents/Dependents | [STRUCTURAL] | This is the product's reason to exist. Every dependency is a visible wire; the graph is a *persistent*, always-on precedent/dependent tracer (vs Excel's one-level-at-a-time arrows that vanish on click). |
| Show Formulas | [STRUCTURAL] | Always shown — each node *is* its formula, laid out. |
| Evaluate Formula (step through) | [STRUCTURAL]/[CHROME] | The graph already shows every intermediate on every node face. The **Cable Inspector** is the per-wire value view. "Step" is just reading downstream. |
| Error Checking | [NODE]/[CHROME] | Typed `SolError` values + the **Test** node (IS-family inspector) surface errors inline. A **"select all error nodes"** chrome action (see Go To Special) would complete it. |
| Watch Window | [STRUCTURAL] | **Pins** (HUD) are exactly this — pin a value, watch it persist. |
| **Calculation Options** (Automatic / Manual / on save) | [SETTING] | Solenoid is push-reactive (auto) today. A **recompute mode** setting — *Live* vs *Paused/Manual* (recompute on demand) — is worth having for large graphs, and mirrors Excel's F9. The clean place is the Settings bag. |
| Iterative Calculation (enable + max iterations + change) | [SETTING] *(advanced)* | Excel's toggle for intentional circular references. We currently **deadlock** on cycles and tag `#CIRC!` (pain-points / errorValue). An opt-in **fixed-point/iterative mode** (max-iter + tolerance) would turn an error into a feature for feedback models. Advanced, post-1.0. |

---

## Data tab

This is where Solenoid is *going* — the relational/Power-Query layer is the
North Star (roadmap). Most of this tab is nodes.

| Feature | Verdict | Notes |
|---|---|---|
| **Get Data / Power Query** (from file, web, database, …) | [NODE] | **CSV Connection** (desktop) + **Web Source** nodes exist; the Tauri HTTP route (roadmap Phase 1) unlocks CORS-blocked + IMPORTHTML/XML. Power Query's *transform* steps are the relational verbs below — and the **Query** node (D22, a Composite preset in the Manual refresh run mode) is the container: build the verb chain in its drill-in, recompute only on Refresh. |
| From Text/CSV | [NODE] | CSV Connection node (+ a target-folder [SETTING], `csvFolder`, already there). The CSV **locale/delimiter** trap (pain-points: decimal-comma catastrophe) argues for an explicit import [SETTING] or per-node delimiter/decimal option. |
| **Refresh All** | [STRUCTURAL] | Reactive recompute; no manual refresh needed (unless Calc mode = Paused, above). Per-container opt-in exists: a Query node holds until its own Refresh (D22). |
| Queries & Connections | [STRUCTURAL] | The connection nodes *are* the queries, visible on the canvas. |
| **Sort / Filter** | [NODE] | Sort, Filter nodes (relational versions on the roadmap). |
| **Text to Columns** | [NODE] | **TextSplit** (TEXTSPLIT). |
| **Flash Fill** | [NODE] *(speculative)* | See Home tab. |
| **Remove Duplicates** | [NODE] | **Unique** node. |
| **Data Validation** | [NODE] | A genuine gap and a strong fit for the "no silent errors" ethos: a **Validate/Assert node** (or per-input constraint) — "this value must be in [list]/within [range]/match [pattern]", failing **loud** as a typed error rather than Excel's dismissible dialog. Excel validates *input*; we'd validate *flow*. |
| **Consolidate** | [NODE] | VStack / GroupBy / Aggregate compose this. |
| **Relationships** | [NODE] | = **Join** (the keystone relational verb, roadmap Phase 3). |
| Data Model / Power Pivot | [NODE] | The relational engine (Polars, Phase 2) is this, done right. |
| **What-If Analysis → Goal Seek** | [NODE] | **Solver/Goal-Seek node**: solve an input so a target node hits a value. Inverts the dataflow for one variable. High-value, distinctive, not yet built. |
| **What-If Analysis → Data Table** (1-/2-variable) | [NODE] | A **parametric sweep node**: vary 1–2 inputs across ranges, tabulate the output into a frame — pairs naturally with Chart/Heatmap. Strong analytical feature. |
| **What-If Analysis → Scenario Manager** | [NODE] *(low priority)* | Named input presets. Partly covered by Slicer/Input nodes; a dedicated "scenario set" node is a maybe. |
| **Forecast Sheet** | [NODE] | TREND/FORECAST/exponential-smoothing already exist as function nodes; a one-click "forecast" wrapper is sugar, not need. |
| **Outline** → Group / Ungroup / **Subtotal** | [NODE]/[CHROME] | Data *grouping/subtotal* → GroupBy + Aggregate + Cumulative. Visual *grouping* of nodes → the **Group** chrome (G). Two different "group"s; keep them distinct. |

---

## Review tab

| Feature | Verdict | Notes |
|---|---|---|
| Spelling / Thesaurus / Smart Lookup | [SKIP] | Not a word processor. |
| **Comments / Notes** | [NODE] | The **Note** node (free-floating markdown sticky, tint, no sockets). Threaded comments → skip (single user). |
| **Protect Sheet / Workbook / Allow Edit Ranges** | [SKIP] | Single-user, local-first. Locking cells is a multi-user/audit concern we don't have. |
| **Track Changes** | [SKIP] *(for now)* | Versioning is a git-style concern, not in-document change tracking. The graph's visibility already removes the "what changed and broke" panic that Track Changes exists to soothe. |
| Share / Protect & Share | [SKIP] | — |

---

## View tab

| Feature | Verdict | Notes |
|---|---|---|
| Workbook Views (Normal / Page Break / Page Layout / Custom) | [SKIP] | Page-oriented; N/A. |
| **Show** → Gridlines / Formula Bar / Headings | [SETTING]/[STRUCTURAL] | Gridlines → grid-dots toggle [SETTING]. Formula Bar → [STRUCTURAL] (the node *is* the formula). Headings → N/A. |
| **Zoom** / Zoom to Selection / 100% | [CHROME] | Zoom controls + autofit (F) exist. |
| **Freeze Panes** / Split | [SKIP]/[CHROME] | No scrolling grid to freeze. The *intent* (keep context visible while exploring) → pan/zoom + minimap + pins. |
| **New Window / Arrange All / View Side by Side** | [CHROME] | The **isolate / pin multiview** scoping system is our take on multiple views of one model (`archive/isolate-pin-multiview-scoping.md`). |
| Hide / Unhide | [CHROME] | Collapse (per-node chevron), Isolate. |
| **Macros** | [SKIP] *(see Developer)* | — |

---

## Developer tab

| Feature | Verdict | Notes |
|---|---|---|
| **Macros / VBA / Record Macro** | [SKIP] *(maybe future scripting)* | Imperative scripting is antithetical to the visible-dataflow model. A *visual* "reusable subgraph" (collapsed-graph-as-function) is the in-model answer to "I want to reuse logic" — see LAMBDA mapping in pain-points §10. Not a VBA port. |
| **Form Controls / ActiveX** (Button, Check Box, Spin Button, Scroll Bar, Combo Box, List Box, Option Button) | [NODE] | **This whole palette is already our Input/Control node family**: Check Box → BooleanInput, Spin Button → Slider stepper, Scroll Bar/slider → Slider, Combo/List → Slicer, Option → (Switch/Slicer). Excel bolts these onto cells; here they're first-class typed sources. The cleanest Excel→Solenoid mapping in the whole ribbon. |
| **Add-ins** | [NODE] *(infrastructure)* | = **packs** (`pack-architecture.md`, `reference-packs.md`). Optional bundles of nodes, already the extension model. |
| XML / COM | [SKIP] | — |

---

## Cross-cutting concepts (the deep-dives)

A few Excel features span several ribbon tabs and deserve a fuller verdict.

### Tables (structured references) → frame [STRUCTURAL + NODE]
An Excel Table (`Ctrl+T`) is a named, typed, auto-expanding range with
structured references (`Table1[Sales]`). That **is** our **frame** type: named
columns, a typed grid, referenced by wire rather than by `A1:D100`. Frame ops
(and the relational verbs) operate on it. Nothing to "add" for the concept; the
work is the verb coverage (Join/Pivot/etc.), not the table itself.

### Number formats & data types → Format Controller [FORMAT]
Currency, Accounting, Percentage, Date, Time, Fraction, Scientific, Custom — in
Excel these are per-cell and silently mutate meaning (the date-coercion gene
disaster, pain-points §1). In Solenoid they are **one surface, the Format
Controller**, attached to a socket, propagated through the graph, never altering
the underlying typed value. Units ride the same surface (the flagship trait). A
document-level **default number format / places / date format** is the only
piece that's also a [SETTING] (partly there — default `DD-MMM-YYYY`).

Excel's **linked data types** (Stocks, Geography) → [SKIP] / future connection
nodes; not core.

### Conditional formatting → Alert + Heatmap (+ a gap) [NODE]
Covered above: Alert (scalar thresholds → HUD), Heatmap (frame → colour scale).
The remaining gap is **rule-based cell highlighting on a frame display**, built
as a Heatmap extension, not a new rules engine. Ours runs on the live graph, so
it can't go stale the way Excel's CF does (pain-points §13).

### Data validation → Validate/Assert node [NODE] — *recommended build*
Excel validates *cell input* with a dismissible dialog. Solenoid should validate
*data flow*: an explicit node asserting a constraint (membership / range /
pattern / non-null / type) that **fails loud** as a typed `SolError`. This is the
most on-brand new node in the doc — it's literally "no silent failures" made into
an operation. Doubles as documentation of intent on the canvas.

### Pivot / Goal Seek / Data Table → the analytical nodes [NODE]
The three "feature, not function" power tools, in priority order:
1. **Pivot / Unpivot** — already on the relational roadmap (Phase 3); GroupBy is the down-payment.
2. **Goal Seek / Solver** — inverse solve; high-value, distinctive, unbuilt.
3. **Data Table (parametric sweep)** — vary inputs, tabulate outputs; pairs with charts.

### Recalculation → DataflowEngine [STRUCTURAL + one SETTING]
Excel's volatile-function whole-workbook recalc (pain-points §11) is replaced by
downstream-only push evaluation. The one knob worth exposing is **Calc mode:
Live vs Paused** (a [SETTING]) for very large graphs — the principled version of
F9 / Manual calculation.

---

## Consolidated verdicts

### New **nodes** to build (priority order) — reconciled 2026-07-05
1. ~~Pivot / Unpivot + the relational verbs~~ — **SHIPPED** (the full verb spine + native Polars).
2. ~~Validate / Assert node~~ — **SHIPPED as the Expect node** (2026-07-03; not-null/unique/range/regex, fails loud, Problems panel).
3. ~~Goal Seek / Solver~~ — **SHIPPED** as the Composite Goal Seek run mode (+ solver params — maxIterations / tolerance / bounds, 2026-07-12).
4. ~~Data Table / parametric sweep~~ — **SHIPPED** as the Composite Data Table run mode (N-variable full-factorial).
5. ~~Export / Write sink node~~ — **SHIPPED** (Write CSV / Write JSON, arm/disarm Run button).
6. **Conditional cell-highlight** — DEFERRED by the author (D4, needs its own design pass; backlog).
7. Speculative tail: Flash-Fill-by-example → the #11 deferred pile; ~~Scenario set~~ → **SHIPPED** (Scenarios run mode); scatter → ruled IN (core-viz backlog item); ~~pie~~ → **SHIPPED** (a live Chart op).

### New **settings** to add — reconciled 2026-07-05
- ~~Calc mode~~ — **SHIPPED** (automatic / manual / sketch, F9, StatusBar chips).
- **Show grid dots** — OPEN (backlog; snap toggle exists, visibility doesn't).
- ~~CSV import locale~~ — **RESOLVED**: delimiter auto-detection shipped (Papa); decimal-comma DECIDED AGAINST (en-US by fiat).
- **Default number format / places** — OPEN, folded into the future Document Properties window (backlog; the date default shipped).
- ~~Iterative calculation~~ — **COVERED** by the Composite Simulation run mode (bounded Gauss-Seidel feedback instead of a global toggle).
- Document properties (title/author/tags) — folded into the same Document Properties window item.

### Already handled — **don't rebuild**
- Names/references → titles + wires. Formula auditing / trace precedents → the graph itself. Watch Window → pins. Show Formulas / Evaluate → always-visible node faces + Cable Inspector.
- AutoSum → Aggregate. Sort/Filter → nodes. Remove Duplicates → Unique. Consolidate → VStack/GroupBy. Text to Columns → TextSplit. Series/Fill → Sequence/Range/LinSpace. Paste-transpose → TRANSPOSE.
- Form controls → the Input/Control node family (Slider/BooleanInput/Slicer/DatePicker/…). Add-ins → packs.
- Charts/Sparklines/Slicers → visual + control nodes. Comments → Note. Pictures → Image.
- Number formats/units → Format Controller. Tables → frames. Arrange/align/group/rotate → z-order + Tidy + Group + Conduit. Multiple views → isolate/pin multiview.
- Copy/paste, undo/redo, find, zoom → chrome (shipped).

### Explicit **non-goals** (skip)
- Printing & page layout (margins, breaks, print area, scale-to-fit, page-break view).
- Cell styling (fonts, fills, borders, merge, wrap, indent) — no grid cells to style.
- Protection / track changes / share / co-authoring — single-user, local-first.
- VBA / macros / ActiveX / COM / XML — imperative scripting against the model's grain (visual subgraphs are the in-model reuse answer instead).
- Drawing/SmartArt/WordArt/shapes, spelling/thesaurus, linked data types (Stocks/Geography), OLE objects, hyperlinks.

---

## Open questions — ALL ANSWERED (2026-07-05)
- ~~Calc mode~~ → built (manual + sketch shipped 2026-07-01/03).
- ~~Validate/Assert~~ → built as the Expect node (general node, per-check toggles).
- ~~Goal Seek~~ → sequenced after (a Composite run mode; backlog).
- ~~Conditional formatting~~ → deferred by the author (D4, own design pass; must
  clear Excel's version by a lot, Display-node-only, off FC territory).
</content>
</invoke>
