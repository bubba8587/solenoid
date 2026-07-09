# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems. Per-item entries are
swept to `archive/dev-notes-history.md` once digested — read a digest first;
drill into the archive (or `git log`) only for the mechanics of a specific item.

### SESSION DIGEST (2026-07-09, evening — pack enhancement wave: domain tools beyond formulas)
Author brief: "walk the new packs as their domain's user — beyond equations, what
tools/tables/charts does solving problems in this domain actually need?" Six
task-shaped additions, one per pack, each with pinned tests:
- **Element picker (chemistry — the author's own example, built as agreed):** the
  118-entry dropdown became a button (`26 · Fe — Iron`) opening a popup (module
  store + App mount, the TablePopup pattern): a fuzzy-search field (symbol exact >
  symbol prefix > name prefix > substring > atomic number — `searchElements`) over
  a CLICKABLE periodic table, symbols only, real 18-column layout with the
  detached f-block (`elementCell(n)`, collision-free by test). Quiet Accent Rule
  holds: cells are neutral; color marks only the current pick + best match.
- **Resistor Color Code (electricity):** 4/5-band SegToggle, per-band dropdowns,
  and a live resistor GLYPH drawing the actual band colors (information, not
  decoration — fixed IEC 60062 hexes like chart data colors) → Ω + tolerance %.
  Band picks live in `stringLiterals` (free round-trip).
- **EM Spectrum Band (electromagnetism):** frequency OR wavelength → the named
  band (Radio…Gamma; visible names its color) + both quantities via c.
- **Heart-Rate Zones (health):** age / optional resting HR (switches to Karvonen)
  / optional max override → a five-zone Low/High FRAME — the pack's chartable,
  lookupable table ("organize data", not just compute).
- **Pipe Roughness (fluids):** the 13-material textbook ε table (mm); a diameter
  makes it emit ε/D straight into Colebrook/Swamee–Jain — the number every Moody
  problem starts with.
- **Triangle Solver (geometry):** wire ANY three parts (≥1 side; degrees) → all
  six + area + perimeter. SSS/SAS/ASA/AAS; the genuinely ambiguous SSA case is
  an honest #SOLVE! instead of a silent pick. **Reworked same evening (author):
  the card now IS the current Equation design** — `EquationVarRow`/
  `EquationOutRow` exported from EquationNode.tsx (shared, not copied; the
  Check row deduped onto it) give each part ONE dual-socket hero row; a logical
  **Valid** output mirrors Equation's Check (3 parts → solve, TRUE/FALSE;
  >3 parts → solve from the side-richest subset and CHECK the rest agree at
  1e-6); <3 parts pass through quietly. And the card **draws the triangle to
  scale** (letters only — numbers live in the rows; neutral stroke).
- **Per-variable explanations on Expression + Equation (author ask):** each
  variable can carry a prose description (`varDescriptions` map on the node),
  kept OUT of the formula string so KaTeX never renders it. Shown as a hover
  tooltip on the card's variable rows (Expression via a new InlineInputs
  `titleFor`; Equation via `EquationVarRow desc`) AND as an editable legend
  under the big KaTeX in the FormulaPopup (a Variables section — name typeset,
  description field; editable even when the formula is locked, since it's a
  note not the formula). Persists via extractInit (LIVE-var-filtered, blanks
  dropped) + INIT_EXTRA_FIELD_ORDER; textForm round-trips it generically.
  `FormulaPackEntry.varDescriptions` lets presets ship them — seeded on Ohm's
  Law, ideal gas, Nernst, wavelength↔frequency. Report-embed "where:" legend
  deferred (Expression/Equation embed as VALUES, not formulas — needs a
  formula-embed mode first; backlog).
- **Trig deg/rad/Auto + Triangle broadcast (author follow-up):** a `Math` node's
  trig ops (sin/cos/tan/cot/csc/sec + asin/acos/atan/acot; NOT hyperbolic) gained a
  **deg/rad/Auto** SegToggle. Forward trig converts the input deg→rad; inverse trig
  converts the result rad→deg and tags the real `deg` unit on its output. **Auto
  (default) reads the incoming unit** — a °-tagged value (a Triangle angle, an
  FC-locked deg, an inverse-trig-deg output) computes in degrees, else radians =
  Excel parity. The unit read is `trigMode.ts` `resolveTrigModes`, run from
  processGraph before the engine pull, stamping a transient `_resolvedAngleMode`
  data() reads — the FIRST and only place compute consults the unit plane; a manual
  Rad/Deg pin ignores it; early-outs when no auto trig node exists. To make that
  read see producer units, `makeUnitResolver` gained the same `annotationFor`/
  `annotation` branches `makeAnnotationResolver` already had (unit plane now agrees
  with annotation plane; FC keeps its forward/author branch). **Triangle Solver
  sockets → numlist** (Equation-family parity, the flagged inconsistency): parts
  broadcast element-wise (parallel lists → a triangle per index, Valid a logical
  list, figure draws index 0); the angle annotation switched from custom "°" to the
  real `deg` unit so the resolver reads it as an angle. Runs main-editor only inside
  a drill-in (backlog, same as trueany/FC reconcile).
- **Per-output unit locks + per-socket FC boxes (author follow-up):** unitFlow
  gained the per-OUTPUT producer seam — `annotationFor(outKey)`, checked before
  the node-level `annotation()` — so the **Triangle Solver's angles carry °**
  (sides bare) and **Element's mass carries g/mol** (Z bare; the exact case the
  Pack-Duty digest recorded as blocked on per-output annotations). And the FC
  now reaches INDIVIDUAL hero boxes: the write side always was per-socket
  (`nodeId::socketKey`; findDockTarget snaps to the nearest socket), the READ
  side caught up — `ValueDisplay` takes a `socketKey` and hero rows
  (EquationVarRow/EquationOutRow) pass theirs, reading `get(node, socket)`
  instead of the any-socket `getForNode`, with the per-output producer lock as
  the resolver fallback so ° shows on the Triangle's own rows too.
- Pack-level descriptions + node-coverage inventory updated; new node classes in
  `nodes/{emSpectrum,health,triangle}.ts` + additions to electrical/fluids/
  chemistry; cards in `PackToolNodes.tsx`/`ElectricalNodes`/`ChemistryNodes` +
  `ElementPicker.tsx` (+ css). NOT built (still composite-shaped, planned in
  `pack-composite-plans.md`): Wheatstone, pump operating point, psychrometric
  state point; Materials pack stays gated on Interpolated Lookup (backlog).

### SESSION DIGEST (2026-07-09, overnight — Pack Duty: 8 domain packs + pack infra)
- **Pack definitions split into `src/graph/packs/`** (one file per pack on
  `packs/packShared.ts` — authoring types + `formulaNode`/`placeFormulas`; `packs.ts`
  stays the registry/activation store, public surface unchanged). `FormulaPackEntry`
  gained `resultAs`/`excel`/`keywords`; `NODE_PACK_TAGS` now derives from per-pack
  `tags`. `packs/formulaTestKit.ts` evaluates presets exactly as placed — every pack
  ships a vitest file asserting its formulas against hand-checked reference values
  (several of MY first-guess references were wrong and the tests caught me, not the
  formulas — the kit earns its keep).
- **Six new domain packs, all `defaultActive: false`:** Electricity & Circuits
  (26 [F] + Parallel Combine, E-Series, AWG; electrical FC units + an SI-prefix
  format), **Electromagnetism** (21 [F] + the CODATA Physics Constant node; the first
  real `dependsOn` — activating it pulls in Electricity), Health & Fitness (20 [F]),
  Fluid Mechanics (20 [F] + the Colebrook root-finding node), Thermodynamics & Air
  (21 [F] + ISA standard atmosphere (7 layers, derived base pressures) + Antoine
  vapor pressure (9 substances, each triple test-verified by reproducing its normal
  boiling point)), Earth & Sky (8 [F] + NOAA Sun Position / Sunrise-Sunset + Moon
  Phase), Chemistry Basics (13 [F] + Element (118 IUPAC weights) + Molar Mass (real
  formula parser: nesting, hydrates)). Existing packs got waves too: Geometry +15
  (circles & arcs, solids), Timesavers +7 [F] + Reverse Text + Spell Number.
- **Sets & Membership pack + core companions** (the backlog's parked Set/relational
  scoping, built as scoped): Is In (membership mask → logical list) + Tally (value
  counts → Frame) in the pack; COUNT DISTINCT as a new `ReduceOp` (pack-tagged);
  **semi/anti `JoinHow` on the core Join** — JS oracle + native Polars
  (`JoinType::Semi/Anti`, new `semi_anti_join` cargo feature), left-columns-only in
  `shapeOfJoin`, cargo parity test (69 rust tests green).
- **Formula-grammar gotcha for pack authors:** `e` is Euler's constant, not a
  usable variable name (an EM formula silently read e² as 7.389 until the value
  test caught it — use `ef`, `ev`, etc.).
- Composite-shaped pack ideas (Wheatstone, pump operating point, psychrometric
  state point, Pareto, % of Total…) deliberately NOT hand-rolled — planned in
  **`docs/pack-composite-plans.md`**; backlog Packs section reconciled (Set pack
  line deleted, Timesavers remainder + Materials-pack/Interpolated-Lookup lines).
### SESSION DIGEST (2026-07-09, day — Equation node, append ladder, Filter redesign, the wildcard split)
- **Morning follow-ups (author-directed):** the **EQUATION NODE** — type `V = I * R`,
  every variable is an input AND an output plus an always-present logical `Check`;
  one unknown → solved (symbolic AST isolation → unparse → recompile, so lists
  broadcast free; numeric log-grid + bisection fallback, new `#SOLVE!` code); all
  known → tolerance truth check. **Decision D14** records why it's a SIBLING of
  Expression with a FIXED socket set (no morphing output — the retype minefield),
  and why no CAS library. `parseFormula` is now exported from excelFormula;
  `OutputRowDef` accepts logical/list values. — **Add menu:** top-level **Packs**
  row (domain packs moved out of Numbers; Timesavers/HYPOTENUSE stay woven with
  their pack dots); **Control folded into Input** to free the row. — **Constants
  carry units:** `PhysicsConstantNode.annotation()` rides the unit (" m/s") through
  passthroughs exactly like an FC lock — the unitFlow duck-type seam took ONE
  method; Element deliberately skipped (two outputs, one unitless — needs
  per-output annotations first). — **Packs now use Equation presets**
  (`FormulaPackEntry.equation: true` → a locked EquationNode): every
  rearrangement-REDUNDANT group collapsed to one node — Ohm's law trio and
  dBm↔W pair (electricity), wavelength↔frequency (EM), the ideal-gas quartet
  (thermo), moles↔mass + pH↔[H⁺] (chemistry); 12 directional presets → 6
  bidirectional ones. Groups that are NOT rearrangements of one relation (the
  power trio P=VI/I²R/V²/R — different variable sets) stay directional
  Expressions on purpose. The Equation seed (order 15) demos the node with
  non-pack equations. **Quadratics (author, same morning):** a residual that is
  quadratic in the unknown — sniffed by numeric probing (7 points; the 3-point
  fit is exact for a true polynomial), so ANY arrangement counts — returns EVERY
  real root ascending (x² − 36 = 0 → [−6, 6]); double root scalar, negative
  discriminant #SOLVE!. Intercepts BEFORE symbolic isolation so the principal
  branch can't eat the negative root; non-polynomials (SQRT/1/x/trig in the
  unknown) fail a probe and keep the old behavior. D14 amended; seed gained the
  x² − 36 block. — **Lists→tables gap closed (author):** VSTACK was a 1-D list
  concatenator, so stacking two lists could never make a table. Now VSTACK is
  HSTACK's true sibling (element-agnostic anytable in/out; a list widens to ONE
  ROW, so two lists → a 2×n table; equal column counts or #SHAPE!); the old
  append behavior lives on honestly named as **Concat Lists**. NEW **Frame from
  Lists** (`FrameFromListsNode`) is the fast lists→Frame path: paired extensible
  rows (typed column name + anylist), TYPE-PRESERVING per column (no
  re-inference — "01" stays text), ragged pad, makeHeaders naming, identity-
  stable memo (audit-42 contract). PairedExtensibleInputs learned string-socket
  text fields for it. — **Complex × Equation:** deliberately NOT integrated (the
  evaluator's [re,im]-is-a-list ambiguity — D2's own wall — plus socket
  morphing); instead **Quadratic Roots** joined the Complex family (a,b,c → x₁,
  x₂ complex outputs; conjugate pair on negative discriminant; −0 normalized).
  Equation's #SOLVE! message stays the real-domain answer. — **Equation card
  rework (author, 4 corrections):** variables lost the typeable literal fields —
  each is now a HERO ROW (value box + chips) with its input socket on the left
  edge and output socket on the right of the SAME row (dual-socket rows via a
  local `useRowTop`, same content-relative math as MeasuredSocketRow); "Holds?"
  renamed **Check** (output key stays `holds`); the "=" prefix stripped
  (`FormulaField` `noPrefix`); editing routes through the syntax-highlighted
  FormulaPopup like Expression (`formulaHostOf` equation host, no "=" prefix,
  solve-semantics engine note). — **Finance conversion sweep (author: "sweep
  non-pack nodes for Equation conversion"):** the 4-op TvmNode + the RATE Newton
  node collapsed into ONE `TvmNode extends EquationNode` (locked annuity
  relation; wire any four of rate/nper/pmt/pv/fv; **payment timing stays a
  CONFIG dropdown** — it swaps which locked relation is compiled (end/beg), the
  template for future Equation subclasses via `EquationComponent`'s new `config`
  slot; rate = 0 delegates to the exact zero-rate limit relation so
  zero-interest loans solve/check exactly; RATE's guess input gone).
  PDURATION/RRI → **Compound Growth** and EFFECT/NOMINAL → **Effective Rate**,
  plain locked EquationNode catalog presets (pinned in finance.test.ts).
  `solveNumeric` policy change: bisect EVERY bracket, return the
  SMALLEST-MAGNITUDE root (the ascending-scan-first policy would have returned
  the spurious 1+r < 0 crossing for RATE). NODE_EXCEL remapped (PMT/PV/FV/NPER/
  RATE → `tvm`; PDURATION/RRI/EFFECT/NOMINAL → the presets); the
  personal-finance seed GENERATOR (`gen-personal-finance-seed.cjs`) rewired
  (tvm nodes drop `op`, outputs `result` → `fv`/`pmt`, mortgage fv as a literal
  0) — remember the committed JSON is a re-emit check, edit the generator.
  Surveyed, NOT converted: Depreciation (period-discrete), IPMT/PPMT/CUMIPMT/
  ISPMT (derived quantities), DOLLARDE/FR (piecewise), bonds/T-bills (date
  sockets), DIST/INV pairs (no closed-form CDFs). D14 amended again. —
  **The append ladder (author: "heavy thinking pass over the appending
  nodes"), recorded as D15:** ONE N-ary element-agnostic append node per
  container rank, all on the BooleanOp extensible-row pattern (`valueKeys`,
  add/remove undo): **Concat Lists** (anylist rows → anylist; scalar widens to
  1-element list, so "push one value" is free), **VSTACK/HSTACK** (anytable
  rows; ragged inputs now PAD WITH #N/A cells like Excel — the old
  whole-result #SHAPE! made "stack a 3-list on a 5-list" unusable; VSTACK pads
  right, HSTACK pads down), **frame Append** (frame rows, union by column
  name — runFrameAppend was always N-ary, the node now exposes it).
  WRAPROWS/WRAPCOLS joined the #N/A padding rule (they disagreed: ragged short
  row vs NaN fill). `ExtensibleInputs` gained a WIRE-ONLY row branch
  (container-typed rows show position / "↩ source", never a literal field).
  Deliberately not unified: Interleave (2 distinct roles), Pad/Repeat
  (fill/self-append utilities), Add Column (single named column; bulk = Frame
  from Lists, keyed = Join), Build Frame vs Frame from Lists (different
  constructors), add-a-row = Get Row → Append (a positional list into a
  by-name append is a refused footgun). Socket keys changed (top/bottom→f*,
  a/b→t*/l*) — table-verbs seed rewired; old saves load those cables dropped
  (pre-alpha). Full reasoning in D15. — **Follow-up wave (same day, author
  approved the queue):** (1) **Filter gained a PERMANENT `Dropped` output** —
  the exhaustive complement by position (null-predicate cells land in Dropped,
  nothing vanishes); author asked "dropdown mode on Filter?" — answer NO, a
  dropdown that toggles a socket kills downstream cables on switch (the
  fixed-socket rule), and the complement is free in the same pass, so it's
  always there. Frame Filter's Dropped landed the same day: `filterMulti`
  gained a `complement` flag through the verb seam (JS oracle keep-set flip;
  Rust BOTH paths — the text-scan hand-roll and the lazy expr fold, where
  `fill_null(false).not()` keeps null-predicate rows in the complement), the
  node publishes a SECOND lazy ref with emitFrame's stale-pass/prev-ref
  lifecycle minus the preview (`_refDropped`, freed on noderemoved too), and
  the card shows just the Dropped socket row — materializing a chip for it
  would collect a frame nobody asked for. Cargo 69→71. (2) **TAKE/DROP (table)** — Excel's real 2-D edge cuts
  (rows+cols, negative = from end, 0 = omitted arg) as one op node; the 1-D
  list Take/Drop stay and their NODE_EXCEL parity claims were corrected.
  (3) **EXPAND** — the 2-D pad (grow to R×C, wired Fill or #N/A, shrink =
  #VALUE! like Excel); retired the old "list-pad ≈ EXPAND" mapping.
  (4) **anylist coherence sweep**: Reverse/Slice/Take/Drop/Shuffle/NthElement/
  Interleave/Pad are position-only, so they're now element-agnostic
  (text/date/logical lists reverse and slice like numbers). Sort/Cumulative
  stay typed (comparison/arithmetic semantics). (5) **`Cell` type hygiene**:
  the matrix cell alias widened to the honest runtime union (± boolean/null/
  SolError) — zero tsc fallout, the #N/A-padding casts deleted. — **Table Input
  rebuilt as a LITERAL source (author: Frame Input's model is the desired
  behavior)**: raw `tableText` is the stored truth, the typed matrix derives
  through coerceFrameCell — the SAME coercion as Frame Input, so bad cells are
  NaN (the carefully-designed quiet dirty-data affordance, 1.0-tail #6 — NOT an
  error badge; author explicitly guarded this) and blanks are null; the grid
  popup edits RAW cells via a new lean `onSaveRaw` literal mode (the old
  parse→tableToText round trip silently coerced bad text away — deleted, with
  parseTableText/tableToText). ONE element type per table via a
  Num/Text/Date/Bool SegToggle (the List Input retype pattern; mixed columns =
  Frame Input's job). — **Type-by-COLOR (author chose color over glyph
  shorthand):** chips now tint by ELEMENT family when the container is
  homogeneous — explicit socket knowledge (`elem` prop; date serials are
  numbers by value) or a cell scan; mixed/unknown keeps the container color (a
  chip must not guess). CSS: `--elem-{string,date,logical}` (+`-table`)
  modifiers on the --sock-* vars; numeric keeps the current look. And
  **List/Table Input header accents track the SegToggle** (NodeShell grew the
  accentOverride passthrough NodeCard already had; SOCKET_COLORS values, the
  FC-header precedent). — **The Filter-family redesign (D16, author-led over
  several rounds; ship only after explicit agreement):** the old list/table
  Filter was FOUR tools in one card (own-value predicate, parallel-list mask,
  table rows/cols, Excel FILTER). Now: **Filter = 1-D only**, the frame
  Filter's shared condition engine (`passesFilter` exported; extensible AND/OR
  op+value rows, per-row Match case, anylist, Kept+Dropped); the **mask and
  the table socket are DELETED** (the socket advertised `table` while the
  predicate refused genuine 2-D — the incoherence that triggered this).
  **Tables filter through the frame Filter** — a matrix widens into its frame
  input as Col1..N (already true in the lattice; pinned by test). **The
  parallel-list pattern got a task-shaped node: SUMIFS**
  (SUMIFS/COUNTIFS/AVERAGEIFS/MINIFS/MAXIFS; Values + paired criteria rows,
  AND-only, Excel's empty-match parity — AVERAGEIFS #DIV/0!, MIN/MAXIFS 0).
  Non-aggregating parallel-list filtering = Frame from Lists → Filter Rows
  (mixed-family parallels can't share a matrix anyway). Seeds rewired
  (lambda-helpers lost its mask demo — MAP reads temps directly;
  null-and-logical + the personal-finance generator moved to condition rows).
  Full reasoning incl. the per-cell/flatten/hole-punch rejections in D16.
- **The wildcard ladder (D17, author challenge):** `any` had been BOTH the rank-0
  untyped rung and the accept-everything supremum; the author called it ("that's
  why we have any, any list, and any matrix"). Split: **`any` = element-agnostic
  SCALAR** (accepts family scalars/combos; output widens anywhere data flows),
  **`trueany` = the supremum** (accepts/flows-to everything) with a new HOLLOW
  gray circle glyph (DOM + pixi "ring" + legend). ~30 call sites re-sorted:
  passthroughs/selectors/Cast/Report/composite ports/unwired lanes → trueany;
  Expression/LAMBDA variables + Regex text + Group Lists keys + wrap/flatten →
  anylist (the Expression cap now enforced at CONNECT time); SWITCH expr/when +
  Expand fill stay `any`, now honest. `isWildcardType()` centralizes the
  resolve-past-untyped checks (FC adoption, type-default display, conduit trace).
  MAP/MAKEARRAY Auto output → `anytable`. Full sweep rewritten in
  socketConnect.test.ts; details in D17.
- **Filter Value rows → `any` scalar** (both Filters): strIn had been a functional
  regression (a Slider couldn't drive a threshold — number→string refused).
  Wired scalars stringify via `readFilterValue` (wired null = "not written yet";
  wired SolError = its code text, matches no rows) so both engines see exactly
  what a typed literal would say.
- **trueany is ADOPTIVE (D17 amended, author):** every trueany placeholder port
  adopts the wired cable's type and reverts on disconnect — `AdoptiveSocket`
  (per-port instances, never the shared singleton) + `trueAnyAdopt.ts`
  (`reconcileTrueAnyTypes` fixpoint; `settleWildcardTypes` alternates it with the
  Conduit reconcile — reconcileFcTypes and the load path both route through it).
  Inputs adopt universally; outputs only where honest (Display/Expect/Input
  Switch pass through; IF/IFERROR/CHOOSE/SWITCH/IFS results adopt when all wired
  branches agree; INDEX/XLOOKUP results stay static). Never drops cables
  (mismatch scan flags), never persists. So the hollow ring on canvas always
  means "nothing has flowed here yet".
- **Rename (author picks):** Frame Filter / List Filter / Frame Sort / List Sort
  replace Filter Rows / FILTER / Sort / SORT — the pair relationship reads
  directly off the Add menu. Also pinned MAP/MAKEARRAY result sockets by test
  (Number default = numeric matrix; Auto = anytable — the numeric socket on a
  fresh card is the declared default, not a D17 regression).
- **SUMIFS rebuilt onto ONE FRAME (D16 amended)** — the author caught it violating
  the 2026-07-06 aligned-columns standing rule (parallel criteria lists, with the
  silent short-list misalignment hazard the rule exists to kill). Now: frame in,
  Values-column field (hidden for COUNTIFS), criteria rows column+op+value — the
  frame Filter's row UI plus an aggregate op selector; missing column → #REF!;
  catalog entry moved to the frame verbs, node kind frame.

### SESSION DIGEST (2026-07-08, evening — What's New resell + 1.2/2.0 plans)
- **What's New rebuilt around the author's sell bar** ("a shiny thing a user will go
  discover and play with / would inspire a download on social media; What's New is not
  a changelog"). 6 slides → 11: What-if analysis (recast — composites exist to run
  isolated what-ifs; editor/main-canvas parity is machinery, NOT the sell), Command
  palette, Live market data, Mobile redesign (the three-zone chrome), Reports,
  Presenter mode, Mermaid diagrams, Set operations, More chart types, Align &
  distribute bar, Palette editor. Dropped as sells per the author: charts-follow-the-
  palette as its own line, type-colored chips, Document Properties, composite-editor
  parity. The bar itself is now written into `release-notes-features.md`'s header and
  the slide list there mirrors the deck. About gained the type-enforcement + unit-lock
  sentence. (Judgment call left to the author: the model fuzzer/trust set reads as
  slide-worthy by the same bar; it stayed in the release-notes body, not the deck.)
- **American spelling in shipped strings** (author): three nodeCatalog descriptions
  carried "colour"/"coloured"; respelled. Code comments keep whatever they have.
- **Post-1.1 work organized into two release views:** `docs/1.2-plan.md` (tiered:
  known-issue fixes with tidy/cleanup-around-groups as the backbone, half-built tails
  F-2/D-2/goal-seek-params/drill-in-subsystems, widening incl. the CSP-gated iFrame
  node, unscheduled candidates, parked items) and `docs/2.0-plan.md` (the author-
  present flagships A4 → transpiler → D2 → D4, the Monte Carlo gate, verdict-pending
  #23/#35; bundle detail stays in `v2.0/`). backlog.md remains the per-item source of
  truth; docs/README index + release-plan pointers updated.

### SESSION DIGEST (2026-07-08, latest — Writing & Copy pass over every shipped string)
- **Full copy pass (author order): every user-facing string held to DESIGN.md §7 + the
  Captain-Obvious rule; internal docs exempt.** ~700 strings rewritten across seven
  surfaces by parallel agents on disjoint files, then audited centrally: nodeCatalog
  (223 of 303 descriptions — these render in the Add menu + Function Reference),
  nodes/*.ts op metas (~315, mostly the trailing "(Excel: =FOO)" idiom → the plain
  sentence "Excel: FOO."), top-level chrome (~40: menus, StatusBar, Settings, notices,
  error prose), components A–L (~48) and M–Z (27), seed titles/notes/comments (~50 +
  the PF generator's ten notes, re-emitted in lockstep), README's two em dashes.
- **New style rule codified (author 2026-07-08): no trailing parenthetical.** A string
  may not end with "(…)"; fold the aside in, promote it to a sentence, or delete it.
  Added to DESIGN.md §7 with the "Excel: XLOOKUP." convention as the worked example.
- **Deliberately unchanged, for the next pass to know:** shortcut-hint parens
  ("Save (Ctrl+S)") are functional key names, not prose; the paired
  "Align center (vertical/horizontal)" command names disambiguate two identical labels
  and are synced between SelectionActionsBar and CommandPalette; the bare "—"
  empty-value glyph is typography; math notation (Σ(score × weight), (m×n)) is not an
  aside; genuinely informative mechanism contrasts ("stores the URL, not the data")
  survive the no-antithesis rule; code comments/console.warn are dev-facing.
- Twin-string traps found by the audit: process.ts carried its own copy of the #CIRC!
  message (now matches errorValue's); "Grand (at start)" existed in both
  PivotEditorPopup and FrameNodes (fixed consistently on both surfaces).

### SESSION DIGEST (2026-07-08, later — seed consolidation 27→17 + release odds & ends)
- **Seed set consolidated 27 → 17 (author-directed "rebuild from scratch" pass).**
  Retired outright: mortgage (PF §6 is a mortgage stress test), investment, break-even,
  stats, bom-costing (the same 5-step chain built twice), frames. Merged: as-of/lookup
  corner → **Table Verbs** (order 65); visual-outputs' unique widgets (Sparkline/Gauge/
  Heatmap/ChartBuilder styling) → chart-showcase, retitled **"Charts & Visuals"** (its two
  bare Chart lanes dropped as gallery duplicates); magnetic-flux → **Famous Math** as "The
  namesake" cluster + intro note; error-codes tour → null-and-logical as a side-by-side
  column, retitled **"Errors, Null & Logic"** (cluster ids preserved — `errorSeed.test.ts`
  just repointed its import and still drives all 11 codes through the real engine).
  **Getting Started rebuilt:** the collapsed amber trig/averages group (11 hidden nodes)
  DELETED per the author; in its place a Tables & charts cluster (Quarterly-sales frame →
  column Chart; Get Column → SUM → $-Display) + one comment pointing at Ctrl+K / the
  example menu. `run-graph.test.ts` re-anchored its headless assertions on that cluster
  (frames.json was its fixture). **Cube Rollup kept a demo**: a rollup row added to the
  cubes seed (SUM of each Rep's nested orders.Revenue) since bom-costing was its only
  appearance. **Composite Workbench** gained a second goal-seek card ("Retirement deposit
  finder": Solve the monthly deposit → $500k in 30 yrs at 7%, annuity-FV Expression
  inside; probed FV(300)=**$365,991** via tsx). bomCostingSeed.test + framesSeed.test
  retired with their seeds.
- **Mobile command palette fixes** (author-reported): the persistent (always-on) bar sat
  at z-index 300 ABOVE the Settings/help/shortcuts modal band (200) — persistent scrim
  now 150 (ambient chrome yields to dialogs; the explicitly-invoked modal palette keeps
  300); mobile top anchor 64px → **92px** (the 82px top-chrome edge + 10, level with the
  nav pill). layout-chrome.md ladder + mobile-offsets table synced.
- **Known-issues section** added to `release-notes-features.md` (GitHub release body ONLY,
  not in-app — author call): tidy/cleanup-around-groups wonkiness, drill-in main-only
  subsystems, label-edit undo gap, zoom seam, web CORS limits on Data Feed, Problems-panel
  per-cell blindness, Tornado ranking caveats, fuzz Clamp, Set-node complex identity
  compare, private-browsing reload loop, Android status-bar tint.
- **`working` branch formally retired**: its CLAUDE.md now opens with a redirect banner
  to `develop` (stale copies of main's CLAUDE.md still name `working`; main self-corrects
  at the 1.1 merge). Commit identity verified: all session commits are
  `Claude <noreply@anthropic.com>` author+committer; the earlier hook warning referenced
  pre-rewrite hashes that no longer exist.
- **agent-coordination.md swept to dormant** — it still carried the entire 2026-07-05
  autonomous-run claims board (all landed long ago).

### SESSION DIGEST (2026-07-08 — 1.1 release build: finance seed, seed overhaul, bump)
- **Live Market Data seed** (`seedGraphs/live-market-data.json`, order 45): the committed
  §3a demo — FRED UNRATE (since 2015) → line chart + Get Column → Aggregate average
  ("it's the data, not a picture"), FRED MORTGAGE30US monthly → chart, and an Alpha
  Vantage AAPL cluster that intentionally demos the add-a-key state when no key is stored.
  GOTCHA: a hand-authored seed MUST say `"v": 2` (`CURRENT_SAVE_VERSION`) — `seeds.test.ts`
  doesn't validate the field and a higher value is refused at load, silently from the
  test suite's point of view.
- **Seed overhaul (release-plan §3b) — DONE.** Four parallel review agents over all 27
  pre-1.1 seeds (story/currency/copy; structure already machine-checked). Retired
  `value-semantics-tail.json` (internal 1.0-QA framing, superseded by null-and-logical)
  and `layout-test-mixed-heights.json` (dev fixture in the user menu — seeds.ts globs
  everything, there's no exclude mechanism). Content bugs fixed: null-and-logical
  cluster F claimed `[1,null,3,4] > 2` → `FALSE, null, FALSE, TRUE` (correct:
  `FALSE, null, TRUE, TRUE`); pivot-tables title said 9 columns (10 since SKU);
  asof-join-lookup's note called XLOOKUP "Frame Lookup" (never a user-facing name).
  Menu orders added (composite-workbench 12, asof-join-lookup 55 — headliners were
  sinking to the alphabetical tail at default 1000). getting-started: named the three
  bare "Group" groups, pruned the Concat node's dead `a/b/c/d` literals (old 4-slot
  shape). Retitles: Visual Outputs → "Gauges, Sparklines & Chart Styling",
  Dimensional Flow → "Types & Shapes" (menu-collided with Unit Flow). Author-call
  residue → backlog ("Seed follow-ups from the 2026-07-08 overhaul").
- **What's New / feature-list copy corrected:** FRED is keyless (say so — it's the
  selling point), FX quotes don't exist, and composite Simulation is iterative
  loop-stepping, not Monte Carlo (2.0-reserved). `HelpDialogs.tsx` slides synced with
  `release-notes-features.md`.
- **Version bumped to 1.1.0** in lockstep: `package.json`, `tauri.conf.json`,
  `Cargo.toml` + `Cargo.lock` (hand-edited — the cloud container can't build Tauri:
  no GTK dev libs, so `cargo test` must run on the author's Windows machine before
  the tag). README's desktop line de-versioned ("Windows, v1.0" → "Windows").
- **Remaining to tag** (all author-run): eyeball pass on the Vercel preview, `cargo test`
  on Windows, release desktop build, merge `develop` → `main`, tag `v1.1.0`.

### SESSION DIGEST (2026-07-07 — commit-walk audit, ~130 commits newest-first)
Eight fixes across four commits (`e9184b0`, `9bab17b`, `30b6cfa`+`7bdba07`, `ef641de`):
- **anylist gaps:** `coerceInputs` had no `anylist` case (a scalar reached Set's `for...of` raw —
  number threw, string iterated PER CHARACTER); List Input's type switch pruned only OUTPUT cables
  (a wired row kept a type-illegal cable after Num→Text); Expect "In list" used the number-only
  `listIn` so a TEXT allowlist couldn't be wired (now `anyListIn`).
- **Heavy-composite stale dot lied:** arm-and-run keyed staleness on inputs/config/seeds only — an
  INTERNAL edit (drill-in value change / rewire) held the old solution under a green dot. Added
  `internalEditSeq` to `solveKey`, bumped by an internal-editor topology pipe + process.ts's
  retargeted pass (`markInternalEditChain` marks every nesting level). Tests for both funnels.
- **Drill-in resolver sweep misses (9316c2d follow-up):** CableSwitch (mode retype/prune against
  MAIN), inlineInput's `useConnectedInputs`/`useIncomingSources` (wired rows read unwired inside a
  drill-in), NoteNode `commitFields` (frontmatter cable prune + reconcileFcTypes on the wrong graph),
  ResizeHandle (grip didn't render at all for internal nodes). All routed through
  `getOwningEditor`/`getActive*`. Remaining `getEditor/getArea` component imports verified main-only.
- **Collapsed groups never gain members (author report: wrong membership near collapsed groups):**
  a collapsed group renders as a small card with members hidden, but all three membership editors
  treated the card as a drop target — a node dragged/created over it silently joined and was hidden
  by the next syncGroupCollapse (visibly vanished). reconcileGroupMembership skips collapsed join
  targets; absorbIntoContainingGroup skips collapsed groups; reconcileGroupBox no-ops while collapsed
  (its card-box would DUMP every member). Membership edits require the group expanded. The suspected
  duplicate-"Group"-label cause was ruled out: runtime membership is id-based, saves use the minted
  unique names (per-prefix counter), labels are never identity.
- **Docked FC never let go (author report):** two holes — (1) cutting the FC↔host glue cable did
  NOTHING (no code path reacted; the FC kept trailing the host + annotating its socket): the
  connectionremoved pipe now dissolves the dock (full undock), skipped while graph-rebuilding;
  (2) drag-to-empty cleared only the dockedNodeStore entry — the stale hostNodeId persisted into
  the save and load-time dockSelf() RESURRECTED the dock: new FC.releaseDock() (forget dock
  identity, keep annotation) runs on the drop-to-empty path.
- Open observations (not fixed, judgment calls): Set-node membership compares complex `[re,im]`
  cells by REFERENCE (equal complexes from different sources never intersect); the stale-chunk
  reload guard can loop on a genuine outage in private browsing (sessionStorage throws → the 10s
  guard never persists — an in-memory fallback would close it).

### SESSION DIGEST (2026-07-07 — Data Feed widening + Trust-node audit)
- **Data Feed widening:** FRED gains start/end date fields (cosd/coed) + a frequency dropdown
  (fq + fam=avg); Alpha Vantage gains a frequency dropdown that swaps the TIME_SERIES_* function +
  its own symbol quick-picks. Quick-picks generalized to `preset.quickPicks`; refinements live in
  `stringLiterals` (round-trip), fold into the URL (→ cache key → re-fetch), reset on provider switch.
  `buildUrl` gained an optional `opts` arg (existing 2-arg calls unchanged).
- **Trust-node audit** (background subagent, 9 findings; comments / Reconcile-PVM / Expect-persistence
  found clean). FIXED: **Tornado** produced all-zero swings in manual/sketch calc mode (drove the sweep
  with plain `processGraph` — no rebuild-gate, so the manual short-circuit no-op'd every perturbation)
  AND fired real Expect/Alert HUD alerts from synthetic values AND left a leaf pinned on a mid-sweep
  throw — now wrapped in `beginGraphRebuild` + `beginForceExact` with a per-leaf `try/finally` restore,
  mirroring modelFuzz. **model-fuzz** was leaving synthetic `#DIV/0!` etc. in the Problems "compute" log
  (`reportLive` now gated on `isGraphRebuilding`, load-safe — the post-load settle is outside the gate).
  **Expect** not-null now flags a per-cell SolError. **fuzz** no longer reports a downstream Expect's
  rejection of a synthetic extreme (circular noise). Remaining follow-ups → backlog (per-cell errors in
  Problems, Reconcile non-shared cols, fuzz Clamp bounds, Tornado ranking normalization).
- **Trust demo seed** (`seedGraphs/trust-data-quality.json`): three clusters exercising the set —
  Expect (not-null + range 0–50 over a sensor frame with a blank + an 88 → red badge + 2 Problems),
  Reconcile (Jan→Feb price/qty frames, PVM key=SKU → changed/added/removed + PVM), Tornado (3 sliders →
  a Profit expression → sensitivity; run-on-demand), plus two node-anchored comments. Loads clean +
  textForm round-trips (auto-registered via the seedGraphs glob).

### SESSION DIGEST (2026-07-07 — What's New + About, renderer-spike cleanup)
- **What's New overlay + About Solenoid** (`helpDialogStore.ts`, `HelpDialogs.tsx` + CSS):
  one modal slot for both Help dialogs. What's New is a 6-slide carousel (the `[slide]`
  headliners from `release-notes-features.md`) with dots/Back/Next, auto-shown ONCE per
  `WHATS_NEW_VERSION` (localStorage `solenoid.whatsNewSeen`; first-ever visitors recorded
  silently so the modal never lands over a new user's first load; deferred 1.4s past the load
  reveal). About shows the wordmark, `pkg.version`, the tagline, and a "What's new" button.
  Help menu gains "What's new…" and enables "About Solenoid" (was disabled). Mirrors the
  shortcuts-overlay chrome; shared `CloseIcon`.
- **Renderer-spike cleanup:** deleted the HTML-in-Canvas SPIKE (`HtmlCanvasSpike.tsx` +
  `htmlCanvasSpikeStore.ts` + its App mount + Edit-menu item) — the shipped HTML-in-Canvas
  renderer (`HtmlCanvasLayer`/`htmlCanvasRenderer`, renderMode "html") is untouched. Removed the
  Pixi spike's Edit-menu item too (hidden; the `RendererSpike`/`pixi/*` code + `window.__spike`
  dev hook stay). Backlog + WebGPU parked note updated.

### SESSION DIGEST (2026-07-07 — stale-chunk reload guard)
- **"Failed to fetch dynamically imported module" (autoarrange/ELK):** not an autoarrange bug —
  the classic stale-chunk-after-redeploy race (a new deploy rotates the hashed chunk names; an
  already-open tab 404s the old hash the moment a lazy import fires — ELK Tidy, Mermaid, charts,
  KaTeX are all code-split). Added a `vite:preloadError` handler in `main.tsx` that reloads ONCE
  to pull fresh chunk refs, sessionStorage-guarded so a real network outage can't loop. Autoarrange
  stays lazy on purpose (ELK is ~1.5 MB / ~471 KB gzip, kept out of the main chunk — `4635e54`).

### SESSION DIGEST (2026-07-07 — mobile status bar + HUD overlap)
- **Command palette Android autofill bar killed:** the palette search input showed Chrome's
  password/card/location autofill bar despite already carrying `autocomplete="off"` + `name` +
  the off-flags (Chrome ignores `autocomplete="off"`, and a `name`d `type="text"` reads as a
  fillable form field). Switched it to a semantic `type="search"` (no `name`) — Chrome drops the
  credential/payment/address prompts for a real search field; native clear-button hidden in CSS.
- **Accent status bar (Android) — SOLVED 2026-07-07, and the earlier "Chrome auto-update"
  conclusion was WRONG.** The variable was the PHONE's dark mode all along: Chrome for Android
  ignores `theme-color` on its normal-tab toolbar whenever the BROWSER UI is in dark theme
  (system dark / Chrome theme setting / battery saver) — long-standing documented behavior, not
  a 2026 regression. In light mode the accent tints fine (author-confirmed on device); fullscreen
  has no toolbar, so the status bar tints in BOTH modes there. The 07-07 session's three fixes
  (drop the color-scheme meta, color-scheme root→body, media theme-color variants) and the
  "byte-identical config → Chrome auto-updated, platform limit" proof were chasing a phone
  setting; the diff couldn't see it because the phone's theme isn't in git. (Chrome also doesn't
  honor `media` variants on theme-color — that's Safari — so that experiment couldn't
  discriminate.) Baseline (single media-less meta + root color-scheme) is correct and stays.
  Nothing to fix; do NOT reopen a fix hunt for the dark-toolbar case — a PWA manifest is the one
  real lever and the author declined it.
- **HUD (pins/problems/alerts) overlapped the Fit/Lock pill on mobile:** the stack was pinned at a
  fixed `top:124px` (desktop, no safe-area) while the mobile pill sits at `92px + notch` — worse in
  fullscreen where the safe-area shifts but a fixed top can't track it. Added a mobile override
  `top: calc(136px + env(safe-area-inset-top))` (+ width cap), tracking the SAME safe-area as the pill
  so the gap holds in both modes.

### SESSION DIGEST (2026-07-07 — composite drill-in: collapsible controls + mobile pass)
Vercel preview of `develop` (mobile session). tsc + full vitest (2281→2282) green.
- **Drill-in undo history routing (backlog gap c, DONE):** node components push undoable
  edits via the global `pushHistory` (extensible rows, cable-switch, group resize), which
  Canvas had hard-wired to the MAIN history plugin — so an edit made INSIDE a drill-in was
  recorded on the main stack and the drill-in's own undo (Ctrl+Z / the mobile bar, which
  routes there) couldn't reverse it. Rerouted the registration to `getActiveHistory()?.add`
  (the drill-in's `mount.history` while a subgraph is active, main otherwise). The undo/redo
  closures already refreshed via `getActiveArea()`, so this one line completes it.
  `historyRouting.test.ts` locks the contract.
- **Run-controls panel is collapsible** (`CompositeEditorOverlay`): a head bar showing the
  current run mode + a chevron folds the body (`CompositeRunControls`) away; starts COLLAPSED
  on mobile (`IS_MOBILE`) where a 240px open panel blanketed the small canvas. New
  `__controls-head` / `__controls-body` structure; scroll/max-height moved to the body.
- **Drill-in mobile pass:** the mobile CSS block was DEAD — it targeted `__panel` / `__header`,
  classes from an older full-panel design that the current strip/controls structure dropped, so
  the drill-in had effectively no mobile styling. Replaced with real rules, then corrected against
  the real mobile chrome heights (author testing): breadcrumb strip now clears BOTH top rows
  (accent ~30 + toolbar 52 = ~82px + notch; was hiding under them at 56px); run-controls panel
  sits ABOVE the ~86px bottom pill (it was pinned to bottom:10px → behind the pill → "not present");
  drill-in minimap hidden on mobile (no room, overlapped chrome). `+ Input/Output` finger-sized.
  Strip width capped to `calc(100vw - 130px)` so it clears the right-anchored Fit/Lock pill
  (`.solenoid-nav`, ~110px) it shared a row-band with (author: breadcrumb overlapped the pill).
- **Backlog reconcile:** "Simulation output series renders on the outer card only" was already
  resolved by `334bdf4` (2026-07-03, "sim marker value") — `runSimulation` sets
  `marker.cachedResult = series` and both the outer card and the drill-in marker render it via
  the SAME `CompositeBoundaryValue`. Deleted the stale line.

### SESSION DIGEST (2026-07-07 — Gauge percentage + FC text advanced tier)
Vercel preview of `develop` (mobile session; `develop` is the deploy branch now). tsc +
full vitest (2280) green.
- **FC advanced tier for TEXT values** (backlog "FC advanced options for TEXT"): a
  string-typed Format Controller now has an expander (reusing the number tier's
  `advancedOpen` / `toggleAdvanced` + chevron) with three display-only controls —
  **alignment** L/C/R (SegToggle; the display box is right-aligned by default, so
  this is an override), **Markdown** (renders the value as sanitized BLOCK markdown
  via `marked.parse` + DOMPurify — `# h` → real `<h1>`; styled by a compact
  value-box `.solenoid-node__md` class, untrusted strings from shared files), and
  **Monospace** (text renders sans by default; opt into `--font-mono`). Two follow-up
  fixes after author testing: the mono checkbox spread a `fontFamily: undefined` that
  clobbered the base sans → forced mono on ALL FC-text (now only emits the key when
  ON); Markdown was `parseInline` (no headers) → block `parse`. New
  `FormatAnnotation` fields `textAlign` / `textMarkdown` / `textMono` (+ `TextAlign`
  type), FC node props + `annotation()`, `controlsFor().advanced` now true for text,
  applied in `nodeKit.tsx` ValueDisplay (the same surface as the existing case/B/I/size
  attrs), persisted via `copyPaste.ts` INIT_FIELD_ORDER. Format-model doc truth table +
  `formatModel.test.ts` updated.
- **Doc-rot fix (author called it out):** the Data Feed node shipped 2026-07-06 (`5675c48`
  + `bf4f531`) but the backlog still marked it "unreachable / never registered." Reconciled
  the line to the genuine remainder (symbol picker, date-range/frequency, more providers,
  demo seed). Verified the rest of the 1.1 section against code — iFrame node + What's New
  overlay are genuinely unbuilt (correctly open).
- **Gauge is now a single-value percentage dial.** Dropped the Min/Max inputs — the node
  takes ONE `value` read as a fraction of 100% (1 → 100%, 1.5 → 150%). The arc always spans
  0→100% and fills the clamped fraction (150% overfills to a full arc); the centre label shows
  the true percentage (`formatPct`), and the end labels are a fixed `0%` / `100%`. Node class,
  component, catalog description, and `visual.test.ts` all updated.
- **Gauge track contrast:** new `--gauge-track` token (both themes) for the unfilled arc —
  `--border-subtle` was near-invisible against the node body; `chartCore` `track` reads it.
- **Gauge minifies** (copies the Sparkline pattern exactly): `squareCollapse` on the NodeShell
  + a `collapsed-only` mini `GaugeArc` (46×24, cropped). Single input via `InlineInputs`, so the
  socket survives the fold (`data-socket-side`) and re-wiring works while collapsed. This closes
  the "Collapsed Gauge mini-preview" backlog item — the last of the per-node minified set.
- **Seed fixups for the new percentage model:** `visual-outputs` slider → 0–1 range (shows 72%);
  `layout-test-mixed-heights` gauges → 0.64 / 0.8; **personal-finance** rewired — the two
  toward-goal gauges (`gauge-nw`, `gauge-proj`) that used a dollar Max now feed through new
  `ratio-nw`/`ratio-proj` ExpressionNodes (`nw / goal`, `fv / target`) so the gauge reads a real
  progress fraction; `gauge-rate` already carried a 0–1 savings rate. The seed is generated —
  edited `scripts/gen-personal-finance-seed.cjs` and regenerated the JSON (pfSeedCheck lockstep).

### SESSION DIGEST (2026-07-06 late — composite drill-in polish + editable input markers)
Local dev server. tsc + full vitest (2279) green. A long interactive pass over the
Composite drill-in with the author. Highlights:
- **Add composites like any node:** the catalog entry was `hidden: true` (Ctrl+Shift+G-only);
  un-hidden — drop an empty Composite and Edit contents (the drill-in is first-class now).
- **Run-mode/Solve/config controls INSIDE the drill-in:** extracted `CompositeRunControls`
  (run-mode selector + Solve/status + the active mode's config editor), rendered on the outer
  card AND a floating panel top-LEFT under the breadcrumb in the overlay (top-right is the
  Zoom pill / HUDs). `emit` is outer-only (the goal-seek Solution socket anchors to the outer
  node); inside it's a plain display.
- **Editable input markers (`CompositeInputNode.defaultValue`, persisted via INIT_FIELD_ORDER):**
  the marker gets the Number-Input field (`value-input`, commit on blur). It's the input's value
  when the port is unwired + the goal-seek seed. runPass fallback: override → wired → marker seed →
  port default. **Inside-vs-outside solve:** `requestSolve(insideOnly)` — an inside Solve
  (`CompositeRunControls insideOnly`) runs on the seeds, IGNORING outside wiring; an outside Solve
  uses the wired values. **Writeback:** a goal-seek writes the solved driver back onto its marker,
  cleaned via `formatScalar` (integer/4-dp — no raw float tail). `solveKey` includes the seeds;
  `lastSolveKey` is recomputed AFTER the solve (the writeback would otherwise read stale next pass).
  KNOWN: the stale dot is uniform (external inputs + seeds), so post-inside-solve it reads green
  though the result is seed-based — re-solve outside to use wiring (needs a drill-state signal in
  compute to distinguish; left simple — see backlog).
- **Immediate label propagation:** `syncPortLabels()` runs at the top of `data()` (cheap, every
  pass) so a marker rename updates the port-label-driven controls (goal-seek Set/By) on blur; the
  overlay subscribes to `compositePassStore` to reflect it. Outer card still updates on drill-up.
  syncPortLabels now falls back to the marker PLACEHOLDER (Input/Output) on a cleared label.
- **Pointer/zoom parity:** the drill-in used rete's stock zoom (fixed-step + double-click zoom);
  extracted `CappedZoom` + `installSurfacePointer` (dblclick swallow) into `areaPresets.ts`, called
  from getDrillMount; Canvas uses the same shared `CappedZoom`. (Full mobile touch select/lasso is
  the separate lasso item.)
- **Green boundary markers:** new `boundary` node kind → green ("special"); Composite stays gray.
- **Goal-seek visual:** Solution is the SOLE hero (output boxes suppressed) and wireable (target
  port socket on it, emitting the solution); status circle is an SVG (round) with 3 states — amber
  ring (stale) / red (`#CONV!` no solution) / green (solved); `#CONV!` renders via ValueDisplay
  (same red badge as every error). Driver input socket kept (feeds the seed).

### SESSION DIGEST (2026-07-06 late — goal-seek hero/socket + arm-and-run for heavy composites)
Local dev server; commit freely, no pushes. tsc + full vitest (2277) green.
- **Goal-seek is single-hero + wireable:** the composite card suppressed the output-port
  value boxes in goal-seek mode (`runMode !== "goal-seek"` guard) — the achieved output
  just equals the target, so the **Solution** is the sole hero. It then needed its socket
  back: the Solution hero now carries the target output port's `MeasuredSocketRow`, and
  `runGoalSeek` EMITS the solved DRIVER on that port (`row[gs.outputPortId] = solved`), so
  the composite's output IS its solution — wire the break-even units downstream, not the
  trivially-zero profit. Tests updated to the new semantic (output == solution).
- **Arm-and-run for heavy modes (author ask — "Calculate button instead of auto fire; they
  get heavy"):** goal-seek / scenarios / data-table / simulation each do many internal
  passes; in automatic mode they re-solved on every upstream tick. Now `CompositeNode.data()`
  gates on `isHeavyMode()`: solve once (first run OR `requestSolve()`), then HOLD `cachedOutputs`
  and set `stale = key !== lastSolveKey`. `solveKey` is a CHEAP signature — object inputs
  (frames) → a stable ref token via a `WeakMap`, not a deep serialize — so the per-tick cost
  is trivial. `runActiveMode` holds the original dispatch. All arm state is session-transient
  (not persisted): a fresh load solves once, matching the load reveal.
- **Stale indicator:** `compositeStaleStore` (module store) drives it — a HELD composite's
  output doesn't change, so processGraph's changed-output re-render pruning would skip the
  card; the card subscribes to the store instead. UI = a Solve (play) button + an ALWAYS-present
  status circle (so it never resizes the button): amber ring (#d9822b, the alert tone — reused,
  not a new colour) while stale, filled green (`--sock-lambda`, semantic positive) once solved.
  Tooltip "Stale"/"Up to date", no instructional copy.
- **Still open (author raised, not built):** solver PARAMETERS — goal-seek max-iterations /
  tolerance / driver bounds; simulation step count is `simulationSteps` already; Monte Carlo
  (unbuilt) sample count + seed. Fits an advanced-tier expander per mode. See backlog.

### SESSION DIGEST (2026-07-06 late — first-class composite drill-in)
Local dev server; commit freely, no pushes. tsc + full vitest (2276) green.
Author asked to upgrade the Composite drill-in from a second-class overlay to a
first-class canvas ("copy paste, titles not propagating, right click… make it open
in the main app like its own graph"), and to trust my method. Two phases below.

**Phase 2 — the app frame STAYS and follows you in (the real ask).** Phase-1 kept a
separate full-bleed overlay + rebuilt weak chrome inside it; author clarified they
meant the MAIN app frame should stay, only the canvas surface swaps. So:
- **De-fullscreen:** the subgraph canvas now sits at `z-index:4` (above the main
  graph z0, below the chrome z5-6) instead of a fixed inset:0 z9000 panel. Header,
  toolbar, status bar, minimap all stay visible around it. The overlay's bespoke
  header (undo/redo/delete/close/+Node) is RETIRED — keyboard + real chrome cover it.
  What's left is one floating **strip**: breadcrumb (drill-up) + `+Input/+Output`
  (port promotion), accent-tinted as a "you're in a subgraph" cue. `html.sol-drilled-in`
  root class marks the state.
- **Chrome pointed at the active graph:** NavMenu zoom/fit + the minimap/fit geometry
  (`minimapNodes`) read `getActive*`; the drill-in got its OWN `MinimapPlugin` (colored
  preset, collapse-aware, subgraph viewport); canvas **lock** mirrored onto the host so
  subgraph nodes go view-only. Fit bug fixed (a hidden panel's zero-rect made the right
  inset the whole viewport → zoomed way out; null out zero-area rects in `visibleInsets`).
- **Drill-in keyboard extended:** Ctrl+A select-all (via a captured `selectable` handle
  on the mount) and **Tidy (T)** — a self-contained `AutoArrangePlugin` on the drill-in
  area (lazy-imported, cached on the mount, same symmetric ELK port preset). Canvas
  keydown already stood down while a composite is open, so the drill-in owns shortcuts.
- **Extensibility (author asked):** `activeGraph.ts` documented as THE canvas-substitution
  seam (register on mount / clear on unmount / read via getActive*; nested surfaces work
  by REPLACE-not-stack since the breadcrumb stack lives in compositeEditorStore; single
  slot is correct until two live surfaces ever coexist). Extracted the render preset +
  connection veto both surfaces hand-copied into **`areaPresets.ts`** (`solenoidClassicRenderSetup`
  / `makeSolenoidConnectionFlow`) — they had ALREADY drifted (drill-in flow missed the
  lock veto); now one source, used by Canvas + getDrillMount + any future surface.
- **NOT done (main-bound subsystems, would be broken not just unwired):** Group/Cleanup/
  Autofit/Expand (membership + push + collapse + standoffs live in Canvas's main pipes — a
  group made in the drill-in would be a static frame that doesn't push/absorb), Isolate
  (`isolateStore` hides MAIN nodes by z-order, no subgraph scope), navigator + lasso (sizeable:
  navigator list/select/jump/rename all target main; lasso is a custom Canvas rebuild). These
  are folded/hidden while drilled in, not half-shipped. Also still: drill-in **history routing**
  (row/socket/label edits push to MAIN history) + Edit-menu undo/redo on the active graph.

**Phase 1 — the resolver + propagation.** Approach = **B1-surgical**:
keep `process.ts` `getEditor()/getArea()` MAIN-only forever (228 call sites incl.
persistence/serialize — routing them through an override would autosave the subgraph
over the document), and add a NEW resolver the ACTION layer uses.
- **`activeGraph.ts` (the keystone):** `setActiveGraph(ctx|null)` registers the drill-in's
  current level; `getActiveEditor/Area/History` resolve override-else-main; `getOwningEditor(id)`
  returns the drill-in editor when it holds the node, else main (never routes a MAIN node to
  the override). The overlay's mount effect calls `setActiveGraph({internalEditor, area, history})`,
  cleanup clears it. Locked by `activeGraph.test.ts` — the cardinal split (action layer follows
  the drill-in, `getEditor()`/persistence stays MAIN).
- **Drill-in affordances wired:** copy/paste (Ctrl+C/V at cursor, routed through getActive*,
  pasteClipboard has a subgraph branch), A-to-add at cursor, arrow-nudge, and a **right-click
  node menu** (`DrillNodeMenu` in the overlay — Edit-contents (composites) / Duplicate / Delete;
  the main canvas's node menu is isolate/pin/standoff, all MAIN-only, so the drill-in gets its
  own focused set). Duplicate reuses copy/paste by transiently isolating the target on the
  `.selected` flag; markers stay on the add/remove-port gesture.
- **"Titles/formats/types not propagating" — the systemic root + fix:** render-time cross-node
  resolvers (value-box FC annotation in `nodeKit`, `displayedType`, Display FC) and in-node
  socket/row actions (Cast, Chart, Alert, TVM, Extensible + Paired rows, Build Frame rows,
  Get/Add/Split retype, Expression/LAMBDA rebuild) all read `getEditor()/getArea()` (MAIN) —
  so for an internal node they resolved the wrong graph and silently no-op'd. Rerouted the
  display resolvers + unit-flow relocks (Convert/FC) through `getOwningEditor`, and the
  socket/row actions through `getActive*`. `cast.ts` `sourceKind()` left as-is (compute-time,
  not render/action — coupling compute to the drill-in override is a layering smell + only
  helps the drilled-in case).
- **STILL OPEN (see backlog "First-class composite drill-in"):** drill-in render parity
  (minimap, grid-snap, Tidy), factoring Canvas's full keydown onto the active graph, drill-in
  **history routing** (row/socket/label edits still push to MAIN history, so drill-in Ctrl+Z
  doesn't undo them), lasso parity, and D2 proper (reroute the real toolbar — author-present).

### SESSION DIGEST (2026-07-06 evening — command palette overhaul + D-1 goal-seek)
Local dev server; commit freely, no pushes. tsc + full vitest (2271) green.
- **Command palette overhaul:** extracted a shared `menuModel.ts` (one source for the
  menu bar AND the palette — every menu action is a palette command, incl. Document
  properties, which also moved to the File menu); dropped the per-node catalog entries
  (Add node… + the `A` hotkey cover browsing); added an **always-on docked palette**
  setting (click-through scrim, focus→suggestions, Enter/Esc keep it docked); moved the
  align/distribute pill to the top-centre (clears the header at 76px); a persisted
  `commandRecents` MRU feeds the **3 most-recent actions** to the head of the no-query
  suggestions (recorded from palette OR menu bar). Chips now carry their TYPE colour
  (lists/tables gold, frames/cubes violet, charts green) via a `--chip-accent` modifier,
  everywhere incl. Reports. Equinox palette added (all-gray monochrome). Cube glyph seams
  derive from the fill (color-mix) not a hardcoded violet.
- **D-1 Goal-seek run mode (`composite.ts`):** a new `CompositeRunMode` "goal-seek" —
  drives one exposed input until a chosen output hits a target. `runGoalSeek` uses `runPass`
  as the objective (`{[inputPortId]: x}` → read `outputPortId`), solved by a secant-then-
  bracketed-bisection solver (`solveGoalSeek`); `#CONV!` on non-convergence goes to the
  target output + `goalSeekResult`. Config `{inputPortId, outputPortId, target}` persists via
  the `extractInit` deep-copy branch (rides the node line's "rest" catch-all — no textForm
  change). UI: a `GoalSeekEditor` on the card ("Set X To v By changing Y" + solution line),
  auto-inits on mode select. `composite.test.ts` covers convergence/negative/#CONV!/round-
  trip/port-removal. Seed: `composite-workbench` gains a **break-even finder** (profit =
  units×$25 − $500 → solves Units = 20). NOTE: Monte Carlo run mode still blocked on bundle
  12's distribution rep; simulation-inner-display + aliasing UI (D-2/D-3) still open.

### SESSION DIGEST (2026-07-06 pm — autonomous: C-4 XLOOKUP · C-2 Input Switcher · F-1 custom palette · F-2 doc properties)
Local dev server (HMR); commit freely, no pushes. Every commit tsc + full vitest green (→2263).
Five bundles + one incidental persistence bugfix; NOT pushed. Sections newest-first.

**F-2 Document Properties window (v1) — `docMetaStore.ts` + `components/DocumentProperties.tsx`.**
Opened from the DocumentTitle menu ("Document properties…"). Reuses the Settings modal
chrome. Fields: **Title** (the documentStore name, via renameCurrent), **Author** + **Tags**
(new `docMetaStore` → `SavedGraph.meta {author?, tags?}`, carried in the text-form sidecar,
applied on load in `loadGraph`, captured on edit via `documentStore.captureCurrent()`), and
**Color palette (this document)** — a base dropdown ("Follow app" | built-in names) over
`paletteStore.setDocPalette` (preserves any hand-authored overrides; retints live + rebuilds
group dots + captures). Commit-on-Enter/blur text rows; CloseIcon (not a text ×). Tests:
`docMeta.test.ts` (store trim/serialize + sidecar round-trip). DEFERRED (backlog): per-slot
doc palette OVERRIDES editor + document-level FC defaults (a format-pipeline integration).
**Persistence bug FIXED (surfaced by F-2).** `serializeGraph` round-trips through the text
form, which carried `palette`/`meta`/etc. but NOT `comments`/`reportPalette` — both are set
in `buildRawSavedGraph` yet silently dropped by the round-trip. Since the per-doc autosave
uses `serializeGraph` (via `captureCurrent`), node-anchored **comments** (shipped 2026-07-03)
and the report/export palette were being LOST across a save / doc-switch. Added both to the
text-form sidecar (comments name-address their `nodeId` like pins); `docMeta.test.ts` locks
the round-trip.

**F-1 custom palette editor (`palette.ts` + `components/PaletteEditor.tsx`).** A user-authored
full 12-slot palette, selectable as the app base ("Custom" in the dropdown), edited in a
dedicated modal.
- Model: `_appBase` is now `PaletteChoice = PaletteName | "Custom"`; `_customMap` persists
  separately (`solenoid.palette.custom`), seeds from Default. `recompute`/`recomputeReport`
  route through `baseMapFor` (Custom → the user map). Store API: `activeBase()`/`setActiveBase`
  accept "Custom"; `customMap()`, `loadCustomTemplate(name)`, **`setCustomMap(map)`** (commit a
  whole map at once — the editor's Save), `paletteEditorPanel` (modal open flag). Doc/report
  palettes stay built-in-name-only (a doc pin still wins over app Custom). `initPalette` loads both.
- UI (`PaletteEditorModal`, mounted at App level, opened from Settings' **"Edit custom…"** button):
  a real MODAL you enter/exit + Save/Cancel — NOT the old always-inline editor. **Edits live in a
  local DRAFT** that previews ONLY in the sample; the whole app retints ONCE on Save (`setCustomMap`
  + `setActiveBase("Custom")`), never live on every color-drag tick (the reported lag — the old
  onChange→setCustomSlot retinted the whole app per tick). 12 role-labelled color wells
  (Number/Text/Date/…), Load-template buttons, and a sample built from the **REAL** node/group/note
  chrome (`.solenoid-node`/`--grouped` in a `.solenoid-group`, a `.solenoid-note`) colored from the
  draft via the same inline vars the real components set — not a hand-drawn mockup. Only the 12 base
  slots edit; array/matrix stay derived siblings (DESIGN.md Sibling Rule). `palette.test.ts` covers it.
  EYEBALL: Settings → Appearance → **Edit custom…** → edit a well (canvas does NOT retint mid-edit,
  only the sample) → **Save** applies to the app; Cancel discards. Load a template to start from one.

**C-2 Input Switcher upgrade (`CableSwitchNode`).** Two features:
- **Editable per-slot titles** — each input row has a title field (draft-commit via
  `useDraftCommit`), so slots read as named choices; `titleFor(key)` falls back to
  "Input N". Rendered by a new `SwitchOptionRow` sub-component so the per-row title hook
  count stays stable as rows add/remove.
- **Many mode** — a One/Many `SegToggle`. In Many the numbered route buttons become
  checkboxes (`selectedKeys`); the output is a **Cube** collecting the checked inputs — a
  `name` column (titles) + a `value` column (each wired value WHOLE), one row per slot, in
  slot order. Nothing checked → null. `SwitchValue` already renders a cube (CubeChip).
- Persistence: `titles` (object) + `selectedKeys` (array) added to `copyPaste.ts` (deep-copy,
  live-keys-only to keep the text form byte-identical); `multiSelect` was already whitelisted.
  `removeValueInput` drops the slot's title + selection. Seed: `power-features` — `switch-1`
  gained Plan A/Plan B titles, and a new **Many-mode `switch-many`** collects Plan A/B/C into
  a cube (eyeball: the card shows the collected cube chip). `cableSwitch.test.ts` covers it.

**C-4 unified XLOOKUP merge (`frame.ts` `XLookupNode`).**
- **REAL merge, not a wire-driven socket swap.** The author vetoed
  inventing a node whose sockets change based on what's wired in (the Explore-scoped
  duck-typing plan). The legitimate merge came from the author's OWN 2026-07-06 standing
  rule: XLOOKUP's two arrays must be ALIGNED, and aligned columns belong in a FRAME, not
  two loose sockets. So the frame/cube lookup IS the universal XLOOKUP; the two-loose-lists
  `XLookupNode` (list.ts) was DELETED — aligned lists reach XLOOKUP via Build Frame.
- **What shipped:** `FrameLookupNode` (frame.ts) renamed → `XLookupNode`, fixed sockets
  (source, Lookup, In column, Return, If not found). Added: **`searchMode`** (first /
  last — Excel search_mode 1/-1, which duplicate wins; binary 2/-2 omitted — on a
  materialized column it finds the same row linearly) and **Return = `*`** → the whole
  matched row (single-row Frame, or single-row Cube with nested cells intact).
- **Verb refactor (`frameVerbs.ts`):** extracted `lookupFrameRowIndex` / `lookupCubeRowIndex`
  (shared by cell- and whole-row-return so both agree on the row); `lookupFrameCell` /
  `lookupCubeCell` are now thin wrappers (existing signatures + default first → frameLookup.test
  stays green); added `frameRowAt` (via `reorderRows`) / `cubeRowAt` (via `cubeFromColumns`);
  moved `asLookupSource` here.
- **Footprint:** deleted `nodes/lookup.ts` + `components/XLookupNode.tsx`; component merged into
  FrameNodes' `XLookupComponent` (match + search SegToggles); one catalog entry (the "Find"
  XLOOKUP, retyped, accent frame, `new XLookupNode()`; frame-table `frame-lookup` entry removed);
  registry/kind/barrels repointed; seed `asof-join-lookup.json` type → XLookupNode; errorValue.test
  XLOOKUP block rewritten to the frame form; frameLookup.test gained search-last + whole-row cases.
- **Author EYEBALL:** open the **As-Of Join & Lookup** seed — the lookup card is now titled
  XLOOKUP with BOTH a match (Exact/≤/≥) and a search (First/Last) toggle; it still resolves the
  35-qty row to discount **0.05** (≤ next-smaller tier). Try typing `*` in its Return field →
  the whole matched tier row comes out (a 1-row frame). Add-menu: "XLOOKUP" under Find (violet
  frame accent); the old "Frame Lookup" entry is gone.
- **Source socket = `cube`, not `any` (author call, follow-up).** The source uses the `cube`
  socket (lattice supremum → accepts Frame + Cube, rejects lambda/chart a bare `any` allowed,
  shows the cube glyph). Its coercion is BYPASSED via a new `RAW_CONTAINER_INPUTS`
  (`coerceInputs.ts`) so a wired Frame reaches `data()` UNCOERCED — a plain `cube` socket would
  `toCube()` it and strip typed date/logical columns (ISO-date approximate lookups would break).
  Runtime guard rejects a non-tabular source (scalar / bare 1-D list) with `#VALUE!` — cube (like
  any) accepts lower-rank widening at connect-time, so the value-layer guard is where "needs a
  table" is enforced. `anytable` ("Any 2-D") was NOT viable — it rejects both Frame and Cube.
  Inputs left as `string`: Lookup + If-not-found keep the inline text box (type-aware matching
  covers every column type); wiring a computed key = Cast-to-text (author OK).
- **Per-input coercion policy generalized (`node.rawInputs`).** The ad-hoc
  `RAW_CONTAINER_INPUTS` class-name map is retired: a node now declares
  `rawInputs: ReadonlySet<string>` and `coerceInputs` passes those inputs through
  UNCOERCED. The principle (author-aligned): ACCEPTANCE is socket/lattice-driven, but
  COERCION is a NODE decision — default "widen to the declared shape" (95% of nodes),
  `rawInputs` opt-out for a polymorphic node that branches on the runtime shape (XLOOKUP's
  `frame`; any future multi-dimensional INDEX/reshaper). Backlogged the deeper fix: a typed
  `CubeColumn` making frame→cube lossless (would let the bypass retire entirely).
- **Backlog line deleted** (delete-on-done). NOT pushed (local session).

### SESSION DIGEST (2026-07-06 — author-present, chart-node polish + standing rules)
Local dev server (HMR); commit freely, no pushes. Every commit tsc + full vitest (2241) green.
- **STANDING DESIGN RULE (author 2026-07-06): a node that needs several lists/columns
  ALIGNED for its purpose takes a 2-D input (frame/table), NOT parallel list sockets the
  user has to line up by hand.** Don't make the user build a frame, split it into columns,
  and re-wire each column in — take the frame. Generalizes the Sankey/Treemap change below.
  Apply to any new/edited node with position-aligned inputs.
- **Sankey/Treemap take one frame** (edge table From/To/Value; label/value table), read
  positionally, replacing the old parallel list sockets. Chart-showcase seed rewired to a
  Frame Input per figure. Also: Treemap/Sankey/Histogram get the wide (240) card (they draw
  a fixed ~218px plot but their list sockets don't trip the frame/table width heuristic);
  Sankey label side + full-width (dropped a dead 70px right gutter).
- **Chart shows only the op's data socket** — Values (1-D) vs Series (2-D matrix), never
  both; switching op FAMILIES drops the now-dead cable. Output socket now centers on the
  chart figure (a `.solenoid-node__figure` measurement hook, matched first in NodeCard's
  out-socket-top query) so input+output align on pie/radar/etc.
- **No more `[object Object]`:** `describeValueKind` (`valueKindLabel.ts`) labels any
  object-valued kind (chart/frame/cube/diagram/image/lambda); wired as the safety net in
  `ValueDisplay` (the universal fallback → protects every surface), the collapsed-group
  readout, and the Input Switch (which now renders by kind like Display). Chart popup can
  now render a full ChartValue via ChartFigure (chip foundation).
- **Collapse + `[Chart]` chip:** Chart/Treemap/Sankey/Histogram are collapsible — collapsed
  they show a hero box with a right-aligned `[Chart]` chip (`ChartChip`, opens the popup);
  the Display does the same for a wired chart, and the collapsed-group readout shows the chip.
  NodeCard centers the output socket on the first VISIBLE box (so a hidden collapsed figure is
  skipped). **Sparkline minifies to a HEADERLESS SQUARE** (`squareCollapse` prop → NodeShell/
  NodeCard; chevron fades in on hover, spark is `pointer-events:none` so it's inert + the
  double-click-to-expand reaches the card).
- **Input Switch:** renders rich values by kind (chart/cube as compact chips so they don't
  overflow the narrow card, in a display-value box so the collapsed stadium pill centers on
  them); collapsed, its option rows fold into the shared input pill.
- **List Input** rows now take CSV numeric lists (numlist sockets, CSV text via `stringLiterals`)
  and concatenate for the output; 8 seeds migrated `literals`→`stringLiterals`. Surfaced a latent
  bug: a list-node `#CIRC!` loop member showed a stale list — the seeding now sets `cachedList`
  too (was `cachedResult`/`cachedValue` only).
- **Display resize (author flagged FRAGILE — done carefully, incrementally):** ONE universal
  grip on the node BODY (Group's icon/style), **Display-only** (`nodeResizable` narrowed).
  `--box-h` drives the body height; the last body child fills+scrolls, so ANY content type
  resizes without per-type wiring. Cables update LIVE (dropped the drag-time `area.update`
  suppression — the grip drags off window listeners, not pointer capture). **Charts scale to
  fill** (`MeasuredChart`, gated on the Display being sized so measuring a content-driven card
  can't oscillate; the Sankey oscillation was exactly that); **Mermaid fills** (override its
  inline max-width when sized); clamps to a **per-content-type min** (chart 230×150, diagram
  200×120, frame 200×90, else global floor — published to `nodeSizeStore`); the text/scalar
  360px auto-grow cap lifts when sized.
- **Sparkline reworked (not a pass-through anymore):** ops are line/column/**win-loss** (area
  dropped; win-loss = a column chart of the signs); output swaps the numlist pass-through for
  the `chart` value socket (this app passes through only Display + the FC). Retired ops
  normalize on load (area→line, bar→column).
- Small: socket legend clears the footer when the minimap hides; collapsed-group edge sockets
  align with their readout rows (the summary's flex `gap` wasn't in `pillY`).
- **Late stretch (colour system + polish):** `prefers-reduced-motion` snaps the load reveal
  (reuses the doc-switch instant path); dropped the now-dead `nodeSizeStore` dragging flag.
  **Colour consolidation:** the Table (numeric-matrix) socket moved off `vermilion` → `amber`
  (distinct orange from gold/Number in default/solarized; coincides only in the colourblind
  set — no free CVD hue), freeing `vermilion` to be the semantic ERROR red — `appTheme` now
  writes `--sol-error` from the `vermilion` slot so a custom palette retints every error
  surface (default value unchanged). Reordered `COLOR_PALETTE` (the SWATCH PICKER only — chart
  series use a separate `SERIES_SLOTS`): gold-led, gold/gray + green/red column pairs, rest
  alternating. **Sparkline win/loss colours by sign** (up = palette green, down = the palette
  error red) — resolved to hex (recharts fills are SVG attrs), reaching the node AND the expand
  popup; still plain in a Report/Display embed (would need `winloss` as a first-class op — a
  deliberate small follow-up, author OK). Minified sparkline made slightly rectangular + tighter
  vertical padding so the spark fills its height and clears the edge sockets.
- OPEN (parked): **#7 Conduits sometimes unselectable/unmovable except via the Navigator** —
  intermittent, no repro yet; author suspects it's tied to getting group membership (likely a
  z-order / hit-area or membership-sync issue). **FC advanced text options** (alignment /
  markdown-vs-source / mono) logged to backlog for a design-first FC pass.

### DAYTIME SESSION DIGEST (2026-07-05, ~13:00 onward — author review, decisions, FC v1.1-α)
The author reviewed the overnight/extended work (eyeball list passed) and drove decisions
live. Every commit verified tsc + full vitest (now 2184 green); tree clean, nothing pushed.
- **Dev env repair:** node_modules had been gutted by a disk-cache cleanup (app served a
  black screen off a stale Vite) — reinstalled, server recycled. A wiped Rust `target/`
  just rebuilds on the next cargo run.
- **Popup crosshair → "Go to source"** (author catch: flying to the HOST is a no-op — you
  just clicked its chip): `resolveValueOrigin` (`unitFlow.ts`) walks upstream through FCs,
  pure passthroughs, and data-aware selectors (actually-chosen branch) to the producing
  node; stops at transforms (Convert included), indeterminate/ambiguous selectors.
  `2457396`.
- **Image bundling — decision (b), amended:** a plain shared `images/` folder beside the
  saved doc, ORIGINAL filenames (`name (2).ext` only on a true collision, content-hash
  last resort, identical bytes reuse the file). `imageAssets.ts`: bundle on save —
  `saveToDisk` resolves the destination FIRST (`pickSaveGraphPath`) so the JSON written
  after carries the assetPaths; the Image component self-hydrates `dataUrl` on mount
  (covers load/paste/restore with no per-load-path hook). New Tauri fs grants scoped to
  `$HOME/**/images{,/*}` (not dialog-picked → static grants required). Desktop-only; web
  stays session-only. Needs a DESKTOP build to exercise. `fb81d23`.
- **No-century-guessing now covers named-month dates** (author bug report: `20-Mar-26`
  coerced to 2026 in a Frame Input): `parseDateToSerial` requires a 4-digit year run in
  ANY form — bare `Mar 20` (JS guessed 2001!) also rejected; one general guard replaced
  the two numeric-form regexes. `736382c`.
- **FC v1.1-α COMPLETE** (WS-A minus A4; see `docs/format-model.md` + the archived v1.1 plan):
  - **A1 — function model.** Spec `docs/format-model.md` (4-stage pipeline, family table,
    ONE precision×style rule) + `formatModel.ts` as the truth table in code, exhaustively
    machine-checked over the whole SocketDataType union (a new socket type won't compile
    until it declares its family). Scientific honors the precision row (was hardcoded
    `toExponential(3)`); logical sockets gained **show-as** (TRUE/FALSE · 1/0 · Yes/No ·
    ✓/✗, honored by value box/clipboard/inspector/Report refs); complex = reduced style
    list; structural sockets a quiet dash. `c9ffd1f` `f59761c`.
  - **A2 — redesign.** Flow arrows re-audited against the v0.9 semantics (the format
    row's backward-only claim was stale — the whole annotation rides forward): one
    three-state language, `← →` authored · `→ →` inherited · `← ←` Convert-dictated.
    SegToggle unified (the FC's private seg CSS deleted; pixi snapshot selector updated).
    Symmetric arrow-or-spacer gutters align all rows. The chip wears the node header's
    accent ring (a body tint was tried and REJECTED). **Advanced tier** behind a small
    mid-chip expander (persisted `advancedOpen`): 1,000-separator toggle, negative styles
    (paren wraps OUTSIDE the unit, accounting style `($1.2M)`; red = render-layer color
    via `annotationRendersNegativeRed` — first cut silently no-op'd by referencing a
    nonexistent `--danger` var; the real token is `--sol-error`), K/M/B scale. Formats
    cluster ABOVE the unit row (formats re-format freely downstream, units lock — never
    interleave the two). `6fa5874` `82eb80b` `9f24060`.
  - **Light-mode state ramp** (author direction): selection ring nerfed 32%→20% toward
    black, hover made a real step (12%), header/body divider accent-dark. Dark untouched.
    `48b60ac`.
  - **A3 — movement audit.** Most ops were ALREADY correct (the plan's "uneven" claim was
    stale): drag/group-move/tidy/autofit/expand-push/tidy-grow/restore/de-overlap/
    standoff-settle/cleanup all carry docked FCs (`translatePushed`), and the push world
    reserves an output-FC footprint. Two REAL gaps fixed: **collapse hid MEMBERS only**
    (an FC docked to a member but never absorbed floated over the collapsed box → docked
    satellites are now VIRTUAL members: hiding, the Display→FC hop, pills, expand settle;
    `groupCollapse.test.ts`), and the **bug-lane FC-mis-dock** (`findDockTarget` compared
    SCREEN px against a fixed 34px radius — zoomed out that spans a huge canvas area; now
    canvas units, `dist ÷ zoom`, zoom-1 unchanged). `6f53e6a`.
- **Header/body border seam: UNSOLVED, parked** — see the standing entry below; two
  cheats tried and reverted same-day, both eliminated paths documented there.
- **Decisions:** D2 (composite toolbar reroute) and D4 (conditional formatting) DEFERRED
  by the author. Next in WS-A when picked up: A4 units-by-dimensionality (v1.1-β,
  design-the-representation-first).
- **Decision walk + the autonomous plan (~17:00):** the author ruled EVERY open
  input item (see backlog for per-item stamps). Headlines: A4 units IN but
  author-present later ("big boy, together"); D2 reroute approved, author-present
  later; D4/seam stay parked; deferred pile collapsed to #23+#35 (rest OUT);
  #48/#54 became an ultra-minimal library-folder opener; COMPLETE RECHARTS is the
  new viz goal ("grab everything recharts has"); AND/OR Filter IN; Go-To-Special
  OUT; Obsidian vault trio IN (folder setting + read-only Import Note + Write
  Note sink); Finance connection IN reshaped (user-supplied keys, FRED, keyless
  Stooq); grid + collision avoidance deferred again. **`docs/build-plan.md`** is
  the ratified autonomous plan (Tiers A–F, per-bundle footprints/seeds/sequencing);
  the coordination board is live with staged queues (A2 → C-1 Recharts, A3 →
  commit duty + Tier A; Lead → Tier B Rust). STANDING ORDER: anything visual
  ships/extends a SEED (cleanup pass last-minute pre-release). Author note taken:
  the overnight "backlog exhausted" call missed the decided-unbuilt queue buried
  in the old ledger — the open-only backlog + this plan exist to kill that
  failure mode.
- **Parity-doc mining (follow-up ask):** swept toolbar-supplementals + the archived
  pain-points for verdicts that never became queue items. New backlog entries: a
  multi-predicate AND/OR Filter (pain-points §1/§14), pie in the Chart node, "Go To
  Special" select-all-errors chrome, grid-dots visibility toggle, doc-level FC
  defaults (into the Document Properties window item) — the first three flagged
  "rule in/out". Everything else in both docs verified shipped/queued/ruled;
  toolbar-supplementals' closing sections reconciled (its 4 open questions are all
  answered now), pain-points stays archived research.
- **Doc consolidation (author-mandated, aggressive):** dev-notes → digests-only (75
  per-item entries swept to archive); **backlog rewritten to OPEN ITEMS ONLY** (1823 →
  ~170 lines; new standing policy: a landed item's line is DELETED, git + digests are
  the record); 8 finished docs moved to `docs/archive/` (scope-features, v1.0-plan,
  v1.0-audit, performance-hardening, future-directions, strategy-threads,
  isolate-pin-multiview-scoping, node-arity-audit) with all live references repointed;
  CLAUDE.md's doc-maintenance section rewritten to the new policy.


### EVENING AUTONOMOUS RUN DIGEST (2026-07-05, ~18:00 onward — 3-agent crew on `docs/build-plan.md`)
Running digest — agents EXTEND this as bundles land. Every commit tsc + full vitest
green (cargo where Rust moved); commits FIFO through A3. Pushed once mid-run on a
direct author order (`f926fa6..aa5ab34`).
- **Tier A (A3):** locale + cable-shape persist + grid-dots toggle (`d630a43`);
  library-folder opener (`fa6080b`); minimap 3-way position (`c5fc842`); the a11y
  verify-and-finish batch — socket titles, reduced motion, focus traps on the 3 real
  modals, Switch aria-label, legend persistence (`c556b84`).
- **Tier B (A1):** B-1(a) Rust row-key = serde_json tagged tuples, byte-identical to
  the JS oracle (`1efa87d`); B-1(b) Infinity first-class in frames — `__nf` wire
  sentinel both directions, `{"__err":code}` upload contract, NaN present-but-dirty,
  aggregate guard in both backends (`aa2a623`); B-4a compileFormula codegen retired
  (`aa5ab34`); B-4b TEXT-family divergence sweep (text fns coerce numbers via
  numberToText; TEXT "@"/General/zero-pad/scientific patched; VALUE strict; NUMBERVALUE
  owned; DOLLAR accounting parens) + Group By totals (totalDepth → no-colFields pivot)
  — queued; B-2 AND/OR multi-predicate Filter COMPLETE — the filterMulti verb in
  both engines (fused lazy when all-comparison; text predicates collect + mask
  with zero-drift shared exprs), then the Filter Rows node rebuilt as extensible
  condition rows (per-row op + Aa match-case, AND/OR SegToggle at 2+ rows,
  pair-row undo, valueKeys/condConfig persistence); B-3 native CSV date
  inference (engine_read_csv applies the JS unambiguous-ISO gate post-read;
  zone-less = wall-clock as UTC; cargo 68/68). **TIER B COMPLETE.**
- **Tier C (A2):** C-1 COMPLETE RECHARTS — op surface (pie/scatter/radar/radial/
  funnel) + Histogram (`09bc120`); KPI/Bullet/Treemap/Sankey payload figures + shared
  ChartFigure (`7315441`); DateRange dual-date control (`5bd7105`); finale (composed +
  bubble multi-series + `chart-showcase.json`) queued. C-3 popup ⋯ overflow scoped.
- **Author EYEBALL list (accumulating — check on the live app):**
  - `table-verbs` seed: the Group By card has a second select (totals); the
    "Group By Rep → SUM(Amount)" node now shows a **Grand Total** row (555).
  - `chart-showcase` seed (once the finale commits): every new chart type renders.
  - Minimap position setting (Bottom / Top / Hide) in Settings.
  - Desktop only: a frame holding Infinity shows `∞`-ish cells (not blanks) — the
    B-1b sentinel; `formatScalar`'s ∞ glyph itself is still the open [decided] detail.
  - Desktop only: importing a CSV with an ISO date column (`2026-03-15`) now
    yields a real DATE column (renders `15-Mar-2026`), not text — B-3.
  - `table-verbs` seed: Filter Rows is now CONDITION ROWS — the original filter
    (one condition, no toggle visible) plus a new "Region = N OR Amount > 150"
    node (4 rows kept; AND/OR SegToggle appears at 2+ conditions; per-condition
    Aa match-case toggle on text ops; + Add condition).

### UNSOLVED: header/body border seam under zoom (2026-07-05 — parked for a human/later pass)
The node header's 2px accent frame abuts the card's 1px border on the same outer edge;
under the canvas zoom transform the two strokes rasterize with different width-phases →
a subpixel crack at the vertical junction and, at some zooms, a whole-pixel jog in the
bottom edge. **Tried and ELIMINATED — don't retread:**
1. Unify both at 1px (`d713900`, reverted `3be29b2`) — fixes the seam but thins the
   accent band; author rejected the look change.
2. Split the 2px accent into a 1px real border + 1px inset box-shadow ring (`ff3a896`,
   reverted `25ff69a`) — WORSE: Blink rasterizes borders (width-snapped) and inset
   shadows (not snapped) differently, so the two accent layers themselves drift apart
   under zoom.
Constraints: keep the exact current look (2px accent header, 1px body border). Leads
NOT yet tried: one SVG overlay child spanning the full card that draws BOTH strokes in
a single paint (one rasterization pass; needs --header-h published unconditionally —
today it's only measured when a corner badge exists, nodeKit.tsx:314); `border-image`
on the card; drawing frames in the HTML-in-canvas renderer only; quantizing the
area-plugin zoom k to device-pixel-friendly steps (would help every 1px hairline
app-wide, but touches feel of zoom).

### EXTENDED SESSION DIGEST (2026-07-05, ~08:40 onward — "keep going" + a 20-min loop)
Continuation of the block below; per-item entries in the archive. Everything verified
per commit (tsc + full vitest, now 2124; cargo 46/46 where Rust moved).
- **Built:** cube-child Nest Join (A2 — nest a pre-built hierarchy whole); popup
  "Go to node"; per-doc autosave keys landed just before this block.
- **Undo-correctness arc (audit-driven):** extensible-row add/remove is undoable
  (`b0066df` — the generic same-Input-object/key-order helpers); Note frontmatter key
  removal undo-coherent (A2 — confirmed WORSE than flagged: body edits pushed no
  history at all, the zombie cable never self-healed); CableSwitch lane restored on
  undo; F9 exempted from the presenter/drill-in keyboard gates (was a manual-mode
  dead end with all fallback chrome hidden).
- **New standing guards:** textForm reader fuzz (800 mutants — clean rejection or
  round-trip closure); ELK Tidy integration test (A2 — elkjs under vitest, the
  no-overlap invariant through the real arrange→standoff→separate chain).
- **Hygiene/docs:** guarded clipboard writes (non-secure contexts); 6 Rust dead-code
  warnings → 0 (parity-only verbs `#[cfg(test)]`-gated); architecture.md file-map
  fully reconciled (A3, incl. errorValue/textForm/documentStore gaps); dev-notes
  archival sweep (A3 — live window = 2026-07-01+); subsystem-invariants gained the
  per-doc-autosave + drill-in-mount sections; backlog verification sweep (A2 — ~35
  open items checked against code, 1 rot catch flipped).
- **Standby state (superseded by the daytime session above):** the autonomously-
  actionable backlog was EXHAUSTED; the queued author decisions were then resolved
  same-day — image bundling BUILT, FC v1.1-α BUILT, toolbar reroute + conditional
  formatting DEFERRED.

### OVERNIGHT SESSION SUMMARY (2026-07-05, ~03:30–08:30 — 3-agent autonomous crew)
22 commits on develop (NOT pushed — local session). Every commit: tsc clean + full
vitest green (2044 → 2110 tests, +67); cargo 46/46; production build healthy (main
chunk ~2.0 MB after the ELK split); desktop release exe builds. All 26 seeds swept
crash-free through the headless runner. Detailed entries for each item are in the
archive; per-item "author eyeball" notes are inline there (the list passed author
review in the daytime session).

**Features built (all previously author-approved):**
- Frame Filter case-insensitive text matching + "Match case" (the D12 build) — `9ffc8e0`
- Coalesce/Fill full N-ary (extensible Else rows) — `540bba0`
- Per-doc autosave keys (per-doc two-slot pairs + light index) — `ce94761`
- Align/distribute selection action bar (A2) — `3172bc8` · ELK lazy-loaded, ~1.5 MB out
  of the main chunk (A2) — `4635e54`
- Cube-cell XLOOKUP on Frame Lookup (A2) — `5d4eac6` · drill-in dropped-cable notice
  (A2) — `d06517d` · quick-wire memoization (A2) — `1a10863`
- Popup "Go to node" — `4e75b68` · cargo-audit CI workflow (A3) — `7c069a7`

**Audit program (4 review agents + Lead's own passes; every confirmed finding fixed
same-night):** sketch bookkeeping leak `75c62c9`; round 2 `3141e10` (presenter left all
canvas shortcuts live; docked-Report squeeze orphaned on delete/doc-switch; Expect
blind to frames; model fuzz no-op in manual mode + fired real alerts; Problems relapse
suppressed forever; textForm broke SAVING on a frontmatter key with a space); round 3
`ce22c73` (composite drill-in leaked LIVE React roots — auto-refresh intervals ran
forever after close/delete; scrub-unmount cursor lock; stale add-menu on doc switch;
semantic zoom invisible in the canvas renderer; Write double-click race;
connectionStore.forget never wired) + the add-menu refinement `c22a6a3` (close on doc-ID
change only — autosave's notify was yanking open menus); Reconcile honesty fixes (A2)
`94bcbd9` (skipped-key rows surfaced; PVM excludes errored cells).

**New standing guards (A2):** `layoutInvariants.test.ts` (~1650 seeded fixtures — the
no-overlaps rule is now machine-checked; NO violation found) `11397dd`;
`formulaDivergence.test.ts` (the node-vs-Formula.js sweep is now a durable CI tripwire;
no new drift) `253727a`.

**Author decisions (resolved in the daytime session):** image bundling → BUILT (option
b, amended); composite toolbar-reroute → DEFERRED (architecture write-up in the
archived drill-in entry). Eyeball list passed review.

---

## Older entries archived

Per-item entries live in [`archive/dev-notes-history.md`](archive/dev-notes-history.md).
Sweeps: through 2026-06-18 (on 06-21) · 2026-06-19–06-30 (on 07-05) · the
2026-07-01–07-05 per-item entries (on 07-05, the session digests stayed here).
