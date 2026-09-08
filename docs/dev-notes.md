# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

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
