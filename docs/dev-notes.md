# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-08-30 — the 1.3 cut + the model-layer rename)

**The author cut 1.3's scope**: user-facing polish/perf is DONE; what remained was easy
under-the-hood work + the release tail. Backlog reconciled to that (landed items deleted,
the rest parked in `deferrals.md` with the author's calls recorded per item). Landed this
session: **AI palette ships DISABLED** (`AI_ENABLED = false` in `aiKey.ts` gates the
sparkle, the Settings section and the What's-New slide; verification tail parked in
deferrals — flip the flag to restore everything); **composite-workbench goal-seeks
value-pinned** (`gsComp`/`fvComp` — a goal-seek's output port emits the SOLVED DRIVER
value, composite.ts runGoalSeek); **the undo "1px drift" root-caused and fixed** — not
snapshot rounding: the post-load FC re-dock re-measures the host socket from screen rects
÷ zoom, and an odd FC height puts `cy − h/2` exactly on .5, so sub-pixel wobble made
Math.round a per-load coin flip; `computeDockedCanvasPos` now snaps the measured offset
to the half-px grid, and `scripts/undo-drift-probe.mjs` (+ `__spike.positions()`) pins
restore ≡ pre-edit on the real page across a zoom change. **Tests moved to a mirrored
`tests/` tree** (author mid-session order): all 273 suites at `tests/<old src path>`,
imports rewritten, source-scanning sweeps re-aimed at `src/`, tsconfig/vitest/docs updated.
**Model layer, the last two cuts, LANDED**: `area`→`view` everywhere (`view.ts` /
`flowView.ts` / `viewPresets.ts`, `getView`/`getActiveView`/`getOwningView`, `View` type),
the `nodeViews`/`connectionViews` Maps replaced by `view.position(id)`/`view.nodeElement(id)`
/`view.connectionElement(id)`/`view.hasNode(id)`, and **position moved ONTO the node**
(`SolenoidNode.position`, stamped by every model add path) — `FlowModel.positions`, the
per-surface maps and `syncViews` reconciliation deleted. Docs follow the rename
(subsystem-invariants RF contract, glossary "View", architecture, README routing).
Also: stale backlog items closed as already-fixed (mode-selector wired blank — the
readInputSweep floor covers it) or dropped by the author (tablet header blackout, Script
timeout pin, table-popup virtualization "don't really care" → deferrals).
**Document tabs ruled and deferred (author):** tabs are PAGES IN ONE DOCUMENT — not
concurrently-loaded library docs with cross-doc references (that fork weighed, rejected).
Whole feature to 2.0; the infrastructure audit's carryovers live in the deferrals entry
(drill-in as the surface template, unmounted stacks work post-View-rework, single-engine
option, the flat nodeNameStore/forgetAllNodes blockers if pages ever get own editors).
**Number→text predicates RESOLVED by the author (option b → rules textPredicateNeedsText):**
`contains`/`startsWith`/`endsWith` on a non-string column or list is now `#TYPE!` with a
fix-naming message (Computed Column `TEXT(@col, "@")`, or Cast to Text) — gates
`requireTextColumn`/`requireTextList` (frameVerbs) + `require_text_column` (engine.rs) on
every filter entry (Filter verbs, List Filter, *IFS criteria). The Rust `js_number_string`
JS-printing mirror is DELETED (its reason to exist was the old `String(cell)` comparison);
corpus `filter.json`/`filterMulti.json` pin `#TYPE!` on both engines (cargo 30/30 green).
**Rules-spec tail closed:** socketBox12's rendering half is now `scripts/socket-box-probe.mjs`
(+ `__spike.connections()`): three seeds × two zooms, every card Handle box ≡ glyph box at
`--socket-size`, no transform, every plain cable ends on its Handle's RIM — RF's
`getHandlePosition` gives the rim point, not the center, which is why a naive center check
reads 6px·k off — Conduit lanes exempt (`conduitLaneOffset`). 256 handles / 90 cables clean.
The read-as spec-promotion was conditional ("if config-driven coercions grow") and the
trigger never fired: the sites are still Get Column read-as + Frame/Table Input through
`coerceFrameCell`, sharing `coerceLogical`, pinned by `getColumnReadAs.test.ts`; dropped, no
rule. oneResolvePredicate stays the one recorded-un-greppable rule.
**Author-reported fixes:** (1) an attached FC spawned at canvas (0,0) — Cutover A deleted the
rete-era `nodecreated` pipe that called `dockSelf`, so `attachFormatController` never
registered the dock and skipped the placement; it now calls `dockSelf` itself. (2) "node is
not initialized" on Host → FC → FC, delete the middle: the RF port had swapped the main
canvas's delete to bare `removeNodes` (ungated per-cable removes → un-awaited targeted
passes still fetching the node the engine just dropped; the ghost-cable / Conduit-lane
splice silently lost too). Delete is `deleteSelection` again, and `runGraphPass` skips a
node removed mid-pass (`fcChainDelete.test.ts` pins both). (3) FC chip stepped 1px wider on
dropdown hover: `LazySelect` locked `offsetWidth` (integer) against a fractional
max-content width; it now locks `ceil(getComputedStyle().width)`. (4) Title edit: the
caret lands where the header was tapped (`textOffsetAtPoint` via caretPositionFromPoint,
applied after the textarea's autoFocus).

### SESSION DIGEST (2026-08-29b — OP and ARG made structurally distinct)

**Author order: "MAKE THESE FULLY DISTINCT THINGS."** The blend was three shared seams — one
field name (`op`) for both, one component with a flag (`OpSelect arg` / `SegToggle arg`), and
a `kind` switch on `NODE_OPS` saying which — and each had drifted (argument families accented,
21 pickerless classes declared `argument`, Gauge/Proportion accented with nothing searchable,
DESIGN.md counting "fourteen" and naming a deleted node). Now the field name IS the
classification (rules opArgDistinct, DESIGN.md § Op pickers has the two-column table):
`op` ⇔ OP family in `NODE_OPS` ⇔ `OpSelect`/`OpToggle` (hoisted, accented, searchable, a
function per op); anything else ⇔ ARG ⇔ `ArgSelect`/`SegToggle` (neutral, in its row, a
parameter of the host's function). `kind`, `opKindForNode`, `data-op-kind`, `data-op-arg`
and the `arg` prop are gone; `NODE_OPS` lists OP families only (Surface kept: two leaves).
Twenty argument families renamed their field (Sort `order`, Group By/Running/Window/Cube
Rollup/Group By-frame/Pivot `agg`, Record `view`, Gauge `style`, Proportion `layout`,
Headers `action`, Alert `condition`, Color Blend + Drop Blank Rows `mode`, Hash `algorithm`,
Antoine `substance`, Resistor `bands`, Pipe Roughness `material`, Pad Text `side`, Element
`symbol`); seeds + the PF generator + `INIT_FIELD_ORDER` follow (noBackCompat). The generic
select style is `solenoid-node__select`; `--op` is the modifier that hoists and edges.
Pinned both ways: `nodeOps.test.ts` (string `op` ⇔ declared) and `sourceInvariants`
opArgDistinct (op pickers bind `op`; arg pickers never; no `arg` prop). Also this session:
DESIGN.md reconciled to the code for the three width tiers (180/210 medium/240), no
resting card shadow (`--shadow-card` lives only under in-card popovers), and the full
socket glyph set incl. the `anydata` hollow square. Leftover for the author: the group
HEADER still casts a resting `0 1px 3px` shadow (`GroupNode.css`). **Running loses its
Cumulative / Last N toggle** (author): the Window socket is always there and 0 (the literal
default) means cumulative, matching `RUNNING(op, list, [window])` where the arg is optional.
**Gauge, Proportion and Record are OP families after all** (author: "treemap" must land on a
row that says Treemap): op rows "Proportion: Treemap", "Gauge: Dial", "Record: Gallery", field
back to `op`, `OpToggle`/`OpSelect` on the card; BAR joins the cross-family name allowance.
**Alias search rows drop a self-repeating host** (author: "RIGHT: RIGHTB" reads wrong): when
the host leaf is itself a function name the row is the alias alone ("RIGHTB", "SLOPE",
"COUNTIF"; 41 rows); "Table Size: ROWS" keeps the Host: Name shape (`excelEntry`).
**The byte-counting B twins are OUT OF SCOPE** (LENB/LEFTB/MIDB/RIGHTB/FINDB/SEARCHB/REPLACEB):
they were formula aliases + alias search rows with no affordance of their own, a node↔formula
divergence by construction (author). Gone from `excelFunctions`/`formulaSignatures`/the alias
table; listed with ASC/DBCS/PHONETIC in the out-of-scope entries of `nodeExcel.ts`.
**The Document chip opens a real panel for Notes** (author): `ReportOverlay` opened on a Note
(plain or Obsidian) shows it read-only, preview pane only, same dock/close/Esc chrome; the
chip no longer flies to the card. "Obsidian Note" is "Import Obsidian Note".
