# Bundle 11 — Trust & data-quality: expectations, Problems panel, where-used, Reconcile, fuzzing, Tornado, comments

**Source:** scope-features #12, #30, #31, #32, #44, #45, #14 — all IN. Grouped because
they share machinery (the `HudStack` panel family) and a standing principle (prefer a
node over a new panel). Each sub-item below is close to independently assignable to a
different agent — call out the shared pieces (Problems panel, HudStack) so two agents
touching it don't collide; otherwise these can run in parallel.

**Shared UI rule for this whole bundle:** new HUD-style panels extend the existing
`HudStack` family (`src/graph/components/HudStack.tsx`, `PinLayer.tsx`, `AlertLayer.tsx`)
— don't build a fourth/fifth standalone panel. Comments (#14) and the Problems panel
(#30) both join that stack.

---

## #12 — Expectation nodes: the data-quality gate (IN)

**The pitch:** an Expect node sits on a cable and declares: this column is never null;
IDs are unique; amounts are in [0, 1e9]; row count within 20% of last snapshot. Green
badge when true; a tagged failure + Alert when not.

**Build:**
1. One Expect node, four checks: not-null, unique, range, regex. Pass-through output,
   red badge + Alert on failure (reuse the existing tagged-`SolError`/Alert machinery —
   a failed expectation is just a new `SolError` with provenance, per bundle 04).
2. **Pitch it in the UI/docs as "Data Validation, generalized"** (author's explicit
   framing) — Excel's Data Validation gates what a human types; this gates whatever
   flows through the graph. Reconcile with the existing Data Validation verdict in
   `excel-toolbar-supplementals.md` when writing the catalog entry.
3. Keep strictly opt-in (user-placed nodes only, never automatic warnings) — nag-fatigue
   is the whole design risk here, consistent with the no-Captain-Obvious rule.

## #30 — The Problems panel (IN)

**Build:** a panel listing every error value currently in the graph (code, message,
node, and for frames the cell) — click to jump-and-flash (reuse the navigator's
jump/flash gesture). Filter by code, badge count in the StatusBar. Collect via
`isSolError` hits during a normal compute pass into a store — cheap, every pass already
touches every output value. Extend with bundle 04's provenance once available ("…caused
by [origin node]"), and receives entries from #44 (fuzzing) below.

## #31 — Where-used: highlight the connected stream (IN, scoped down)

**Explicit scope for v1 (author's condition):** NOT the full query-box/search-syntax
version (`uses:`/`col:`/`unit:` etc.) — that's a possible later extension, not the
committed first step.

**Build:** right-click a node → highlight its whole connected stream, using the
`downstreamClosure` BFS that already exists (`src/graph/process.ts:418`), surfaced as
canvas dim-and-highlight (everything not in the closure dims, the closure itself stays
full brightness).

## #32 — The Reconcile node (IN)

**Not gated on snapshots** (#6, deferred) — the two inputs are commonly just two Filter
nodes off one shared live source ("month = Jan" / "month = Feb"), not two separately
snapshotted datasets. Buildable now.

**Build:** a two-input verb node — match rows by key, classify added/removed/changed
(with per-column deltas), and a contribution-breakdown layer: "total moved +230k: +180k
added rows, −40k removed rows, +90k price changes on matched rows, offset −0k mix" (a
bounded, well-known price/volume/mix decomposition, not novel math). Output is a frame
(feeds charts/expectations/alerts) plus a readable summary. Reuses the existing join
machinery.

## #44 — Model fuzzing: property-based testing for graphs (IN, refined)

**Refinement (author's explicit correction — don't ship the naive passive version):**
a fuzzing finding should NOT be just a passive Problems-panel log entry. Where the finding
is mechanical (an out-of-range value, an overflow), it should directly **suggest inserting
a CLAMP or similar cleansing node** at the offending spot — a one-click fix, same spirit
as the (ruled-out) linter's "promote to named Input" idea, applied here even though the
linter itself stays OUT.

**Build:** because every input socket is typed (and ranged, once expectations declare
bounds), generate hundreds of valid-shaped inputs and hunt for what breaks (errors,
NaN/Infinity leaks, `#SHAPE!`, expectation violations). "Probe my model" button. Findings
land in the Problems panel (#30) with the CLAMP-insertion suggestion attached where
mechanical.

## #45 — Tornado ranking (IN — AS A NODE, not a panel)

**Standing principle enforced here explicitly (this is the item that established it):**
NOT an ambient "click any output, a floating panel appears" mechanic. A **Tornado node**:
wire a value in, a button ON the node runs the analysis, the node renders its own chart
inline.

**Build:** perturb each upstream input (±10% or its declared range) via bundle 09's
run-N-times machinery, rank by impact on the wired output, render the classic tornado
chart inline on the node card. The existing Sensitivity node is this node's seed,
generalized to automatic/all-inputs/ranked.

## #14 — Node-anchored comments (IN)

**Build:** right-click a node → "Add comment" — goes into a dedicated comment pane,
same `HudStack` pattern as Alerts and pins (a stacked list, not a per-node hover-only
badge). A comment is: author, text, resolved flag, stored in the save. A small corner
indicator on the node itself is fine as a pointer back, but the pane is where you
read/manage them. Single-user, it's immediately useful as "notes to self with an
address." Don't build identity/permissions infrastructure — a name string in a local
file is the whole 1.0 of this.

---

## Exit criteria (whole bundle)

Expect node (4 checks) ships and is opt-in only; a Problems panel lists every tagged
error in the doc with jump-to-node; right-click highlights a node's downstream closure;
a Reconcile node produces added/removed/changed + price/volume/mix on two frame inputs;
model fuzzing surfaces findings in the Problems panel with CLAMP-node suggestions where
mechanical; a Tornado node runs sensitivity analysis and renders its own chart; node
comments exist, stored in the save, surfaced in a comment pane alongside Alerts/pins.
