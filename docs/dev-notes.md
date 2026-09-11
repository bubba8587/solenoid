# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-11 — Obsidian surface: the note identity is a wireable value)

Made the vault nodes honour the wire-in/out principle — the paths and titles the readers
emit are now values you can wire back into the writers and importer.

- **Write to Obsidian:** the note-name field + the `{{date}}`/`{{daily}}` template grammar are
  gone, replaced by a wireable `path` (a `string` input, InlineInputs literal else a cable) plus
  a **Browse** chooser (the Import file picker). A `folder/name` path splits — the folder
  prepends to the subfolder. The `date` input and **`nameTemplate.ts`** (only this node used it)
  are deleted; a formatted date wired into `path` replaces `{{date}}`. `run()` resolves the
  target from the path (blank name still batches — `writeDocumentToVault` names each page).
- **Import Obsidian:** exposes its identity — a `path` **output** (vault-relative, `.md`
  included so it joins a Vault Folder cube's `path` column) and a `path` **input** that loads
  that note in the background (`data()` reads the wire, `loadFromWire` reads the file, adopts the
  body + frontmatter sockets, recomputes — the VaultFolder guard pattern). The note's own title
  (its file name) renders at the top of the card body. `NoteNode` gained `reservedOutputs()` so
  `syncFields` keeps the path output; `FieldRow` joined the `socketRowCoverage` row renderers.
- **Vault Folder:** `folder` + `glob` are wireable string inputs (cable-only dots via
  InlineInputs; the dropdown/field disable when wired); `data()` resolves them, `load()` reads
  the resolved values. (The status count reads 48×44 = the cube's rows×cols; no bug.)
- Verified headless against `demo-vault/` (`run-graph-vault.test.ts`: a wired path loads a note,
  a wired folder scopes the read) and on the live desktop app.
**Follow-on (author calls, same day):**
- **The writer MERGE LANDED:** Write to Obsidian is the one vault sink — `WritePropertiesNode` +
  its component are deleted, absorbed into `WriteObsidianNode` (`nodes/obsidian.ts`). A Target
  dropdown (Auto / Note / Properties) picks by the wired input: a Document → a note
  (overwrite/append/block), a cube of rows → frontmatter + a `note-body` column → the body. Both
  Preview before Run (`plan` frame on the Properties side, a target-action line on the Note side).
  The `write-back-to-obsidian` seed switched to `target:"properties"`. Write File + Write Tasks
  stay separate for now (backlog mega-merge). Rendered fixes: Browse is a real full-width button
  (folder glyph), the subfolder rescan uses `RefreshIcon` not a unicode ⟳.
- **`note-body`** is the reserved property that round-trips a note's body: Vault Folder's
  include-body column is `note-body` (was `body`), and the Properties target writes a `note-body`
  cube column as each note's BODY, every other column its frontmatter (`frontmatterPatch.ts`
  `setBody`/`resolveBody`, the block stays byte-identical).
- **Single vault** (`singleVaultFromSetting`): Vault Folder + Write Properties read the app-wide
  `obsidianVault` setting (per-node chip gone; a `get vault()` getter leaked the abs path into
  saves via extractInit, so it reads the setting inline instead).
- **Name-resolving Import:** a wired `path` resolves a bare note name Obsidian-style — a full
  vault-relative path matches directly, else the basename, case-insensitive.
- **TaskNotes:** stats is now **one `{ Status | Count }` frame** (`statsToFrame`), not five number
  sockets — fixes the mode-switch width oddity. The unwired calendar window is a year either side
  of today (was `today..today+7`). `/api/calendars/events` only surfaces external calendar sources
  (ICS/Google/Microsoft), never task scheduled/due, so the demo vault gained `Team Calendar.ics`
  (a local ICS subscription, plugin config is per-machine + gitignored, so only the `.ics` ships).
- **Date Input:** a valid relative phrase reads white (was red — the card validated without the
  `relative` opt-in the node uses); an (i) button beside the picker shows a "Supported Formats"
  example popup when Relative dates is on. Year-first dates stay ISO (never `#AMBIGUOUS!`; no
  country uses YDM).

**Still open (author calls):** daily-notes targeting (retain, not necessarily a node — the removed
`{{daily}}` successor); fold Write File + Write Tasks into the one sink; Knap for dynamic write
paths / content; the TaskNotes read node's overlap with a plain Vault Folder query. All in
`backlog.md`.

### SESSION DIGEST (2026-09-11 — Report card rebuilt as a standard node; Note holds Knap tags literal)

- **The Report card is a standard node** (`ReportNode.tsx`/`.css` on `NodeShell`), not the
  Note-family frame. Template + Records are two standard measured input rows (`ReportRefRow` →
  `MeasuredSocketRow`) with a divider before the variable refs; the hero box is the Document chip
  (`valueChipFor`, opens the overlay), the `document` output socket centers on it; collapse folds
  the rows into one `CollapsedInputPill` so cables survive. New green **`document` node kind**
  (`nodes/shared.ts`, `nodes/kind.ts`) — the Report was falling through to math blue. Per-node
  color dropped (field gone from `report.ts`; the 3 hand seeds + the PF generator updated; overlay
  and webpage export never read it). `RefInputRow` pruned (the Report was its last user);
  `socketRowCoverage` whitelist now names `ReportRefRow`.
- **A Note holds unresolved Knap tags LITERAL, never empty** (`knapTemplate.ts` `holdUnknownTags`
  widened from bare-only to ANY unknown-rooted `{{ … }}` — bare, dotted, filtered — parked behind
  an index sentinel and restored after render; `useKnapRender` gained `keepUnknown`, passed true by
  NoteNode + ImportObsidianNode). A tag naming no frontmatter field reads as its placeholder so a
  template note reads as a template; blocks (`{% if %}`) over an unknown name still render empty, as
  Knap does. Fixes template-note variables vanishing on the card.
- **Report overlay polish:** the wired-Template read-only pane is syntax-highlighted
  (`highlightKnap`); the batch **Page-name** field moved out of the header to the page-stepper strip
  (compact, right-aligned, wraps); the docked header stacks (title row + wrapping action row) with a
  compact segmented Draft/Preview toggle IN the button row, all controls matched at 26px; **"Embed
  Note" / "Export"** are the labels in both docked and floating. Report embeds use the node-header
  chevron (masked `M3 1l4 4-4 4`, 8px), not a text triangle.
- **Seeds:** `report-showcase` gained a Template + Records mail-merge cluster (a regions frame + a
  per-region template Note → a `merge` Report, one page per region; layout baked with tune-seeds;
  the showcase test pins the three pages). **Personal Finance** advisor verdicts are inline Knap
  `{% if %}` reading the raw operand pairs the old Compare→IF→text circuits used — same thresholds,
  −8 nodes (162→154). `knapTemplate.test` pins `>=`/`<=`. Records stays a **cube** input (the
  lattice supremum accepts a frame or a cube; a frame socket would reject a cube).

### SESSION DIGEST (2026-09-10 — Knap replaces the `=name` syntax in Note and Report bodies)

- **Knap is THE document syntax** (knap.md, Obsidian's template language; the `knap` npm
  package, MIT, dayjs its one dependency; decisions knapIsTheDocumentSyntax). `{{ name }}`,
  `{% if %}`, `{% for %}`, `{% set %}` and the standard filters render at compute into the
  `document` output. Spec in `node-coverage.md` § Annotation; mechanics in `knapTemplate.ts`
  (AST walk for the root names, the bare-tag rewrite, value flattening, the engine wrapper).
  Pinned by `knapTemplate.test.ts`, `knapEngine.test.ts` (the real DataflowEngine awaits the
  async render through both Canvas wrappers), the Report/Note node suites and the seed tests.
- **The rule:** a Report's root template variables mint `trueany` inputs (one per name,
  first-use order). A BARE `{{ name }}` embeds the wired value as the canvas shows it (FC
  scalar, grid, chart, KaTeX, Note block) and `{{ name | highlight }}` is the tinted text
  form: both rewrite to the internal `` `=name` `` / `` `=name!` `` span before the render, so
  `inlineRefDisplay.tsx`, `obsidianMarkdown.ts` and `reportExport.ts` are unchanged. Any
  other use reads the data form: frames/cubes as rows, a document as its body, a date serial
  as ISO only when the SOURCE socket type says date, a chart as null. A Note's variables are
  its own frontmatter (no inputs). `data()` is async only when a tag is left for the engine.
- **Swept:** the five seeds with Report refs (`=x` → `{{ x }}`, `=x!` → `{{ x | highlight }}`),
  the Report overlay's Embed-a-Note token, the export (renders the template first), landing
  and catalog copy, decisionSeed/reportShowcase tests. `noteInlineRefs.ts` stays as the
  internal grammar (the machine-checked twin of `obsidianMarkdown.ts`'s regex).
- **Preview:** `useKnapRender` renders the live draft against the node's last variables on
  the Note card, the Import Obsidian card and the Report overlay; a syntax error replaces the
  preview with `line:column message` lines and lands as `#SYNTAX!` on the document. Knap eats
  the newline after a block tag, and 0.4 rejects the `{{-` trim dashes its README lists.
- The Write to Obsidian NAME field's `{{date}}` / `{{daily}}` tokens are `nameTemplate.ts`, a
  separate mini-language for file names. Unrelated syntaxes.
- **Template + Records on the Report (09-10b):** a wired Note is the text (its raw `source` rides
  the document; tags naming no field stay literal on a Note so a template note reads as one),
  its variables the sockets (`sideVars` persisted, `data()` reconciles via `dropInputCables`),
  its frontmatter the defaults; Records is the MAIL MERGE (the author's keyword; "Rows" said
  nothing): a wired frame/cube renders one page per row (`record`, `index`, the `pageName`
  Knap names each), and Write to Obsidian writes one note per page. Spec in
  node-coverage § Annotation; `mail-merge.json` is the worked seed; the report seeds gained a
  loop (showcase, decision memo) and an `{% if %}` verdict (garden). Pinned by the Report and
  knapTemplate suites; `seeds.test.ts` treats a Knap tag line as a block, not prose.
- **The follow-ups landed the same day (09-10c):** the Report overlay highlights the source
  (`knapHighlight.ts`: Markdown structure + Knap keywords, filters, strings, variables), lists
  the filters with examples, and steps a merge page by page. Write File taking a document
  (a merge as one `.md` per page into a folder) was built in `ec715ed` and BACKED OUT the
  same day (author): it lands as part of the Write mega-merge (backlog), not as a bolt-on.
- **Seeds exercise Knap's shaping filters** (author 2026-09-10): `sort:("col","desc")`, `slice`,
  `where:("col", v)`, `map:x => x.col`, `unique`, `sum:"col"`, `list:"numbered"`, `join` — the
  showcase's top-three months and ledger sum, the decision memo's sliced podium, the mail
  merge's paid-most-first roll and who-still-owes line. The knap 0.4 bugs and API asks the
  probing surfaced, with repros and the workaround each would retire, are `knap-upstream.md`
  (the author files them; backlog line). The one host-side rule they forced: an unwired
  Report input is ABSENT to the template, never null, so a bare filter word
  (`list:numbered`) still falls through to Knap's literal.
- **Holes at close (2026-09-10, for tomorrow):** nothing below is verified in a browser —
  every check this session was tsc/vitest/build. (1) The Report overlay's highlighted
  backdrop vs the transparent textarea: glyph alignment, scroll sync, mobile `data-tab`
  stacking, the wired-template read-only pane, the page stepper, the Filters popover.
  (2) The Report card's two fixed rows (Template, Records) via `RefInputRow`: the value
  preview for a frame/document and the dot placement. (3) A wired template whose Note
  changes its tags: `reconcileInputs` drops cables through a microtask — works in the
  engine tests, unseen on the canvas. (4) Write to Obsidian batch: per-page chart assets and
  block/append modes per page, desktop only, no test. (5) `MAX_PAGES` (500) truncates
  silently. (6) A literal `{{` in prose is now template syntax: knap has no raw block, the
  only escape is `{{ "{" }}{ x }}` (upstream item 10). (7) The Note card previews against
  the fields of the LAST commit (one blur behind while typing YAML) — by design, may read
  as stale. (8) No in-app help page for the template syntax: the catalog descriptions and
  the Filters cheat-sheet are all a user gets. (9) `first`/`nth` after `sort` are broken
  upstream (knap-upstream 1), so seeds route around them; a user will hit it.

### SESSION DIGEST (2026-09-09 — Personal Finance seed trimmed, 171→162 nodes)

Two functionality-preserving simplifications to the Personal Finance seed (generated by
`scripts/gen-personal-finance-seed.cjs` — edit the GENERATOR, then `node` it to re-emit the JSON;
`pfSeedCheck.test.ts` asserts exact lockstep). **(1) FV curve → a real TVM node.** The retirement
sparkline hand-rolled `pv*(1+i)^(12*c)+…` in an Expression over a years list; replaced by a `TvmNode`
that broadcasts a **months** list on `nper` into an FV curve (the `Years 1…N` Series now emits
12,24,… via literals start/step=12), reusing the scalar Projected-nest-egg node's own outflow
helpers (`expr-pmt`, `expr-pv`, `expr-mrate`). Verified the TVM broadcast equals the old formula
exactly (EquationNode outputs `numListOut`, so a list `nper` yields a list `fv` that feeds the
Sparkline). **(2) 8 report Text Input nodes → If-node literals.** Each verdict IF had a good/bad
`TextInputNode` wired to then/else; folded the words into the IF's own `stringLiterals` (autoLiterals
+ `pickSlot`/`typedLiteral` read them when the slot is unwired) and deleted all 8 inputs. Full suite
green. **(3) Dropped the one true orphan** `Inflation %/yr` (NumberInput, no in/out edges) and
tightened the Assumptions column + Advisor cluster it left (coords re-flowed in the generator;
tune-seeds can't run here — the JSON is generator-locked, so layout lives in the .cjs). The earlier
"orphan" `Sum by category` (GroupByFrame) is NOT dead — it and `fill-cat`/the Waterfall/Calendar
nodes are intentional self-displaying demos in the **New in 1.2** scene (terminal, shown on their
own cards). No other safe fold found: the remaining helper Expressions are shared or presentation
sign-flips, and the SumIfs/GroupBy/GetColumn/Aggregate primitives each demonstrate a technique.

### SESSION DIGEST (2026-09-09 — SEQUENCE node↔formula divergence killed at the source)

The Series `sequence` op diverged from the `=SEQUENCE` formula: node was `(count, start, step)`
1-D only, formula is Excel's `(rows, cols, start, step)` 2-D — arg 2 flipped meaning, and the node
couldn't make a grid. **Why nothing caught it:** the arity guard (`nodeFormulaArgParity.test.ts`,
the shareImpl ratchet) only scans nodes that dispatch through `resolveExcelFunction`; a node on its
own kernel is invisible to it, and its header defers those to per-function BEHAVIOURAL agreement
tests — which for SEQUENCE never existed. The `parity:false` note was the only marker, and it
understated the divergence. **Fix (convergence at the source):** the sequence op now adds a
`Columns` input (default 1) and dispatches straight to `resolveExcelFunction("SEQUENCE")(rows,
cols, start, step)` — ONE impl with the formula, so 2-D wrap and overflow can't drift; a
value-driven `reconcileRank` swaps the output socket list↔table (the Expression pattern; headless
keeps the last socket). Non-breaking: cols=1 is the old flat-list return, and the 3 seeds using the
op don't set cols. Routing through `resolveExcelFunction` also pulls the node INTO the arity guard
(4-arg call site), so it's now statically enforced too. `NODE_EXCEL` flipped to `parity:true`.
**Backstop added:** `tests/graph/nodes/arrayShapeParity.test.ts` — behavioural node↔formula parity
for the SHAPE-PARAMETRIC family (SEQUENCE, WRAPROWS/WRAPCOLS, TOCOL/TOROW), the class where the two
surfaces drift on capability. **Deliberately NOT built:** a blanket "every parity claim needs a
test" ratchet — 211 parity-claiming pairs are unverified, almost all trivially-correct scalar math
(SIN, ABS, SUM…), and the node↔formula arg mapping isn't machine-derivable, which is why the repo
uses targeted behavioural tests, not a universal harness. The durable pattern is: a node that
stands for one Excel function should compute by dispatching to that function (auto-guarded by the
arity scan, can't drift); the shape-parametric family is the priority for behavioural coverage.

### SESSION DIGEST (2026-09-09 — Sudoku seed rebuilt on 2-D Expression)

Rebuilt `sudoku-solver.json` now that the Expression node handles 2-D array formulas. The two
hand-typed incidence matrices are GONE — the 81×81 peer table and the 27×81 unit table are each
one Expression that broadcasts a cell-index column against its row (`SEQUENCE`/`TRANSPOSE`, with
`QUOTIENT`/`MOD` for row/col/box; `INT` and `FLOOR` reject a 2-D arg, `QUOTIENT` is the matrix-safe
floor-divide). Each MMULT+MAP stage folded into a single Expression, so the three techniques read
as one node each (naked singles, hidden singles, naked pairs). File 935→388 lines, internal nodes
44→24. **Gotcha (why the tails aren't pure Expression):** an Expression's output socket only
reconciles to `matrix` via a microtask that needs an active editor/view, so HEADLESS its socket
stays rank-1 `number`; a CompositeOutput's MutableSocket then adapts to that and mis-coerces the
real matrix (#SHAPE! on the 9×9, `true`→`1` on the flag). Fix: end each output tail on a
genuine-socket node — a TableReshape (wraprows) for the grid, a Comparison (=0) for Solved —
fed by folded Expressions. The feedback merge stays a MapTable (`IF(value2=value2, value2, value)`):
on sim round 0 the feedback edge is unresolved, and MapTable falls back to its primary table while
an Expression would default the unwired var to scalar 0. `sudokuSeed.test.ts` unchanged and green.

### SESSION DIGEST (2026-09-08 — display fixes: collapsed-group dates, complex both-parts, socket peek gating)

Three display-layer fixes, each behind its own test:
- **Collapsed-group readout renders a date as a date, not a serial.** A Display member of a
  collapsed group fell through `formatReadout`'s numeric text path, so a singular Date showed its
  raw serial. Now routes the unannotated-date case through `dateFormatDisplay` (the Display
  surface's own helper), keyed off the `nodeOutputElemFamily("date")` lookup the row already uses
  for date arrays. `GroupNode.tsx`.
- **Complex DISPLAY always shows both parts** (`0 + 4i`, `23 + 0i`). `assembleCx` gained a
  `bothParts` flag; `formatCxDisplay` (new) + `formatCxWithAnnotation` pass it, and every display
  seam (value box, chips, readouts, clipboard) routes through them, so the unit always wraps the
  two-term form `(0 + 2i) V`. The Excel/coercion form (`formatCx`, `&`, cast-to-text, `IM*`) still
  drops a zero part for parity and round-trips with `parseCx`. Pinned in `format-model.md`.
- **Socket hover value-peek arms only on chip-summary kinds** (`isChipSummaryPeek` in
  `valuePeekKind.ts`): frame/cube/table/list/chart/diagram/svg/lambda — the values whose face is a
  summary chip hiding content. A scalar/string/error is already shown in full, so its peek was pure
  repetition. One gate in `NodeSocket.tsx`; the example-hint path is untouched.
- **Group Cost Settle gains a Transactions mode** (`SettleMode` "totals" | "transactions", author
  2026-09-08). Totals is unchanged (people frame, Paid + optional Share weight). Transactions reads
  a CUBE ledger — one row per expense: an Amount, a Paid by (a name or a list for a shared bill), and
  a For list of beneficiaries, split EQUALLY (no weights); blank For = the whole roster. Payers and
  beneficiaries are independent sets, so a bill one person fronts redistributes to a different group.
  `settleLedger` (pure, `settleOps.ts`) aggregates per-person Paid/Owes and feeds the shared
  `minTransfers` greedy core (extracted from `settleGroup`); `settleLedgerCube` (`frame.ts`) reads
  the cube and shapes the same Transfers/Net frames, carrying the Amount column's currency.
  The `mode` toggle retypes the SINGLE input socket "in" IN PLACE (People frame ↔ Ledger cube,
  `setMode` reassigns `input.socket`); the key never changes, so a wired cable survives the swap.
  Outputs never change, no output retype. Node is `unitAware`.
  **Ghost cable on an incompatible mode change (author 2026-09-08d):** the component does NOT drop
  the cable — if the source no longer fits the retyped socket it MARKS it a ghost (`cableGhostStore`,
  reusing the splice-ghost dashed render + click-to-commit); a ghosted "in" does not feed
  (`SettleNode.inGhosted` → empty, not a #VALUE! from coercing the wrong type). Flip the upstream
  source back to a compatible type and one click on the dashed cable commits it (FlowCableEdge gates
  the commit on `canConnectTo`, then `processGraph(target)` to recompute). Verified live end-to-end.
  **Net frame is a TRUE-COST balance (author 2026-09-08c, final):** Person · Paid · Owes · Owed ·
  Net, where **Net = Paid + Owes + Owed = the fair share** (a person's real cost, NOT their
  balance). Paid = fronted/external; Owes = still owed to the group (+); Owed = coming back from
  the group (−). One of Owes/Owed is 0 per person (the settlement is a pure payer or receiver).
  In equal-split totals every Net matches (everyone's true cost is the same). `settleNetFrame`
  (frame.ts) derives Owes/Owed from `diff = share − paid`; `settleGroup`/`settleLedger` just return
  paid + fair share (the earlier gross-cross-flow model was overcomplicated and dropped). The **transfers** frame is the main output, now the labelled
  hero at the BOTTOM of the card ("WHO PAYS WHOM") with the Net breakdown on top.
  Seed "Trip split" rebuilt: 5 people, 8 expenses (multi-payer, sub-groups, a reimbursement to a
  different person), a totals frame AND a cube ledger through an Input Switch into one Settle, plus a
  **Sankey** of the transfers (`SankeyNode` reads From·To·Amount by position) beside the Net table.
- **Input Switch** (`CableSwitchNode`): the one-way Cycle button is now a bidirectional stepper
  (Record pager); `select()` re-settles wildcard types (`reconcileTypesAfterEdit`) so the passthrough
  output re-adopts on an active-input change (cube ↔ frame) instead of keeping the stale type; card
  widened to 250 for the stepper.

### SESSION DIGEST (2026-09-07e — demo vault deepened, two Obsidian seeds added)

Widened the `demo-vault/` fixture and added two seeds to the **Obsidian** group. Vault: Projects
now 6 notes (all four `status` values), Notes has 3 books (one with no `finished`, so a null
column) + a second meeting, Daily runs `2026-08-25`→`2026-09-07` (14 days, enough for a rolling
average), Tasks is 8 (open/in-progress/done, recurrence + `complete_instances` + block
`timeEntries`), People gains Priya, and a `Solenoid/` stub note shows item D's shape. The pinned
fixtures (`vaultCube.test.ts`, `run-graph-vault.test.ts`, `frontmatterPatch.test.ts`) were left
untouched — additions only — so all 254 tests still pass. Seeds: **`write-back-to-obsidian`** (B
loop — a Projects snapshot → Computed Column `health` from status+priority → a disarmed Write
Properties) and **`daily-habits`** (R3 — a Daily snapshot → Window rolling_avg → smoothed line
chart), both on the snapshot-plus-disarmed-live-node shape so they run on web. Geometry baked by
`tune-seeds.mjs`. **Gotcha noted, not fixed:** a Vault Folder emits a `cube`, and the row verbs
adopt it, but the frame-only verbs (Window, GROUPBY, Chart's frame input) still refuse a cube —
so the daily time-series compute runs on the snapshot, not the live cube. Charting/smoothing a
live vault folder needs A′ extended to a cube→frame step (or those verbs made cube-adoptive);
that's the honest gap behind the seed's "swap in the Vault Folder" note wording.

### SESSION DIGEST (2026-09-07e — Gantt research: the landscape, the spec, the separate-repo plan)

The author asked for a big outside-in research pass on Gantt and project-planning software, not
built on the existing Schedule node: which open / free / embeddable libraries exist, whether one
standout repo should be adopted or matched, and whether a separate repo combining the best of the
mid-tier ones is the right call. Six research passes (libraries; scheduling semantics, engines and
formats; open-source and data-first apps; commercial benchmarks and UX; text and plotting
approaches; library internals and headless precedents) landed in **`v2.0/25-gantt.md`** (PROPOSAL,
Arc 8). Verdict: no permissive repo to adopt whole (every vendor's seam is "anything that computes
dates"); the standout to match is Microsoft Project's semantics with MPXJ's `MicrosoftScheduler` as
the open oracle and Project-authored MSPDI files as golden tests; recommend a separate MIT headless
toolkit (`schedule-engine` · `gantt-layout` · `gantt-dom` · `gantt-react` · `project-io`) that
Solenoid binds through a Plan node family and a `chart`-socket Gantt figure. Findings that matter:
DHTMLX 10 relicensed to MIT with readable sources (its scale manager and link router are
vendorable); SVAR is a hand-written React mirror over a framework-free MIT store; Huly carries the
one modern TypeScript CPM core (EPL, read-only); the consumer "auto-shift" switch dissolves in a
pure-function model (gap = lag, typed date = SNET, manual = flag); Excel serials are already the
zone-less day representation a scheduling engine wants. Ten author calls in the doc's § 10; the
"no bar editing" ruling stays the default until its phase 5.
**Revised the same day** after the author asked for an adversarial review, a sweep of online
user pain points, and a scope: two red teams (product fit against the repo's rules; engineering
claims verified against live sources and clones) and a ~95-source user sweep. What changed
(`25-gantt.md` § 13): the data model is the author's Cube (nesting = WBS, Predecessors a list or
a nested Task · Type · Lag table; the flat two-frame form is `Unnest` and the import shape), the
figure never writes and "no bar editing ever" is no longer softened, MPXJ is a second opinion
not an oracle and its `junit/data` is mostly binary `.mpp` (the corpus is authored on a Project
trial), four of the sixteen rules were corrected (free slack per link on the predecessor
calendar; a deadline moves an ALAP task; out-of-sequence progress; tenths of a minute), the
packages live as npm workspaces inside this repo (every cited precedent is a monorepo; the
source-scan tests and the corpus directory cannot reach a second repo), Days and Minutes are
engine modes with an inclusive Finish on the cell, and one rule (Start = floor, Finish =
ceiling, Deadline = flag, Manual = pin) replaces the consumer shift switch. The sweep's top
complaint is dates moving from hidden state; the keepers are cascade, typed predecessors, a
kept gap, flagging anchors, calendars, milestones, today line, baseline ghost, printing. Scope
(§ 12): the spreadsheet user's and tinkerer's Gantt; not a PMO tool (no leveling, no XER, no
bar dragging).

### SESSION DIGEST (2026-09-07d — the pitch read: the Obsidian + TaskNotes surface verified, the mdbase ceiling)

The author is writing the pitch copy and asked for the integration surface as it stands, verified
against `develop` (a stale local `develop` was three days behind origin; hard-reset). The surface
matches `node-coverage.md` § Connections & sinks and the per-item entries — nothing to correct in
the code; the reading is the pitch's fact sheet. Doc drift fixed: the bundle doc's § What stands
today still listed the stub note, mdbase validation, `writeBase` and the F1 seed as open (all
landed, per the code and the 09-07b digest), and two node-coverage "Not yet" clauses (the stub
note, Write Tasks) pointed at items that had landed in the same file. **mdbase ruling**
(decisions mdbaseCeiling): mdbase is an optional schema beside the notes, not TaskNotes' storage;
what stands (schema-first typing in Vault Folder, refuse-on-violation in Write Properties, silent
fallthrough) is the whole integration — no type-file writer, no query passthrough, one clause in
the pitch. A blended Solenoid + TaskNotes `_types/` schema is the user's to write and works today;
untested: how mdbase resolves two types matching one glob, and whether a TaskNotes upgrade
rewrites its shipped type file. Not-to-claim list for the copy: no `![[Note]]` transclusion on
write (inlined; deferrals), no `/api/nlp/create`, checkbox ticks in an imported note never write
back, nothing runs in the browser build.

### SESSION DIGEST (2026-09-07c — the new nodes' formula surface + the Add menu after the bundle)

**Formula surface:** of the nodes the Obsidian / Track H / C1 sessions added, only Time Zone
Convert is a scalar function both surfaces can hold, so it now registers as `TIMEZONECONVERT`
(the node's own `convertZone`, node↔formula agreement pinned in `timeZone.test.ts`; `timeZone.ts`
imports the frame TYPE only, so the rete-free walk stays clean). Everything else is excluded by
the parity rule itself, not by omission: Geocode / Weather / Holidays / Currency / Vault Folder /
TaskNotes are sources, the Write nodes are sinks, QR Code and World Clock are figures, and
Allocator / Schedule / Payoff Planner / Group Cost Settle are frame verbs (frames stay out of
formulas — matricesInFormulas). Node → formula stands at 100% of in-scope leaves.
**Add menu:** the bundle had pushed Connections to 16 flat rows (the panel scrolled) and Analyze to
9. Connections is now sources → an Import HTML / XML pair → Write File → the keyless lookups as
two pairs (Geocode · Weather, Holidays · Currency) → an **Obsidian** submenu holding the six vault
nodes; the four planners moved from Analyze to a sibling **Plan** submenu (rows in, a plan out);
Cube Input joined the literal sources in Input under Frame Input (frame accent) instead of the
Cubes submenu; COMPLEX · LAMBDA and Append · Bind Columns pair up so Input and Table verbs stay at
the validator's soft row max. Every new node ranks first for its obvious search word. Still over
the soft max, unchanged: Date & Time (17 rows, five of them pack rows appended after Save Times)
and Visuals (QR Code lands after the sub-categories) — pack placements push to the end of a
category, so a pack leaf always trails the core rows; a fix would be an insertion policy in
`catalogUtils`, not a catalog edit.

### SESSION DIGEST (2026-09-07b — three agents: the Obsidian bundle lands, Track H, the Cube Input editor)

**Obsidian + TaskNotes** is the author's adoption bet (backlog § Obsidian + TaskNotes). Landed
across the three agents, ledger in the bundle doc's § What stands today: A (Vault Folder → cube),
A′ (row verbs take cubes, `recordsToCube` the one rows-of-objects → cube shape), B (Write
Properties with plan / Preview / Run + mdbase validation), C (widgets), D (Open in Obsidian, the
graph stub note + `solenoid:` backlink), E (vault watch), F (TaskNotes node: tasks / calendar /
stats; Write Tasks), F6, I, J, R5, the Weather and Holidays nodes, the headless `run-graph`
seam (`FsProvider` + `--vault` / `--tasknotes` / `--run`). Seeds: vault-as-a-table,
kitchen-remodel-tasknotes, garden-dashboard, which-task-next. **Track H**: Payoff Planner (H1),
Group Cost Settle (H3), the hours allocator seed (H3.5), Schedule (H6) over a tasks CUBE — the
author's ruling that nothing is designed around an in-cell string list. **Cube Input** is the
fourth literal source; its popup edits every level in ONE window (drill, never a popup above a
popup), and List Input got the same popup (subsystem-invariants § Literal input editors).
**Review pass** (author: "so much added, all three go and review"): the error guard now passes a
THROWN SolError through with its code (a Filter on an empty frame read `#ERROR! [object Object]`);
the Schedule catalog copy caught up with list-cell Predecessors; seed note copy fixed
(trip-split's escaped newlines, remodel-gantt's repetition). Peers' findings: be stripped agent-speak from four demo notes, made Vault Folder's folder the same subfolder dropdown Write to Obsidian uses, and the stamp (Link to graph) is now OPT-IN by the author's ruling (Preview names the `Solenoid/<doc>.md` stub when on); fe folded doubled parentheticals in Schedule / Allocator socketDocs, made Payoff's order picker a SegToggle, kept the chip on an empty Frame Input, and renumbered the seeds into group bands (Obsidian right after Start here). Open for the author: the Cube Input editor commits per cell while Table / Frame Input hold a draft with Save.

### SESSION DIGEST (2026-09-07 — Obsidian bundle 24 item A: Vault Folder → Cube)

A **demo vault** (`demo-vault/`, committed) is the single-source fixture + the author's eyeball
vault: an mdbase collection (Projects, list + nested-milestone cells), a plain Notes folder typed
via `.obsidian/types.json` + guesser, a daily-notes folder, TaskNotes-shaped tasks, People link
targets, one Bases view, wikilinks/embeds/tags. The pure-core tests read it directly (no
`tests/fixtures/vault/` mirror). **Item A shipped:** `vaultCube.ts` `notesToCube` → ONE cube, a
row per note: the Bases `file.*` built-ins + the frontmatter union; scalars typed, lists as list
cells, rows-of-objects as nested frames. Typing per key mdbase → `.obsidian/types.json` → guesser
widened across rows (`mdbaseTypes.ts` via the new `yaml` dep, `obsidianTypes.ts`, `vaultTypes.ts`);
ISO datetimes upgrade to fractional serials in the reader (kept local, noteFrontmatter untouched).
R3 `dateFromName` parses the file name into the `date` column; `dailyNotesConfig.ts` gives its
default format. `VaultFolderNode` (first cube-emitting connection node, Connections menu): desktop
-only local read (no C2 network gate), sync `data()` + a background read that walks up for
`mdbase.yaml`/`_types`, reads `.obsidian/types.json` + `daily-notes.json`, calls notesToCube;
per-node vault chip. `statVaultFile` bridge + `fs:allow-stat` / `.yaml` read for created/modified +
mdbase schemas (architecture.md desktop note). Left: the "Your vault as a table" seed (waits on
fe's A′ so the cube can Filter/Sort). Sequenced with fe (A′) and the Lead (F TaskNotes) on develop.
