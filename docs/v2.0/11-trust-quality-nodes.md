# Bundle 11 — Trust & data-quality: expectations, Problems panel, where-used, Reconcile, fuzzing, Tornado, comments

**Source:** scope-features #12, #30, #31, #32, #44, #45, #14 — all IN.

**Correction to the original plan draft — read before building:** `HudStack` is NOT a
generic list-panel API new panels can plug into. `src/graph/components/HudStack.tsx:14-22`
is a hardcoded `<PinLayer/><AlertLayer/>` stack rendered via `createPortal`. Each panel
(`PinLayer.tsx`, `AlertLayer.tsx`) is fully bespoke — its own `useState(collapsed)`, own
trigger button, own mobile auto-collapse effect, own `registerChrome` call. **A new
Problems/Comments panel must be written as its own new component file** (same shape as
`PinLayer`/`AlertLayer`, not extending a shared base — there isn't one) and manually
added as a third/fourth child in `HudStack.tsx`'s JSX. Registration:
`registerChrome(key: string, toggle: {isOpen, setOpen}): () => void`
(`src/graph/chromeToggle.ts:12-15`); existing keys are `"navigator"`
(`OutlinePanel.tsx:274`), `"pins"` (`PinLayer.tsx:114`), `"alerts"`
(`AlertLayer.tsx:97`) — pick new unique keys (`"problems"`, `"comments"`).
`toggleAllChrome()` (`chromeToggle.ts:22-28`) flips the whole group on Tab.

**Second correction: no "jump-and-flash" gesture exists anywhere in the codebase today**
— it's aspirational doc language from earlier scope-features/backlog text, not a real
function. Confirmed by repo-wide grep for `flash`/`jumpAndFlash` — no CSS keyframe, no
timed-highlight implementation. What DOES exist: `flyToNode(nodeId): void`
(`src/graph/flyToNode.ts:14`, pan/zoom only, reused by `PinLayer.tsx:143,166`/
`AlertLayer.tsx:118`) and `OutlinePanel.tsx:150-166`'s `focusNode(id)` (pan/zoom via
`area.area.translate`, then `selectNode(id,false)` for a select-ring highlight — no timed
flash), triggered by `handleRowDoubleClick` (`OutlinePanel.tsx:331-334`). **Every item
below that calls for "jump and flash" must actually BUILD the flash** (e.g. toggle a CSS
class + `setTimeout` removal) alongside calling `flyToNode`/`focusNode` — don't write
"reuse the existing flash," there isn't one.

---

## #12 — Expectation nodes: the data-quality gate (IN)

**Build:** one Expect node, four checks (not-null/unique/range/regex). Pass-through
output, red badge + Alert on failure — reuse `fireAlert` (`alertStore.ts:70-73`) and the
`SolError`/`ErrorChip` pattern (`errorValue.ts:70-75`, `components/ErrorChip.tsx:12-27`,
both detailed in bundle 04) for a failed expectation. Pitch in the UI/docs as "Data
Validation, generalized" (author's framing) — reconcile with the existing verdict in
`excel-toolbar-supplementals.md`. Keep strictly opt-in.

## #30 — The Problems panel (IN)

**Build:** a new component file (`ProblemsPanel.tsx` or similar), same shape as
`PinLayer.tsx`/`AlertLayer.tsx` (own state, own `registerChrome("problems", ...)` call),
added as a new child in `HudStack.tsx`. Collect entries by hooking the same
`isSolError`-detection point `installErrorGuards` already sees (`errorValue.ts:156-203`,
detailed in bundle 04) into a store during a normal compute pass — cheap, every pass
already touches every output value. Each entry needs a real jump-and-flash: call
`flyToNode(nodeId)` (`flyToNode.ts:14`) then toggle a new CSS flash class on that node's
element (build this — see correction above). Filter by code; badge count in
`StatusBar.tsx`. Extend with bundle 04's `origin` field once available ("…caused by").
Receives entries from #44 (fuzzing) below.

## #31 — Where-used: highlight the connected stream (IN, scoped down)

**Explicit scope for v1:** NOT the full query-box/search-syntax version.

**Build:** right-click a node → `downstreamClosure(editor, startId)`
(`src/graph/process.ts:418-430`, pure BFS, confirmed its only current caller is the
targeted-recompute path at `process.ts:477` plus tests — no UI reuses it yet). **Reuse
the existing isolate/dim mechanism for the visual, don't build new dim CSS:**
`src/graph/isolateStore.ts` — `isolateStore.set(ids)/exit()/isVisible(id)/isActive()`
(lines 13-35, module singleton, "everything else recedes, dimmed + non-interactive"),
plus `chainClosure(edges, seed): Set<string>` (59-73, bidirectional BFS already used for
chain-based isolation). Feed `downstreamClosure`'s result set straight into
`isolateStore.set(...)` — check `IsolatePill.tsx`/`IsolateEndpoints.tsx`/`isolate.ts`
first for how dimming is currently painted, since that rendering already exists and
should be reused, not reinvented.

## #32 — The Reconcile node (IN)

**Not gated on snapshots** (#6, deferred) — buildable now.

**Build:** a two-input verb node. Match rows by key using the existing join machinery —
`joinFrames(left, right, opts)` (`src/graph/frameVerbs.ts:378`,
`JoinOpts = {leftKey, rightKey, how}` at line 351-352, key-indexing via `keyIndex()`
lines 361-371, skips null/error keys) — then classify added/removed/changed with
per-column deltas, plus a contribution-breakdown layer (bounded price/volume/mix
decomposition, not novel math). Output is a frame (feeds charts/expectations/alerts)
plus a readable summary.

## #44 — Model fuzzing: property-based testing for graphs (IN, refined)

**Refinement (don't ship the passive-only version):** a mechanical finding should
directly suggest inserting a CLAMP/cleansing node at the offending spot.

**Build:** generate hundreds of valid-shaped inputs per typed socket, hunt for what
breaks (errors, NaN/Infinity leaks, `#SHAPE!`, expectation violations from #12).
Findings land in the Problems panel (#30 above) with the CLAMP-insertion suggestion
attached where mechanical (a one-click "insert CLAMP here" action, reusing whatever node-
insertion API the Add menu / quick-wire (bundle 14) already exposes for inserting a node
mid-cable).

## #45 — Tornado ranking (IN — AS A NODE)

**Confirmed genuinely new** — `DecisionSensitivityNode` (`nodes/frame.ts:737-759`,
detailed in bundle 09/10) is Decision-Matrix-specific scenario sensitivity, NOT a
generic parameter sweep; there is no existing one-at-a-time-sweep primitive to extend.

**Build:** a Tornado node — wire a value in, a button on the node runs the analysis
(perturb each upstream input ±10% or its declared range, using bundle 09's run-N-times
machinery once available), ranks by impact on the wired output, renders the tornado
chart inline on the node card (reuse the existing chart-rendering approach from
`nodes/visual.ts`'s recharts nodes).

## #14 — Node-anchored comments (IN)

**Build:** right-click a node → "Add comment." Following the `HudStack` correction
above, this is a NEW bespoke panel component (comment pane), added as another child in
`HudStack.tsx`, registered via `registerChrome("comments", ...)`. A comment is
`{author, text, resolved}` stored in the save (extend `SavedGraph`, `persistence.ts:60-87`,
with a new optional field, following the same additive-optional-field pattern
`standoffs?`/`pins?`/`palette?`/`packs?` already use at lines 60-87). A small corner
indicator on the node itself (reuse `ErrorChip`-style chip styling) points back to the
pane. Don't build identity/permissions — a plain author name string is the whole 1.0.

---

## Exit criteria (whole bundle)

Expect node ships opt-in only; a Problems panel (new `HudStack` child) lists every
tagged error with a real jump-and-flash (built fresh, using `flyToNode` + a new CSS flash
class); where-used highlighting feeds `downstreamClosure`'s result into the existing
`isolateStore` dim mechanism; a Reconcile node uses `joinFrames` for added/removed/
changed + price/volume/mix; model fuzzing surfaces in the Problems panel with CLAMP-node
suggestions; a Tornado node (genuinely new, not extending `DecisionSensitivityNode`) runs
sensitivity analysis and renders its own chart; node comments are a new `HudStack` panel,
persisted as a new optional `SavedGraph` field.
