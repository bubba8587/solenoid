# Solenoid — Backlog

Non-immediate items captured during development. Larger features get
GitHub issues; small UX tweaks, polish work, and verification tasks
live here.

When an item lands, check it off — leave the line in place so the
history of decisions is preserved. Periodic pruning passes can delete
stale completed items.

**Status (1.0).** The Excel-alternative layer, the relational verb set, the native
Polars stack, AND the lazy-handle-on-cable finish (2026-06-30) all shipped. What's
left for 1.0 is essentially the **Windows packaging** (the portable `.exe` builds via
`npm run tauri build -- --no-bundle`; a versioned/installer artifact is the open
item) — see [`v1.0-plan.md`](v1.0-plan.md). The renderer is the HTML-in-canvas path
(shipped), not the parked WGSL/Pixi one. Future scale niceties (not 1.0 blockers):
lazy-plan fusion + a direct CSV→Polars reader (the eager engine + JS CSV parse are
the current ceiling). **v1.1** = the deferred tail (FC redesign, node packs, grid,
collision avoidance, chrome customization). This backlog is the fine-grained list.

---

## Post-audit tails — settled plans (2026-07-02 step-by-step review, record-then-build)

Each item below was discussed individually with the author and the DECISION is settled;
the build happens after the whole list is walked. Context: v1.0-audit.md "Still open".

**2.0 FEATURE-WALK BOOKMARK (paused 2026-07-02, author stepped away mid-walk).**
Goal: walk EVERY feature/scope suggestion one-by-one (author rules in/out, agent owns
ordering), then run the design deep-dives, then author the `docs/v2.0/` plan-doc set
("nothing left to question") for massive parallel agent implementation. No version-cut
ceremony — author explicitly doesn't care about 2.0 boundaries. Verdicts are recorded
INLINE in the source docs (`future-directions.md`, `strategy-threads.md`,
`scope-features.md`).
Done so far: Bet 1 IN (previews are a hard invariant) · Bet 3 IN · Bet 2 IN (no
export-first phase — text format lands whole; public positioning = Obsidian-style
file-over-app, NEVER advertise AI) · Bet 4 IN (two tiers) · units-as-types IN and
EXPANDED to full dimensional algebra (`#UNIT!`, AST dimensional interpretation for
Expression/LAMBDA) · golden tests PARKED (revisit end of walk) · data-drafts-its-own-
graph PARKED (author thinking).
Smaller swap 4 (Cube identity) DECIDED 2026-07-02: OUT as identity, kept as headline
capability/seed (verdict inline in future-directions.md).
Scope-features #1–19 walked 2026-07-03 (verdicts inline): #1 IN (subgraph run-mode
hook) · #2 DEFERRED · #3 IN tiers 1-2 · #4 IN (all five run modes on the one
container) · #5 ecosystem OUT, document-local container only, packs distribute ·
#6 DEFERRED · #7 ALL OUT · #8 IN for sure · #9 IN very limited (manual file sinks
only) · #10 IN · #11 DEFERRED (transform-by-example — author wants hands-on time with
the area first) · #12 IN (expectation nodes / data-quality gate) · #13 IN — corrected:
the report is one editable, blank-by-default markdown FILE independent of the graph
(not canvas Notes rendered in order), reusing the Note's inline-ref span directly and
able to embed Note nodes · #14 IN (node-anchored comments — right-click "Add comment,"
surfaced in a comment pane like Alerts/pins) · #15 IN (engineering/scientific calc
seat — the MathCAD replacement, units-as-values is the winning card) · #16 IN
(BOM/nested-costing vertical on the Cube) · #17 IN, minor, sequence LATE — needs
#4's Monte Carlo hook + #5 subgraph container to land first (wiggle-the-weights
depends on them) · #18 OUT (embeddable-engine identity fork — not pursued). Deferred
pile for end-of-walk revisit: #2, #6, #11, #23, golden tests, data-drafts.
Round 3 (#15–19, the stretch markets) closed 2026-07-03: #15 IN (engineering calc
seat) · #16 IN (BOM/nested-costing on the Cube) · #17 IN minor, sequence late (needs
#4 Monte Carlo + #5 subgraph first) · #18 OUT (embeddable-engine identity fork) ·
#19 OUT (leans on the #7 NL surface, which stayed all-out).
Round 4 (#20–28, the value-model frontier + compute substrate) begun 2026-07-03: #20 OUT (named
dimensions — walked through a concrete example, didn't land; socket lattice stays a
two-leg stool, no axis-semantics leg) · #21 IN, VERY LATE (uncertain values / error-bar
propagation — possible, sequence dead last alongside #43 money) · #22 IN — no new
node: As-Of Join is a `how` value on the existing Join node (frame.ts:228), As-Of
Lookup is FrameLookup's already-flagged approximate-match follow-up (frame.ts:1071) ·
#23 DEFERRED (persistent compute cache — joins the end-of-walk revisit pile) · #24 IN
(sketch-mode approximate calc — must get a footer/StatusBar affordance, not just a
per-value badge). Round boundaries in the doc (verified against headers, corrects an
earlier "#20–24" mislabel above): Round 4 = #20–28, Round 5 = #29–36, Round 6 = #37–42,
Round 7 = #43–49, Round 8 = #50–57, Round 9 = #58–63 (end of doc).
#25 OUT (graph profiler heatmap) · #26 OUT (synthetic data mode).
NEXT when resuming: scope-features #27, then #28–63 in order (folding in
strategy threads #1–#7 and the
unfinished v1.1-plan workstreams where they belong), then the parked pair, then the
design deep-dive sessions (order: Bet 2 text format → units/FC function model →
engine execution contract (Bet 1 × #23 × #24 × calc mode) → #5
composites (document-local container ONLY — no sharing/ecosystem, packs are the sole
distribution channel; the session owns the container shell + typed boundary + FIVE
run-mode hooks: simulation, data tables, solver, scenarios, Monte Carlo — ruled
2026-07-02) → #9 sinks + #3 scheduling → #43 money → #21 uncertain →
#8 transpiler → linked graphs → #13 report layout), then plan-doc authoring.
(#20 dimensions dropped from the deep-dive queue — decided OUT above, no session
needed.)

**1.0-TAIL WALKTHROUGH BOOKMARK (2026-07-02 — COMPLETE; build pass awaits explicit
go, see item 6 below).** Everything below this
section is decision-recorded. The QUEUE when resuming, in order:
1. **Locale number input — DECIDED 2026-07-02: force US-style everywhere.** Author: "I
   don't respect comma decimals." All value display uses period decimals + comma
   thousands separators regardless of OS locale — no locale sniffing, no setting. Build:
   pass `"en-US"` (shared constant) instead of `undefined` to every `toLocaleString` —
   `formatAnnotationStore.ts` (the value formatter, ~5 sites) + the cosmetic row-count
   strings in CubePopup/TablePopup/RendererSpike. Inputs stay dot-decimal-parse-only;
   display and input now agree by fiat. Closes the item — no separate design session.
2. **UX/a11y mechanical list — APPROVED as one batch 2026-07-02** ("all seems good"):
   text `×`/`✕` → shared CloseIcon (~6 files); socket-dot hover `title` naming the type
   (structural text; the only colorblind path); `prefers-reduced-motion` honored by the
   load reveal; `Ctrl+/` match `e.key` not `e.code` (non-US layouts); Group/Note title
   editors through draft-commit (Escape revert); the 33 `outline:none` → `:focus-visible`
   sweep; modal focus traps; Settings `Switch` accessible name; socket-legend
   open/collapsed persistence. All land in the build pass, UX tier.
3. **cargo-audit in CI — APPROVED 2026-07-02.** Small workflow: `cargo audit` on
   `src-tauri/Cargo.lock` on pushes to develop; triage noise via `audit.toml` ignore
   list as it comes up.
4. **Frame P3s**: (a) **DECIDED 2026-07-02 (delegated — "do as you wish"): Rust builds
   the byte-identical oracle key.** Replace `Cell::key()` + the raw `\u{1}` joins
   (engine.rs distinct + group_by) with `serde_json::to_string` of the SAME tagged-tuple
   encoding as JS `encodeCell` (`[["s","a"],["#",1]]`) — collision-proof by
   construction, fixes the `-0` float-format divergence for free, and the error-cell
   variant (`["e", code]`) lands with the (b) wire work (Rust `Cell` gains an error
   case). Add a cargo parity test with a `\u{1}`-bearing fixture asserting literal key
   equality.
   (b) **DECIDED 2026-07-02: Infinity is first-class in frames, same as scalars.** The
   IPC wire gains a non-finite sentinel (e.g. `{"__nf":"inf"|"-inf"|"nan"}`) in BOTH
   directions — JSON's Inf→null default was never a hard constraint, we own both ends;
   the silent null-ing on upload disappears too. Frame cells hold ±Inf (and residual
   NaN as dirty-data residue). Aggregates apply the SAME general guard as scalar ops in
   both backends: result ±Inf with an ±Inf in the input column → passes through
   (SUM of ∞ is ∞); result ±Inf from all-finite column → per-cell `#OVERFLOW!`; result
   NaN → `#DOMAIN!`. Input scan runs only when the result is non-finite (free on the
   happy path). Cargo parity tests pin the backends together.
   (c) **DECIDED 2026-07-02: ACCEPT.** Desktop source freeing stays GC-timing dependent
   (WeakMap identity cache; stale Rust copies linger until a JS GC, self-healing,
   never observed in practice). Document the behavior + the explicit-free lever in
   subsystem-invariants during the build pass; build nothing now.
5. **Persistence P3 — DECIDED 2026-07-02: persist cable shape.** `cableShapeStore` gets
   the same localStorage pattern as its siblings (`cableFlowStore`/`calcModeStore`):
   one key, read at module init, try/catch private-mode guard.
6. **QUEUE COMPLETE 2026-07-02 — every item is decision-recorded. Build pass NOT
   started (author: "don't build yet"); awaiting the explicit go.** Suggested order
   when it comes: compute semantics (broadcaster contract first — most shared
   machinery, the #OVERFLOW!/#DOMAIN! guard + frame non-finite work hang off it),
   filter case + Match case, rounding/MRound + lookup redirects + NUMBERVALUE + dates,
   quality deletions, perf, UX. Keep `docs/value-semantics.md` tags flipped shipped as
   each lands.

- [ ] **Frame Filter text matching → case-INsensitive** (audit 28's held-back half —
  REVERSED on revisit). eq/neq/contains/startsWith/endsWith all match case-insensitively,
  aligning Filter with the app's one text-equality semantics (P6 `=` table, Comparison,
  XLOOKUP, Frame Lookup) and with Excel FILTER/AutoFilter. A **"Match case" checkbox** on
  the Filter node (default off, string columns) is the escape hatch, riding the wire as a
  flag. Rust: string eq/neq join the in-engine row-scan path (like the text predicates),
  lowercase compare; cargo parity tests incl. an accented char. **Join / Group By /
  Distinct stay case-SENSITIVE** — keys are identity (databases/Polars/PQ), unlike Excel
  PivotTable's silent case-merging; document as parity:false catalog notes. The rule:
  *comparisons match like Excel's `=`; keys are identity.* String lt/gt byte-vs-locale
  ordering stays a separate P3.
- [ ] **Per-cell error/null contract factored INTO the broadcasters** (extends audit P3
  "error code morphs"; node layer confirmed worse by probe: `[1,#DIV/0!,3]+10` →
  `[11,"[object Object]10",13]`, `[1,null,3]+10` → `[11,10,13]`). ONE rule, per output
  element, before the fn runs: SolError operand → that error UNMORPHED (first in arg
  order); else missing operand → `null`; else compute. Applied in `shared.ts`
  `broadcast`/`broadcastErr`, `excelFormula.ts` `broadcastCall` + the percent/`mapOne`
  unary path. `broadcastEl` (logic family) keeps feeding nulls to Kleene (its correct
  null rule) but gains the error guard. Node-layer `null+10` flips 10 → null — author
  confirmed (follows the settled P6 SQL-null model; Fill/Coalesce is the recovery).
  In-range cells thereby behave identically to ragged-padded positions. **Scope
  addition (probe discovery):** the `inputs.a?.[0] ?? this.literals.a` read idiom
  swallows a WIRED null into the literal fallback (`??` catches null — a blank cell
  flowing in silently becomes whatever number sits in the box). Add a shared read
  helper distinguishing `undefined` (unwired → literal) from `null` (wired missing →
  propagate) and sweep the scalar nodes' data().
- [x] **Formula AND/OR vs node Kleene — KEEP BOTH, document (decision (a), author
  confirmed).** The line: *reduction contexts skip nulls* (formula AND/OR = Excel
  blank-ignore = SQL BOOL_AND; the Aggregate family) while *element-wise/expression
  contexts are Kleene* (BooleanOp/Comparison/IF = SQL WHERE). Each side matches its
  reference model; unifying either way breaks one of them. Deliverable is docs only:
  BooleanOp catalog note (parity:false — "null operands follow Kleene, unlike Excel's
  blank-ignore; Fill/Coalesce first, or formula AND, for Excel behavior") + the rule
  recorded in subsystem-invariants "Error values". (Checked = decision recorded; the
  note ships with the build pass.)
- [ ] **Non-finite results: the general guard — `#OVERFLOW!` / `#DOMAIN!` / proper
  Infinity (author confirmed; SUBSUMES the earlier pow-only item).** One shared helper
  in the compute layer (composes with the per-element broadcaster rule), classifying by
  RESULT with input awareness:
  - **result NaN → `#DOMAIN!` always** (indeterminate/undefined: (-8)^(1/3), ∞−∞, ∞/∞,
    0×∞, NaN input entering the op — no true value exists);
  - **result ±Inf from all-FINITE inputs → `#OVERFLOW!`** (NEW tagged error code — the
    true answer is a really big NUMBER, not infinity; Excel mints catch-all #NUM!, ours
    is more specific; ERROR.TYPE → 6, IFERROR/ISERROR catch it like any SolError);
  - **result ±Inf with an infinite INPUT → passes through** (definable infinity: the
    Constant node's Infinity is a first-class value; ∞+5=∞, 2×∞=∞, 5/∞=0).
  Consequence: computation can no longer PRODUCE a NaN — the residue is dirty data
  only. Bookkeeping: errorValue.ts code inventory 13→14 (subsystem-invariants count +
  error-showcase seed row); Infinity support is untested past Arithmetic — spot-check
  comparisons/aggregators/sort/logical-bridge/formatScalar (∞ glyph? author eyeball).
  **`0^0` stays 1** (JS/Python/R/Polars convention; erroring in JS while Polars says 1
  would manufacture a parity split) — parity:false note ("Excel gives #NUM!"). Frame-
  engine non-finite behavior (Polars silent inf; wire normalizes to null) is a separate
  P3, deliberately NOT folded in.
- [ ] **NaN display affordance (author confirmed).** Residual NaN (dirty data reaching a
  value box / popup cell) renders as literal `NaN` with a QUIET affordance: muted
  background tint — not the error badge red, not plain-number styling, shaped/toned to
  not read as an ArrayChip — plus a structural fixed-text hover tooltip ("Not a number —
  undefined value in the data"). formatScalar's current "N/A" rendering is a lie
  (post-finding-13, #N/A is a real catchable error; NaN is not it). Styling per
  DESIGN.md, author eyeballs at build.
- [ ] **Stale description sweep (author confirmed).** Catalog text rendered verbatim in
  Ctrl+/: div "null when B=0" (→ #DIV/0!), text-find "null if not found" (→ #VALUE!),
  XMatch "(null=not found)" (→ #N/A), CHOOSE "Fixed 4 values" (extensible), Cast
  (missing logical target), Alert (describes removed colored UI, 1 of 4 modes), Note
  ("carries no data" — frontmatter sockets exist). Pure text, no decisions.
- [ ] **Round-to-multiple: MRound gains ops nearest/up/down; MathFn ceil/floor DELETED
  (author confirmed).** Direction is an op, shape is a node (the RoundN precedent —
  round/roundup/rounddown are ops over (value, digits); nearest/up/down are ops over
  (value, multiple)). Catalog gains separate searchable **CEILING** and **FLOOR**
  entries creating the MRound node pre-configured (header label tracks the op, so the
  card reads "CEILING"); `multiple` literal defaults to 1, so those entries behave
  unary out of the box — Excel's own shape (CEILING.MATH's significance is optional,
  default 1; Excel has NO unary ceiling). MathFn's unary ceil/floor ops go away (a
  programmer's Math.ceil concept; INT/TRUNC stay for the integer idioms) — remove from
  MathFnOp + meta + NODE_EXCEL (the catalog↔registry test catches stragglers), sweep
  seeds for saved op:"ceil"/"floor", add `ceil floor` keywords to the MRound entries.
  Formula-layer CEILING/FLOOR (FX, .MATH-like semantics) untouched, no parity note
  (deprecated-Excel comparisons disregarded per author ruling 2026-07-02).
- [ ] **Classic lookups OUT of the formula layer — redirect errors (author confirmed).**
  The 2026-07-02 fix pass (audit finding 10) added working internal VLOOKUP/HLOOKUP/
  LOOKUP/MATCH impls, contradicting the standing elimination (node-coverage.md:33,
  the MATCH-node deletion). Replace them: typing one in a formula → `#NAME?` with the
  message **"Use XLOOKUP"** (MATCH → **"Use XMATCH"**) — nothing longer, per the
  no-Captain-Obvious rule. **INDEX stays** (current Excel, never superseded). Delete
  the four impls + their tests; add redirect-message tests.
- [ ] **Number→text conversion at 15 significant digits (author confirmed).** One shared
  `numberToText` helper (15 sig digits, trailing zeros stripped) used by `applyOp`'s `&`
  and thin wrappers for FX-routed CONCAT/CONCATENATE/TEXTJOIN, so `(0.1+0.2) & " kg"` →
  `"0.3 kg"`. **Rationale: IEEE, not Excel** — a double guarantees ~15 clean decimal
  digits; digits 16–17 are representation noise, so printing them into user-built text
  is publishing garbage (that Excel picked the same cutoff is coincidence, not the
  motive). Scientific-notation thresholds deliberately NOT chased.
- [ ] **Dates: numbers are LITERAL years; text year-tokens are EXACTLY 4 digits; nothing
  guesses (author confirmed).** Every 2-digit-year disambiguation (Excel DATE's +1900,
  Excel text-parse's 00–29 pivot, .NET, sliding windows) is a guess that goes stale
  (it's 2026; pivot-30 breaks in four years) — and Excel's two rules contradict each
  other (DATE(26)=1926 but typed "1/15/26"=2026). Precedent: the filter-value spec's
  "unparseable → deterministic refusal, never a silent guess". The rule, two sentences:
  - **Numeric year (DateConstruct, wired or typed): literal, range 1–9999**, else
    `#DOMAIN!`. DATE(26) = 26 AD (renders 15-Jan-0026 — visibly odd beats silently
    wrong-century); DATE(1850) works (pre-1900 negative serials probe-verified
    end-to-end: construct/format/YEAR round-trip). No sub-100 carve-out — a number
    carries no century ambiguity; that only ever lived in text formats. The range
    guard kills the "15-Jan-0-50" formatter garbage.
  - **Text parsing (`parseDateToSerial`: DATEVALUE/Cast/CSV/frontmatter): a year token
    is exactly four digits** — "0026" = 26 AD, "0126" = 126 AD, "026"/"26" = not a date
    (string stays string; DATEVALUE → #VALUE!). Verify current parser behavior at build
    time and align.
  - Storage stays the honest true type; 2-digit-year DISPLAY, if a user wants it
    app-wide, is the Format Controller's job (presentation, not storage).
  - parity:false note on DATE; drop the JS Date.UTC two-digit remap (the current
    accidental 26→1926). Build checklist: spot-check EDATE/EOMONTH/YEARFRAC/WORKDAY
    on negative serials.
- [ ] **IFS/SWITCH no-match with no fallback → tagged `#N/A`, both surfaces (author
  confirmed).** An uncovered case is a logic hole, not missing data — null renders a
  quiet blank and aggregates skip it (invisible); `#N/A` is loud until acknowledged via
  the sanctioned paths (the Otherwise/default row, or IFNA). Matches XLOOKUP's
  not-found. Node UX: fresh IFS/SWITCH ships the Otherwise/default slot EMPTY but
  renders a muted **`N/A` placeholder** in the box (state display, not a typed value —
  no magic "N/A" string, nothing to accidentally delete); blank → #N/A, typed value →
  that value, cleared → #N/A again. Formula IFS/SWITCH same. CHOOSE out-of-range index:
  verify at build, align to the tagged-error model (Excel: #VALUE!). Tests pin all.
- [ ] **NUMBERVALUE: strict full-string parse + current-Excel completeness (author
  confirmed).** `parseFloat` parses greedy prefixes so "12x" → 12 and "12%" → 12 (wrong
  NUMBER, worst cell of the item) instead of reaching the node's own #VALUE! branch.
  Replace with strict `Number()` semantics on the normalized text, plus NUMBERVALUE's
  two documented behaviors: trailing `%` signs each ÷100 ("12%"→0.12, "12%%"→0.0012);
  ALL whitespace ignored incl. embedded ("1 234"→1234). Blank → null stays. Tests pin
  "12x", "12%", "1 234", swapped-separator "1.234,56", blank.
- [ ] **Input-field defaults render as muted PLACEHOLDERS, not label parentheses (author
  confirmed).** NumberValue's `Decimal sep (default ".")` labels → label "Decimal sep",
  muted `.` placeholder in the empty field; blank = default applies, typed = override
  (literal ships empty; data() treats "" as use-default). Same pattern as the IFS
  Otherwise `N/A` placeholder. Sweep all nodes for other `(default …)` label text.
- [ ] **Logical bridge: NaN → null, not TRUE (author confirmed, on recommendation).**
  `numsToBools` (`coerceInputs.ts`) uses `v !== 0`, so NaN reads as a confident TRUE at
  every logical socket. Post-finding-13, NaN is just an undefined number → its truth
  value is Kleene null (unknown), matching R/pandas logical coercion, `coerceLogical`'s
  "not coercible → null" (verify + align at build, one spec per D11), and the existing
  NaN→null IPC normalization. Non-zero finite → TRUE, 0 → FALSE, NaN → null. Tests pin
  IF and Comparison fed NaN.
- [ ] **List UNIQUE: errors NEVER dedupe; frame Distinct unchanged (author confirmed).**
  Today's identity-dedup is a lottery: three independent failures survive as 3, but one
  error fanned into three cells collapses to 1 (same-looking data, different answer).
  New rule: list UNIQUE dedupes values normally (nulls collapse to one) but EVERY error
  cell survives, deterministically — the Excel-user sanity check ("10 values + 3 errors
  = 3 fixes to make"). No checkbox: set-clean output already has a sanctioned path
  (IFERROR/Fill upstream). Frame Distinct stays by-code (relational identity, D12
  family). Add to D12: second instance of the line — list ops answer to the
  spreadsheet model, relational verbs to the relational model.
- [ ] **Seed-writeback scaffolding: DELETE (author confirmed).** `devRebuildSeeds.ts` +
  the `main.tsx` dynamic import + vite.config.ts `seedWritebackPlugin` — agent-era
  one-time tool, self-flagged for removal, seeds are saved; the author regenerates
  examples by building graphs in-app.
- [ ] **Quality tail — PENDING per-item walkthrough (do NOT build unconfirmed):**
  delete dead `SliderInput.tsx` **(CONFIRMED 2026-07-02 — the widget file, not the
  Slider node)**; devDeps **(CONFIRMED 2026-07-02: drop `msdf-bmfont-xml` +
  `@types/styled-components@5` (tsc-verify); KEEP `puppeteer-core` — author sometimes
  overrides the no-puppeteer rule)**; import cycle via `documentStoreCore.ts`
  **(CONFIRMED 2026-07-02 — "do as you wish")**; gate `perfScaling.test.ts` behind an
  env var; vitest `include` → `*.test.{ts,tsx}`; `noUncheckedIndexedAccess`
  considered-and-declined. perfScaling gate + vitest include + the tsconfig decline:
  **approved-by-delegation 2026-07-02** (author: same don't-care tier as the cycle).
- [ ] **Bundle splitting (author confirmed).** Lazy-load recharts, KaTeX, and ELK (the
  pixi pattern, already split correctly) — main chunk 4.0 MB / 1.2 MB gz shrinks
  substantially; first use of chart/formula-preview/Tidy after a cold load pays a
  one-time fetch (imperceptible on desktop, a beat on web).
- [ ] **Per-doc autosave keys (author confirmed, no objection).** One localStorage key
  per document + a light index, each with its own two-slot rotation — an edit
  autosaves only that doc; a bloated doc exhausts only its own quota headroom. No
  migration (pre-alpha): old whole-library autosaves abandoned at the format change;
  disk saves untouched; the live session re-autosaves immediately under new keys.
- [ ] **Minimap: z-order bug** — some nodes render OVER the minimap (author report
  2026-07-02). Investigate the stacking context (area-plane z vs the minimap plugin's
  layer).
- [ ] **Minimap: smoothing/update rate** — visibly jumpy under continuous mouse drag
  (author report 2026-07-02). Consider rAF-throttled updates + interpolation, mindful
  of the never-degrade-cables rule's spirit (smoothness over jump-to-latest).

---

## Renderer (v1.0) — adopt PixiJS, demote Rete to headless (decision 2026-06-26)

See [`archive/renderer-decision.md`](archive/renderer-decision.md). Supersedes the WS4
hand-rolled-WGSL direction (parked). The GPU spike proves the path; the real port is the work.

**Direction refined 2026-06-27 → HTML-in-Canvas (native) over Pixi hand-repro, and PERF-VALIDATED**
(280 nodes, fully zoomed out, crispest quality → 165fps / 0.1–0.5ms draw — render perf CLOSED at the
≤~300-node target). Mipmapping (capture once at 1.5×, halving pyramid, `drawImage` the level) was the
unlock. See dev-notes 2026-06-27. Pixi items below stay done-as-built but are no longer the target.

- [x] **HTML-in-Canvas spike + perf validation** — done (2026-06-27, `HtmlCanvasSpike.tsx`): native
  `captureElementImage` → mip-pyramid `ImageBitmap`s → `drawImage`, drawing the REAL cards; cable
  caching/cull/batch; aggressiveness slider; zoom presets. **Render perf is closed.** Remaining port
  work (editing/drag wired to the model, floating-input rename, ribbon-cable parity, groups/conduits
  interaction) is non-perf. External risk = the `chrome://flags/#canvas-draw-element` flag reaching
  stable Chrome / WebView2 (~late 2026).
- [x] **Outside review + decision** — done (`renderer-decision.md`): adopt PixiJS v8
  (WebGPU + auto WebGL2 fallback), keep Rete headless, DOM only for the active editor.
- [x] **Pixi spike — pure tested core** — done (`src/graph/pixi/`): camera, card layout,
  spatial-index picker, cable-geom adapter (reuses the real router). ~30 tests.
- [x] **Pixi spike — live graph render** — done: snapshots the real rete graph (faithful
  cards + real cable routing + group rects), drag persists via `area.translate`,
  double-click floating-`<input>` rename (the hidden-input pattern), pinch, LOD, cull,
  benchmark, BitmapText↔Text A/B. Buried at Edit ▸ "Renderer spike (Pixi)".
- [ ] ~~**MSDF text pipeline** — generate an atlas (`msdf-bmfont-xml`) for the app fonts;
  replace the spike's dynamic BitmapText. Crisp at any zoom, fully batched.~~ **SUPERSEDED
  by HTML-in-Canvas** (2026-06-27 pivot): crisp-at-zoom text comes from capturing the real
  DOM cards into a mip-pyramid of `ImageBitmap`s (`htmlCanvasRenderer.ts`), no atlas. Not building.
- [ ] ~~**Port cables off `ConnectionComponent`** to the Pixi cable layer (geometry is
  already reusable; this is phase 1 of the real swap).~~ **SUPERSEDED** — cables are drawn by the
  HTML-in-Canvas engine (`HtmlCanvasLayer.tsx` `engine.setCables`), not a Pixi layer.
- [ ] ~~**Port node bodies** to Pixi cards + MSDF; rehost the React node components off
  rete's render contract (DOM for the active node only).~~ **SUPERSEDED** — node bodies are
  captured from the live DOM cards (`HtmlCanvasLayer.tsx` `collectSpecs`), not reimplemented in Pixi.
- [x] **Selection / drag / multi-select / box-select** — done in the spike: shift-click,
  box-select, multi-drag (persists via area.translate), accent ring; on the CardPicker
  spatial index. Plus socket-drag cable creation (writes real connections), Delete, and
  a minimap. (Retiring the rete-area interaction paths happens at the flag-swap.)
- [ ] ~~**Minimap** as a second small Pixi view; **remove** `rete-react-plugin` /
  `rete-area-plugin` / `rete-connection-plugin` / `rete-render-utils` once covered.~~ **SUPERSEDED** —
  HTML-in-Canvas deliberately KEEPS the rete DOM/area plugins as the universal fallback + interaction
  layer (`renderMode.ts`, `HtmlCanvasLayer.tsx` docstring). Removing them is no longer the plan.
- [ ] ~~**Chrome DevTools trace** (cheap, do first): confirm Composite Layers dominates the
  dense-graph zoom over Recalculate Style.~~ **SUPERSEDED/moot** — was a diagnostic for the parked
  WGSL investigation (final verdict reached; see `performance-hardening.md`).

## 1.0 desktop hardening + heavy-table perf (2026-07-01, all DONE)

These landed during the 1.0 wrap but had no prior backlog line — captured here for the record.

- [x] **Manual/automatic calculation mode** — done: `calcModeStore.ts`; File→Calculate items
  live; **F9** global shortcut (`Canvas.tsx` keydown); StatusBar "Calculate" chip when dirty.
  In manual mode `processGraph` short-circuits + flags dirty; loads/seeds exempt.
- [x] **"Computing…" overlay** for irreducibly heavy passes — done: `computeOverlayStore.ts` +
  `components/ComputeOverlay.tsx`; deferred reveal (150ms) + min-visible (350ms); blocks
  pointer/wheel/keyboard while a heavy `processGraph` runs.
- [x] **Heavy-table perf root-causes** — done: targeted recompute for value-edit inputs;
  source-handle cache (`frameBackend.ts` `_sourceCache`, WeakMap by frame identity — a frame
  uploads to Rust once); additive add-node path; cached `loopMembers` Tarjan.
- [x] **Runtime perf probe** — done: `perfProbe.ts` (`window.__solenoidPerf` per-pass node
  `data()` + engine IPC timing; `window.__solenoidStats()` cumulative tables).
- [x] **Desktop shell niceties** — done: F12 / Ctrl+Shift+I devtools hotkey (`open_devtools`);
  Windows 11 window border tracks the accent (`set_window_border` → `DWMWA_BORDER_COLOR`);
  the HTML-in-Canvas flag enabled in `additionalBrowserArgs`.
- [x] **Desktop relative-asset fetch** — done: `httpBridge.ts` routes only absolute URLs through
  the Tauri http plugin, so a seed's relative `/data/*.csv` loads on desktop too.

---

## v0.9 blockers (the web-demo era — ALL DONE; these gated the v0.9 freeze)

- [x] **Per-node socket-dimensionality audit** — done 2026-06-19. Walked every
  input on every node (~30 node files, ~470 inputs) against its `data()`. Verdict:
  the declarations were **already correct end-to-end** — no socket changes were
  warranted. The codebase consistently follows one rule, now written down as the
  **Input-dimensionality rule** in `docs/node-coverage.md`: element-wise math
  *operands* → `numlist` (broadcast, Excel array-formula parity); *structural*
  control params (count/index/window/order/base/flag) → `number`; 1-D data →
  `list`; matrices → `table`; frames → `frame`; type-agnostic/passthrough → `any`.
  The four candidates a first pass flagged (`RoundN.digits`, `Clamp.min`/`max`,
  `MRound.multiple` as `numlist`) are intentional element-wise operands — paired
  with each value through `broadcast()`, same as ArithmeticNode's `b` — NOT
  mismatches. Remaining genuine run-time shape errors (MMULT conformability, etc.)
  stay as `#SHAPE!` and are fine. Connections were already DIRECTIONAL (`canConnect`
  in sockets.ts — widening allowed, narrowing a 2-D `table`/`frame` output into a
  1-D/0-D input blocked at the socket).

- [x] **Personal Finance showcase seed (the big pre-v1 test)** — DONE and under
  ongoing refinement. Lives at `src/graph/seedGraphs/personal-finance.json` (the
  largest seed, ~61 KB), backed by CSV data in `public/data/personal-finance/`
  (transactions / accounts / budgets). Exercises the full pipeline end to end:
  **Import CSV** → frames (Get Column, Add Column, Slicer, Group By) →
  math/stats/finance → **Alerts** monitoring budgets (the Groceries quarterly
  alert is primed to trip). Auto-registers via the `seedGraphs/*.json` glob. Guard
  tests: the generic `seeds.test.ts` loop machine-checks it structurally (every
  node constructs, every connection lands on compatible sockets, group/standoff
  geometry resolves), and `pfSeedCheck.test.ts` checks the CSV data types + that
  the headline aggregates (net worth ~101010, savings rate, per-category spend,
  the over-budget alert) land where the gauges/alerts assume — so it can't
  silently rot.

- [x] **Personal Finance seed lost connections after node reworks** — TRUE root
  cause found + fixed 2026-06-20 (a first pass on this only found a generator
  drift, below; the ACTUAL connection-loss was a socket-rule regression). Symptom:
  "Projected nest egg" showed **-$2000** instead of ~$1.55M. Cause: the polyform
  rework made `ExpressionNode` output the **combo** dim (`numlist`), and
  `canConnect` blocked a combo from narrowing into a strict `number` input — so the
  seed's scalar-math Expression cables into `tvm-fv` / gauges / `cumipmt` (10 of
  them) **silently dropped on load**, the nodes fell back to default literals, and
  `FV` came out negative. **Fix:** a COMBO may narrow into its element SCALAR (a
  combo can BE a scalar) while a plain `list` still can't — one exception in
  `sockets.ts` `SOCKET_ACCEPTS`. **Guard:** `seeds.test.ts` now validates with the
  directional `canConnect` (the real app check), not the laxer symmetric
  `areCompatible` — which is exactly why this slipped through; it immediately caught
  a 2nd pre-existing drop (error-codes `#SHAPE!` demo wired `table→number`, reworked
  to a non-square → `MDETERM`). No seed/generator change needed. See dev-notes.
  - Earlier sub-finding (also fixed): the GENERATOR
    (`scripts/gen-personal-finance-seed.cjs`) had drifted, still emitting the
    deleted `ReduceNode` (→ `AggregateNode`); a generator-lockstep test in
    `pfSeedCheck.test.ts` now guards JSON==generator. Real but separate from the
    -$2000 bug.

## Engagement / showcase features

Fun, draws-people-in surface. The goal is delight + visible life, not just
correctness.

- [x] **Cable Switch** — done (`CableSwitchNode`): several `any` inputs, a
  selector cycling which is live, one `any` output.
- [x] **Text boxes / canvas notes** — done (the **Note** node, `NoteNode.tsx`):
  title + body, movable, color-tinted.
  - [x] **Note hardening pass** — done (2026-06-23). Convergence audit run; the
    divergent-Note surface was found far more converged than feared: the recurring
    offenders below (right-click gate, Tidy super-node, mobile drag, minimap-color)
    are ALL already fixed — the "minimap color now" clause was stale. One real bug
    fixed: the lasso-start gate used a hard-coded node-root class list missing
    `.solenoid-note`/`.solenoid-group` → switched to `area.nodeViews` containment
    (`Canvas.tsx`). Most other audit flags were false positives (socket-less nodes
    carry `{}` outputs; call sites already guard with `?? {}` + truthiness). Author
    declined a centralized `isAnnotationNode` predicate (existing guards are safe).
    See dev-notes 2026-06-23. (Original ask, for context:) Notes keep accruing
    one-off bugs other objects don't — because they're a
    divergent node ROOT (`.solenoid-note`) and a socket-less TYPE, so every subsystem
    that enumerates node roots/types must special-case them and periodically forgets
    (e.g. right-click gate missing `.solenoid-note`; Tidy super-node `342827a`; mobile
    drag `21c90f3`; minimap color now). Not a bug list — a CONVERGENCE audit: find
    every node-root / node-type special-case site (`.solenoid-node`-style DOM gates →
    use `area.nodeViews` containment per CLAUDE.md; `instanceof` switches; Tidy/group/
    minimap/contextmenu/selection/palette), route Notes through the shared path where
    possible, and centralize the unavoidable note-specific handling so new features
    can't silently skip them. Owner likely Agent 1, after `NoteNode.tsx` frees from
    Agent 2's palette commit.
  - [x] **Note frontmatter → typed output sockets** — done (2026-06-23;
    `noteFrontmatter.ts` + `NoteNode`/`NoteNode.tsx`). Parser (YAML subset: scalar,
    flow array, block list) → typed output socket per key; guessed type persisted
    per-key (`fieldTypes`, overridable via a Socket-Legend-glyph picker); fields strip
    renders sockets straddling the note's right edge; reconciles on blur. Forks
    resolved: key-rename drops the cable (pre-alpha-acceptable); socket-layout =
    full-width strip outside the overflow-clipped content, each row a positioning
    context. Deferred: nested map / array-of-maps → table/frame. See dev-notes
    2026-06-23. (Original design notes:) Obsidian-style: YAML frontmatter
    between `---` fences at the top of the note body (markdown body continues below);
    each frontmatter key becomes a typed OUTPUT socket keyed by the key name, so a
    Note becomes a lightweight typed-record / constants source the graph pulls from.
    Type from the value: scalar → number/string/bool/date(serial), YAML array → list,
    nested map / array-of-maps → table/frame (later). Dynamic + direct-edit: editing
    the YAML adds/removes sockets live (the OUTPUT analog of Concat's `ExtensibleInputs`
    — see `NodeSocket.tsx`/`nodeKit`), committing on blur (edit-on-Enter/blur rule).
    `data()` returns each field on its matching output. **Typing model (settled, per
    Obsidian):** GUESS the type once on first encounter, then PERSIST it per-key in the
    note's save JSON (a `key → type` map, alongside the `literals`/`stringLiterals`
    pattern) so changing a value later doesn't silently re-type the socket; a clickable
    type icon on the field overrides the guess (and persists). **Type-picker icons reuse
    the Socket Legend glyphs** (circle scalar / square list / split combo / grid table)
    — one visual vocabulary, so the legend already documents them; only add a legend
    entry if a type-only glyph with no socket equivalent is introduced (e.g. date/bool).
    Remaining forks: (1) key rename = socket-key change → downstream cable drops
    (pre-alpha-acceptable, confirm); (2) socket layout on a free-form resizable note
    body. **Sequencing:** do the Note
    hardening pass FIRST — adding sockets to a still-divergent Note multiplies the
    special-case surface; hardening converges it so sockets build on the shared path.
    Strong tie-in to the relational NORTH STAR (note = record; collect notes → frame).
  - [ ] **Obsidian markdown import/export — bidirectional sync (future, author
    2026-06-23).** Builds on the frontmatter→sockets work above. (1) **Import a `.md`
    file as a Note node** — read an Obsidian markdown file (frontmatter + body) straight
    into a Note, so its YAML keys become typed output sockets; ideally **sync** the
    file (watch / re-read) so editing it in Obsidian flows into the graph. (2) A
    **markdown EXPORT node** — write a Note (or computed record) back out as a `.md`
    file with frontmatter, for round-trip bidirectionality with an Obsidian vault.
    Needs a file path / vault binding + the Tauri fs layer (`fileBridge`); the parse
    (`noteFrontmatter.ts`) + serialize already exist for the in-graph half. North-star
    tie-in: a vault of notes ↔ a frame of records.
- [x] **Image node** — done (2026-06-16, `nodes/annotation.ts` ImageNode): a
  free-floating picture (local file attach or web URL, height field). Add menu →
  Other. Web URLs persist; local files are session-only.
  - [ ] **Image bundling** — embed locally-attached images so they survive save /
    reload. Pure-JSON saves can't carry image bytes without bloat, so this needs a
    bundle format (e.g. a `.zip`/folder of graph JSON + assets, or a sidecar) and
    the local `dataUrl` plumbed into it. Until then a local attach shows "not
    saved"; use a URL to persist.
- [x] **Animated cable state** — done (2026-06-09), CSS flow-bead version with a
  toolbar toggle. Scaling ceiling + the WebGL/canvas upgrade ladder are
  documented in dev-notes TODOs ("Animated cable flow mode").
- [x] **Simple chart library / visual output nodes** — done (`nodes/visual.ts`):
  Sparkline, a wider Chart (line/bar/scatter), a Gauge, and a Heatmap cell, all
  on **recharts**. See CLAUDE.md "Output" / dev-notes (2026-06-14 visual nodes).
- [x] **More Control nodes** — done; the widgets sketched here all exist now:
  **stepper** = the Slider node's ◄/► step-back/step-forward buttons (plus a
  play/pause transport that walks the slider through its range); **toggle/switch
  widget** = `BooleanInputNode` (and `CableSwitchNode` "Input Switch"
  multiplexer); **multi-button picker** = `SegToggle`; **2D pad (XY)** = `XYPadNode`;
  **date picker** = `DatePickerNode`; **colour picker** = `ColorPickerNode`
  (RGB/HSV sliders → CSS colour string, via `colord`). Further widgets are
  add-on work, not a gap.
- [ ] **More node-pack add-ons** — **deferred until after v1 ships.** The pack
  *framework* is done AND there's already a worked example (the **Geometry**
  pack, `docs/dev-notes.md` "Geometry pack"), so the capability is proven.
  Additional domain packs (Electromagnetics from the flux seed, Finance-pro,
  etc.) are post-v1 polish — not needed before launch. Don't build new packs
  this cycle.
- [ ] **New input/output/visual/control nodes — feature set + core-vs-pack split**
  (proposal): `docs/archive/io-visual-control-node-proposal.md`. Surveys the current I/O/
  visual/control nodes against dashboard/BI tools + data-viz literature and
  recommends what's core vs a toggleable pack. Highest-value *core* gaps: KPI/stat
  card (w/ delta), Dropdown + Multi-select, a real Data Table grid view of the
  Frame type, Scatter/Bubble/Histogram, Bullet graph, range slider, date-range.
  Specialist charts (box/candlestick/sankey/choropleth/3-D) → packs, most behind a
  single optional heavy renderer (ECharts/Plotly). First *code* pack (recharts-
  native: Funnel/Treemap/Sunburst/Sankey/Radar) proves the custom-widget pack path.
- [ ] **Excel Timesavers pack — new-node feature set** (proposal):
  `docs/archive/timesavers-pack-proposal.md`. ~35 "no single Excel function" idioms to add to
  the existing Timesavers pack, each tagged by build shape: ~25 are cheap **formula-data**
  pre-set Expression nodes (one JSON file — first real exercise of the formula-pack path
  beyond Geometry, enabled by the Expression engine dispatching to Formula.js), ~8 are
  **custom-logic** (Spell Number, Reverse, duration trio, Split Name, list-reducers like
  Conditional-Aggregate-AND/OR, multi-criteria lookup, last-non-blank, rank-in-group), ~3
  **composites** (Pareto, Join-If, Lookup-all). Several list-reducers are general enough to
  build as **core** Lookup/Aggregation nodes and merely tag into Timesavers.
- [~] **Formula engine — array semantics & adjacent gaps** (scoping):
  `docs/archive/formula-engine-array-semantics.md`. **PARTIALLY DONE 2026-06-21 (A1):** P1 (one
  value-polymorphic `evalAst` core + per-call-site broadcast-vs-aggregate → Expression
  aggregates: `x/SUM(x)`), P2 (range-fn classification — scalar/logical aggregators only;
  array-returning UNIQUE/SORT excluded, FX mishandles 1-D), P5 (in-formula errors tagged:
  `1/0`→`#DIV/0!`, FX errors + non-finite scalars → `SolError`), and the lambda-family
  unification (MAP/BYROW/REDUCE/MAKEARRAY + LAMBDA all route through the one core via
  `compilePositional`) all landed. P4 = loud `#SHAPE!` placeholder. **RESOLVED 2026-06-22:**
  P3 ragged → pad-to-longest with a new first-class `null` (**BUILT 2026-07-02** — broadcasters
  pad with null, paired/index-aligned zips keep min-length deliberately, SortBy/Interleave pad,
  list SORT nulls-last; closed v1.0 audit finding 25); `null` skipped by aggregators, errors
  propagate per-cell (relaxing lists-never-carry-errors); P7 boolean → a first-class logical
  socket type (purple), renders TRUE/FALSE, coerces to 1/0; P4 matrix-into-Expression →
  shape-preserve element-wise + reduce-all aggregate (per-axis stays BYROW/BYCOL); P6 operator
  parity → type-honest (case-insensitive `=`, `#TYPE!` on cross-type ordering, `&` propagates null
  + logicals as TRUE/FALSE, null propagates in arithmetic / unwired-defaults-to-0) + a bundled
  Coalesce/Fill node — **ALL array-semantics policy calls (P3/P4/P6/P7) now settled**. **BUILD
  LANDED 2026-06-22 (Inc 1–8):** value-kind core + reducers + display + producers + logical socket
  family/emission/coercion + Kleene logic + ISNULL + matrix/frame null & per-cell errors +
  `FrameColumn` logical column + persistence (resolved by design, no new format) + the
  Coalesce/Fill node. See dev-notes "Build progress (array-semantics)". **The `any`-socket 1-D→2-D
  pass also LANDED** (corrected): element-agnostic matrix inputs → `anyTableIn` grid; IS-checks
  2-D-aware; `table`/list/scalar → `frame` widening; the "type separation, dimensional flow"
  governing principle + the full-sweep `socketConnect.test.ts` + "Dimensional Flow" seed (see
  subsystem-invariants "Socket lattice"). Remaining polish only: ~~popup-GRID red-badge~~ (SCRAPPED
  2026-06-24 — author fine with the code-as-text look); full N-ary coalesce (currently 2-source List + Else).
  Remaining non-policy item: retiring the now-unused `compileFormula`. See dev-notes 2026-06-21
  "one array-aware evaluation core".
  **SUPERSEDED (2026-06-23): the P4 "matrix-into-Expression" policy is OFF.** Raw `ExpressionNode`
  is capped at scalars + 1-D lists (`expression.ts:147` `#SHAPE!` stands); shape-preserving and
  reduce-all over a 2-D value stay the job of MAP / BYROW / BYCOL / REDUCE, and anything richer is
  the future subgraph node. See the "Formula.js vs native nodes" item below + dev-notes
  "Expression node — scope capped".
  **Second-ring decisions (2026-06-22, dev-notes "Second-ring decisions"):** adopt Kleene
  three-valued logic (Polars-native; null in AND/OR/comparison/IF); logic nodes emit the logical
  type + accept 0/1; **extend `FrameColumn` to carry a `logical` type + per-cell `SolError`**
  (frame layer must catch up to the value model); Filter excludes null-predicate rows, Sort puts
  nulls last; persistence gains logical + per-cell-error serialization.
  `docs/archive/formula-engine-array-semantics.md`. The shared `excelFormula.ts` compiler (behind
  Expression / LAMBDA / MAP / BYROW / REDUCE / formula packs) has no single array model —
  Expression's `broadcastN` can't aggregate a list (`x/SUM(x)` impossible), and the same
  formula text means different things in each host (BYROW already aggregates a row whole,
  proving the fix feasible). Seven clustered problems: (P1) four ad-hoc array conventions over
  one engine → unify into one value-polymorphic core + a mode per host; (P2) range-fn
  classification is broader than scalar aggregators; (P3) ragged-list silent truncation
  (against our ethos); (P4) 2-D inputs mis-broadcast; (P5) in-formula errors (`1/0`,
  `SQRT(-1)`, Formula.js error returns) not tagged as SolError — a hole in the flagship error
  system; (P6) operator semantics diverge from Excel (`=`→`===` case-sensitive, `&`, compares);
  (P7) boolean results collapse to null. Fix is a strict superset for pure element-wise
  formulas. Highest value = P1's unification; P5 closes the error hole; landing P1/P2 converts
  many Timesavers `[C]`/`[M]` reducers into free `[F]` presets. Open decisions in the doc §4.

- [x] **Node arity audit — variadic upgrades** — done 2026-06-23 (`docs/node-arity-audit.md`).
  Fixed-arity nodes whose Excel function is variadic, upgraded via the extensible-input
  pattern: **CHOOSE** (was 4 values → add/remove rows over a fixed `index`), **IFS**
  (was 3 cond/val pairs → any number + an **"Otherwise"** fallback), **SWITCH** (was 3
  when/then pairs → any number between a fixed `expr`/`default`). Infra: generalized
  `ExtensibleInputs` (`leadingKeys`/`valueKeys`) + new `PairedExtensibleInputs`;
  `extractInit` captures `valueKeys` for paired nodes too. Audit KEPT GCD/LCM (binary
  broadcast ≠ N-ary reduce) and SUMPRODUCT (2 lists, low value) fixed; recorded the
  **labeled-slots vs list-input rule** (`docs/node-coverage.md` + CLAUDE.md).
- [x] **Split `LogicalNode` + NOT; align the null/error family** — done 2026-06-23.
  The multi-op `LogicalNode` (IF + booleans, capped at 2 operands) → variadic
  **`BooleanOpNode`** (AND/OR/XOR/NAND/NOR/XNOR, N-ary Kleene reducers) + standalone
  **`NotNode`** (unary flip) + standalone **`IfNode`** (value passthrough, `util` kind).
  **IFERROR/IFNA** rebuilt for real `null` (a missing value is NOT an error; per-cell
  catch via `replaceCaught`; a wired `null` is read by connection-presence). The four
  null/error nodes aligned to ONE notion of error (a tagged `SolError`; `ISERROR`⟺`IFERROR`,
  `NaN` is not an error) with the `#N/A` test centralized as `isNaError`. See
  subsystem-invariants "Error values" (the 2×2). Remaining: ~~popup-grid error red-badge~~ (SCRAPPED
  2026-06-24), full N-ary coalesce.
- [ ] **Formula engine — periodic re-audit (FOLLOW-UP, author flagged 2026-06-25).** The
  consolidation is done, but re-sweep node-vs-Formula.js periodically (the `_sweep`-style harness in
  the git history) when nodes change or Formula.js is upgraded — new divergences (like the MOD/ATAN2
  FX bugs) can appear. Also: distributions are validated only at representative points
  (`distributionFormula.test.ts`); widen the input ranges if accuracy is ever in question.
- [x] **Formula.js vs native nodes — consolidation / one-engine project** — DONE 2026-06-25
  (commits through `baf43ef`; see roadmap v0.9 + dev-notes 2026-06-25 "round 3"). Full sweep of EVERY
  formula-reachable family (not a subset): P5 error mapping shared; dotted names (STDEV.S/NORM.DIST);
  all distributions callable (FX gaps — T family, RT variants, GAMMA — registered as ours); MOD/ATAN2
  FX bugs fixed; domain errors tag #DOMAIN!; date-returning funcs emit our serial; CONVERT → our units;
  cashflow + XLOOKUP/XMATCH range-correct; EXACT → logical; FIND/SEARCH → #VALUE!. Limitations
  established in-app (scalar/1-D only — 2-D via LAMBDA hosts; XLOOKUP advanced modes / complex / matrix
  algebra are node-only). OPTIONAL remainder below (no behavioral effect).
- [ ] **(optional) delete redundant native math for the formulajs-backed families** — the only
  remaining piece of the consolidation: route arithmetic / scalar-math / text / closed-form-finance
  NODES to Formula.js via the seam and delete their hand-rolled math. No correctness impact (audit
  found no divergence), so this is purely code-size / single-source hygiene. `docs/archive/formulajs-vs-native-audit.md`.
  The app runs two parallel function implementations (~150 native nodes + Formula.js via the
  formula engine) — so **a function typed in an Expression/LAMBDA evaluates via Formula.js, NOT
  the matching visual node's `data()`**, and the two can diverge (author re-flagged 2026-06-23).
  Per-family verdict: **safe to consolidate onto Formula.js** (plain arithmetic, scalar math fns,
  text, closed-form finance — delete redundant hand-rolled math); **keep internal** (statistics &
  distributions for numerical correctness, dates for serial/timezone semantics, units/format
  flagship, lookup & matrices/frames where ours is richer, iterative finance solvers). Preconditions
  before any flip: a single `EXCEL_FUNCTIONS` registry (per `dev-notes.md:2175`) that BOTH the
  formula path and the corresponding node resolve through (so a function lives once, with the
  internal exceptions declared in the same place) + Formula.js→`SolError` error mapping (P5 above).
  Resolves the "where do functions live" decision parked in dev-notes. **Interim (shipped
  2026-06-23):** made the divergence EXPLICIT instead of hidden — the formula popup + Expression/
  LAMBDA catalog descriptions now name Formula.js as the engine and note it can differ from the
  nodes (stats/dates/units/errors). **Foundation + first wave (2026-06-23):** `excelFunctions.ts`
  has the `FAMILY_BACKING` policy + the `resolveExcelFunction`/`registerInternal` seam, AND
  `dispatch` is now wired through it with a first wave registered (ROUND / SQRT / STANDARDIZE /
  YEAR / EOMONTH / LEN — a spread of families + output types, each minting a tagged SolError on a
  domain error; `EXCEL_IMPL_META`). **Remaining:** Formula.js→`SolError` mapping for the library
  half; register the rest of the internal families; route the NODES through the same seam (the
  "one impl both paths call" goal); delete redundant native math as each "formulajs" family is
  flipped (guarded by the `*.test.ts` suites).
  **Scope decision (2026-06-23):** `ExpressionNode` is CAPPED permanently at the type-agnostic
  subset — scalars + 1-D lists only, NO matrices/frames (`expression.ts:147` `#SHAPE!` is the
  built half), NO complex (the `[re,im]` pair collides with a 2-element list to the broadcaster +
  needs type-directed arithmetic), NO type-directed semantics. The consolidation above is about
  WHERE the scalar/list impls live, not about widening Expression's reach. Anything beyond the cap
  is the **future subgraph / composite node** (`pack-architecture.md` "Composite pack node"), not a
  new Expression feature. (Closes the "Expression + complex / 2-D" questions — see dev-notes.)
- [x] **Dormant-pack persistence — placeholder + provenance** — done (shipped in 1.0.0:
  `nodes/placeholder.ts` + `persistence.ts` load an unknown type as an inert Placeholder
  that keeps wiring + data and re-serializes as the original type; `SavedGraph.packs`
  carries provenance. The v1.0 audit found this built-but-undocumented — the exact
  checkbox-rot failure CLAUDE.md warns about).

## Frames / data tables

- [x] **Relational / Power-Query verb set (NORTH STAR) — DONE (nodes 2026-06; Polars
  backend merged onto `working` 2026-06-30).** Every verb is a built, registered node:
  Filter / Sort / **Join** (inner/left/right/outer, fan-out) / **Group By** (frame) /
  Append / Distinct / Rename / Select / Drop / Pivot (full PIVOTBY) / Unpivot / Nest /
  Unnest, plus **Frame Lookup** (table XLOOKUP/VLOOKUP) / Split Column / Add Index. The
  pure engine is `frameVerbs.ts` (the JS oracle); on **desktop** the relational verbs
  run in **native Polars** (`src-tauri/src/engine.rs`, 27 cargo parity tests) via the
  `FrameBackend` seam, on web the identical JS backend. The lazy-handle-on-cable finish
  shipped 2026-06-30 (refs chain in the backend; head-N card previews; big-frame render
  caps). Remaining are future scale niceties (lazy-plan fusion, CSV→Polars) + XLOOKUP cube mode.
  Original framing kept below for reference.
  - The set-based table-transform spine that makes Solenoid a visual query tool. "Basic"
  only (no subqueries/CTEs/window-fns). Get/Add Column + Slicer + 1-D Group By +
  Build/Split are the existing fragments. Pairs with the **Cube** (the list-of-frames-with-keys
  type — shipped) and polyform (computed columns). Key challenge is canvas legibility
  (schema preview on cables, per-step row counts) — borrow Alteryx/KNIME/Tableau-Prep.
  - **All five extra verbs decided 2026-06-25** (author). Two distinct axes:
    - **Nest / Unnest** = flat ⟷ nested (Cube), lossless. `Nest Join` (Join+Nest fused)
      ships in v0.9; gaps = standalone **Nest** (group one flat frame by key into cells)
      + **Unnest** (cube → flat joined table, the inverse). `Unnest(NestJoin) = flat join`.
    - **Pivot / Unpivot** = long ⟷ wide reshape, stays flat (pivot aggregates). NOT the
      cube bridge — pivot is reshape, nest is embed (a common conflation).

- [x] **PIVOTBY — full Excel parity (2026-06-29).** DONE — `pivotFrame` rewritten to a
  `PivotSpec`: multiple row/col/value fields (multi-level → composite `"East | A"`
  headers), per-value aggregation function, an expanded function set (PRODUCT / MEDIAN /
  MODE / STDEV.S/P / VAR.S/P + PERCENTOF), row/col **total depth** (grand + nested
  subtotals, top/bottom placement) that **re-aggregates the source** (so an AVERAGE total
  is correct, not the mean of cell means), value- and field-based **sort**, a
  **filter_array** mask, and PERCENTOF via **relativeTo**. Totals live IN the pivot (the
  re-aggregation can't be a generic frame "add a sum row"). Node/UI: `Rows`/`Columns`/
  `Values` CSV list inputs + optional `Filter`, per-value op selectors, totals/sort/
  relativeTo controls (`PivotNode` in `nodes/frame.ts`, `PivotComponent` in
  `FrameNodes.tsx`). Engine + 14 parity tests in `frameVerbs.ts` / `frameVerbs.test.ts`.
  Follow-up: GROUPBY node could expose `total_depth` (engine already supports it via a
  no-colFields pivot); field-headers/field-relationship are N/A (frames are always typed).
  Demo seed: `seedGraphs/pivot-tables.json` (one 36-row Orders source → 8 varied pivots),
  checked end-to-end by `pivotSeed.test.ts`.

- [x] **Cube — v0.9 (author 2026-06-24; "finishes all socket types").** DONE — model + cached
  depth, lattice, producers (Nest Join + Build Cube), cube-aware INDEX, drill-in CubePopup, seed +
  tests. Scope + cross-tool survey: `docs/cube-node-scope.md`. Follow-up (v1.1, not 1.0): the
  **cube-cell** XLOOKUP half (frame XLOOKUP shipped as Frame Lookup); a cube-aware Nest Join for
  multi-level (Customer->Order->LineItem). DECIDED: flat verbs do NOT map over nested cells (Unnest
  → verb → Nest explicitly). A frame's CELLS hold
  ANY value (scalar / list / matrix / another frame/cube) → the universal RECURSIVE container,
  so the socket lattice CLOSES (nothing new is ever needed because anything nests). **Name =
  Cube** (decided); **shape = recursive nesting** (NOT a fixed 3-D panel or multi-frame
  workbook). **Socket icon = a 3-diamond hexagon** (flat/isometric cube — hexagon split into 3
  rhombi for top/left/right faces), a new glyph in `SocketComponent.tsx` (12×12 SVG) + a
  `SocketLegend` row. Subsumes the "list-of-frames" idea (Group By partitions). Touches: value
  model (`FrameCell` widens to any value incl. a nested cube), socket lattice (`sockets.ts` —
  `cube` family, `accepts()` cube = top type), display (a nested cell → drill-in chip). See
  roadmap v0.9 item 4 — likely the biggest of the four, scope it first.
- [x] **Add Column "add-as logical"** (v0.9, small) — DONE 2026-06-25 (`efab1f6`). `AddColumnAddAs`
  gained `logical`: a logical LIST writes into a frame as a logical column (reverse of Get Column
  read-as Logical / Cast Boolean). Closes the logical type's last frame edge. Values input is a
  logicallist; column type `logical`; 4th SegToggle segment fits the existing 200px node.
- [x] **Frame Input is a LITERAL source + universal Source checkbox** — done 2026-06-24. Stores
  the RAW text typed (`FrameSource` `{name,type,cells}`), derives the typed `FrameValue` at
  compute time — never rewrites your input (fixed "1 → TRUE"). `FrameColumn.raw?` carries the
  inputted text (pre-inference); `inferColumn` populates it for every CSV/Web/Import frame; the
  popup's **Source checkbox** shows it on every frame node. **This RESOLVES the date-editing
  follow-up below** (a date column's popup now shows the literal you typed in Source, the
  formatted date in Formatted — no more raw serials). See dev-notes.

- [x] **Get Column read-as is a coercion, not a filter** — done 2026-06-19. Read-as
  Date/Number now parse text cells (a CSV-imported text date column reads as Date
  into serials); shared `parseDateToSerial`. See dev-notes.
- [x] **First-class `date` column type in frames** — done 2026-06-19.
  `FrameColumn.type` now includes `date` (stores serials); `inferColumn`
  conservatively detects ISO date columns on import, FrameDisplay + Get Column
  read-as Text format them, read-as Date is a passthrough, Add Column add-as Date
  stores the type. See dev-notes. ~~Follow-up: the popup shows/edits raw serials~~
  — RESOLVED 2026-06-24 by the literal-source work above (Source shows the date text
  you typed, Formatted shows the formatted date).
- [x] **Text → boolean parse path (logical Cast target + boolean column read-as) — DONE 2026-06-24.**
  A value PARSE at the type boundary (NOT socket coercion — a *known* `string` is still
  blocked from a logical input; you Cast). Built: (1) a `logical` **Cast** target
  ("Boolean") — `CastScalar` carries a boolean, an unparseable value returns the
  existing `NaN` failure sentinel (a boolean is never a number, so `castFailed` reads
  success vs failure unambiguously — no new sentinel needed), unparseable → `#VALUE!`,
  renders TRUE/FALSE. (2) a **Boolean read-as** on Get Column (`GetColumnReadAs` gains
  `logical` → `logicalListOut`) so a logical column reads OUT as a real logical list,
  and a 0/1 or true/false column coerces. Both share ONE liberal parser,
  `coerceLogical` in `valueKinds.ts` (boolean passthrough · case-insensitive TRUE/FALSE ·
  number/numeric-string via the `numberToLogical` 0/1 bridge · else `null`); Cast tags
  the `null` `#VALUE!`, read-as treats it as a lenient missing cell. `inferColumn`
  already auto-detects an all-TRUE/FALSE column as logical. `applyCastTarget` /
  `applyGetColumnReadAs` already route through `retypeOutputCables` so FCs reconcile.
  **Remaining (small, not blocking v0.9):** the reverse direction — Add Column **add-as**
  `logical` (`AddColumnAddAs`) — to write a logical *list* back into a frame as a logical
  column. See dev-notes 2026-06-24 + 2026-06-23 (ISBOOLEAN) for type-vs-coercion.
- [x] **Value-polymorphic formula family ("polyform") — DONE 2026-06-19 (`b018ede`).**
  Expression / MAP / BYROW / BYCOL / REDUCE / MAKEARRAY / LAMBDA now loop ANY
  (Formula.js) function over arrays of any type (`UPPER(name)`, `first & " " & last`,
  `TEXTJOIN` over text columns + index, `DATE`/`EDATE` over dates). Engine widened to
  `unknown`; each producer has a Number/Text/Date/Auto result-type selector that
  swaps the output socket at its dimensionality; mapped inputs are `any`; the
  Lambda Input stays type-agnostic. Brought along the 2-D lattice row (`strtable` /
  `datetable`). Implementation notes + known gaps in `docs/dev-notes.md` ("Polyform"
  entry). (Superseded the "text-aware element-wise op" note below.)

- [x] **Factor sockets into an (element × dimension) lattice — DONE 2026-06-19.**
  Accept-sets are now DERIVED, not hand-written: `FAMILIES` (the element × dim grid)
  + one rule (`DIM_RANK[out] ≤ DIM_RANK[in]`, same family) generates `SOCKET_ACCEPTS`
  at module load (`sockets.ts`). `canConnect`/`areCompatible` build on one directional
  `accepts()` primitive; the old separate `is2DType` narrowing block is gone (narrowing
  is simply absent from every derived set — `is2DType` stays as a public predicate).
  The **Complex family was added as the extensibility test** — a 4th lattice row
  (`complexlist`/`complexcombo`/`complextable`) wired with ZERO accept-set edits;
  it connects identically to number/string/date (socketConnect.test.ts proves it).
  **Both parked policy decisions settled:** (1) a plain `list` input now ACCEPTS a
  scalar (widens to a singleton via `toList`/coerceInputs) — uniform, no exception;
  (2) `table` keeps accepting a list (1×n row) — the rule already yields this. See
  `docs/dev-notes.md` ("(element × dimension) lattice — DERIVED" entry).

- [x] **Make the matrix RESHAPERS element-polymorphic — DONE 2026-06-19 (`f5886b1`),
  via an `anytable` ("Any 2D") socket.** TRANSPOSE, HSTACK, WRAPROWS/WRAPCOLS,
  TOCOL/TOROW, CHOOSEROWS/CHOOSECOLS, Table Info now take an `any` matrix input and
  emit `anytable` (or a 1-D `any` list when flattening), so text/date matrices flow
  through them (MAP → TOCOL → list → Add Column works). Chose the **`anytable`
  wildcard** over the input-socket-mirroring mechanism originally sketched here: it
  keeps the key honesty (2-D, so the narrowing block still applies — `anytable`
  can't drop into a 1-D/0-D input) for a fraction of the machinery. The accepted
  trade-off vs. mirroring: an `anytable` (which might be text) can connect to a
  numeric `table` input (e.g. MMULT) and only fail at runtime — element-type
  precision is lost through a reshape, but dimensional safety is kept. MMULT/
  MINVERSE/MDETERM/MUNIT stay numeric.

- [x] **Ameliorate the `anytable` element-type risk — DONE 2026-06-19, option (a).**
  The numeric matrix ops (MMULT / MDETERM / MINVERSE) now guard at runtime via
  `asNumericMatrix` (matrix.ts): a text/object/`NaN` matrix returns the new
  **`#TYPE!`** error ("needs numbers, but got text") instead of `NaN` soup. `#TYPE!`
  is a Solenoid-specific element-type code (added to errorValue.ts), distinct from
  `#VALUE!` (operand misuse) — the value is wired right, it's just the wrong element
  family; it also carries the design intent that e.g. a number resembling a date
  serial shouldn't silently feed a date op. Element types are homogeneous within a
  matrix, so the guard tests the **first non-blank cell** (O(1), not a full scan) —
  confirmed safe because `toAnyMatrix` keeps matrices homogeneous (a frame
  degenerates to a 1×1, never a mixed grid). Tests in `matrixReshape.test.ts`.
  Options (b) soft connect-time warning and (c) full input→output element mirroring
  were NOT done — (a) captures most of the value for least machinery, as planned.

- [ ] **(MAYBE — decide if worth it) A "list of Tables/Frames" value type.** Idea
  (note from the author, 2026-06-19; "Hyperframe/Hypertable" are placeholder bad
  names): a value that's an arbitrary *list of Tables/Frames*, which you'd pass to
  MAP so instead of the hardcoded 3 operands (x/y/z) it could take a variable
  number of tables. **Open question / likely not worth it:** no clear second use
  case beyond MAP's arity, and the edge cases it'd serve can usually be handled by
  chaining a few MAP nodes — so weigh the type-system + socket complexity against
  that before building. Revisit alongside the value-polymorphic formula work (it's
  the same MAP-inputs surface).
  - **Assistant feedback (2026-06-19, on the merits — effort assumed free):** the
    idea is GOOD, but NOT for the proposed reason. MAP's x/y/z arity is the weak
    case (rarely >3 operands; extensible operand sockets express it more directly).
    The strong case is **split-apply-combine**: a list-of-frames is the natural
    representation of grouped partitions — `Group By key → list of sub-frames →
    arbitrary per-group pipeline → recombine`. Well-precedented (pandas groupby, R
    split(), tidyverse nested frames + map). It unlocks things Solenoid CAN'T do
    today: per-group regression/normalize/top-N (current Group By only aggregates),
    and uniform multi-table/multi-sheet ops ("clean each of these 12 monthly
    tables"). Composes with polyform/subgraph-map (it's the 2-D lift of "list → MAP
    over elements"). The two REAL design questions (not effort): (1) thesis fit — a
    "list of tables" is a data-programming concept, a deliberate step past "Excel
    alternative" toward "visual data tool" (consistent with LAMBDA/packs/polyform);
    (2) **legibility** — a cable of N frames must stay inspectable/previewable and
    the map-over-frames UX must read clearly, or it's an opaque blob (the hard part,
    harder than the type). Verdict: build it AS the foundation for per-group / multi-
    table operations (paired with polyform), NOT as a MAP-arity convenience —
    worth it if per-group analysis is a direction Solenoid should own.

## UX / interaction

- [x] **Actions inside pop-ups — Pin** — done 2026-06-20. The Table/Frame/List,
  Formula, and Chart popups now show a **Pin** button in their header (beside
  Close) that pins the host node's value to the HUD, reflecting the pinned state
  live (accent-filled when on). One shared `PopupPinButton` + a shared
  `pinNodeValue(nodeId)` in `pinStore` (Canvas's right-click Pin now calls the same
  helper — single source of the nodeId→(nodeId,outputKey) resolution). The popups
  learn their host node id from `NodeFormatContext` (moved to `components/
  nodeContext.ts` + a `useHostNodeId()` hook) — the value chips / chart-expand
  button tag the popup with it. The chips also take an explicit `pinNodeId` prop so
  a collapsed-group readout pins its member node; only the HUD chips (already
  pinned) render without a Pin button. The
  "+ more" actions noted originally (copy-as / export / "go to node") are NOT done;
  Copy already exists in TablePopup. Follow-up below.
  - [ ] **Pop-up actions — the rest of "+ more".** Export, "go to node" (pan/select
    the host on the canvas), copy-as variants. Lower value than Pin; do if wanted.

- [x] **Cinematic load reveal — DONE 2026-06-19.** Load no longer pops nodes in
  one-by-one. Startup + File→Open build behind an accurate progress-bar overlay
  (`LoadOverlay`), then fade nodes in wave-by-wave in input→output order while
  drawing each node's incoming cables on (output→input), computing results LAST.
  Doc switches / seed loads snap (author's scope call). `loadReveal.ts` (store +
  `revealWaves` layering), orchestration in `persistence.ts` `rebuildGraph(…,
  animate)`. See dev-notes "Cinematic load reveal".
  - [x] **Manual reload trigger — DONE 2026-06-21.** Browser reload doesn't replay
    the cinematic, so `documentStore.reloadCurrent()` does a genuine reload (capture →
    `showCurrent(true)`, full rebuild) which replays the build→reveal. File → "Reload
    document" + the deliberate combo Ctrl+Shift+L (no stray single-letter key).

- [x] **Delete-without-relink modifier — SCRAPPED 2026-06-19 (author).** The
  auto-relink-on-delete default is fine as-is; an explicit break-the-chain
  modifier isn't wanted. Multi-in / multi-out nodes already delete without relink
  (ambiguous rewire). Left here for decision history; not building it.

- [ ] **Pinch-zoom on trackpad** — the canvas zooms on Ctrl+scroll
  (Figma convention). macOS trackpad pinch should also zoom; the OS
  sets `e.ctrlKey` on pinch wheel events, which the rete area
  plugin's zoom handler should honour. Verify on real Mac hardware;
  if it doesn't work, intercept the wheel event manually.

- [x] **Tidy / Cleanup are standoff-unaware — DONE 2026-06-19.** Layout ops now
  treat standoff-connected nodes as RIGID BLOCKS: `solveStandoffs({ forceLock })`
  + `standoffClusters()` wired through expand push (a cluster moves as one block —
  every member gets the cluster's largest push), collapse, autofit, and Tidy —
  which lays each loose cluster out as a single ELK super-node (leader sized to the
  cluster bbox so ELK reserves room, leader's real size restored after; works on
  group↔note pairs). Drag chain-pull stays band-only. See subsystem-invariants
  "Standoffs". Remaining: a deeper edge-case sweep on heavy-overlap cases (deferred).

## Conduit / Cable follow-ups

(The items below originally targeted the two-arm bundler, since renamed
**Manifold** and deprecated to load-only. Done/moot items from that era:
mid-lane gap compaction, handle hit-area chrome, and intermediate-angle
cable curves — the last solved properly by `cableAngleStore` +
angle-exact routing in all three shape modes.)

- [x] **Per-lane ghost cables on Conduit delete — DONE (`5c89658`).** `conduitGhostSpecs`
  pairs in_i→out_i and the `node instanceof ConduitNode` branch in `Canvas.tsx` `deleteSelected`
  splices a ghost per lane (skipping missing ends, self-loops, dups); also covers a 1-lane
  Conduit. Verified against the code 2026-06-21.
- [x] **Keyboard angle bumps** — done 2026-06-20, and generalised. `[` / `]`
  rotate whatever rotatable thing is selected: Conduit(s) by the 45° quantum,
  Angle Dial node(s) by each node's own `step`, and a selected Standoff's axis by
  45° (mirrors the inspector dial). New `ConduitNode.rotateBy`; the Conduit now
  derives its angle from `node.angle` + a `conduitAngleStore` version bump so an
  out-of-React-root rotate re-renders it; unified `rotateSelection(dir)` in
  Canvas keydown. See dev-notes. Arrow-key position nudge — done 2026-06-20 too
  (arrows = 1 grid cell, Shift = 4; selected groups carry members, standoff
  clusters move rigidly, docked FCs follow, undoable). Tab navigation still
  deferred (no natural order on a free canvas — see the dev-notes "Arrows / Tab"
  reasoning).
## Cable collision avoidance (deferred from the original routing spec)

The shape system shipped (walk router + tangent-exact spline; see
CLAUDE.md "Cable rendering knobs"). Still future, from
`docs/cable-routing.md` §2:

- [ ] **Avoid nodes** — cables route around node bounding boxes.
- [ ] **Avoid cables** — parallel runs + bridge hops at crossings.
- [ ] **Per-cable shape / avoidance overrides** (graph-wide today).

## Grid system

- [ ] Implement the design spec in `docs/grid-system.md`. Soft grid
  alignment (not forced snap) across node placement, alignment
  helpers, note/group corners. Primary grid + sub-grid +
  modifier-to-bypass. Note: cable shapes shipped grid-free (the walk
  router keys off socket positions, not grid lines) — gridding the
  cables is a separate, real design question (see the doc's banner).

## Visual design / theming

- [x] Accent-color theming — done. A full swatch palette (appThemeStore) drives
  `--accent*` CSS vars live; the accent picker is in the appbar.
- [x] Light mode — done. `:root[data-theme="light"]` ramp in App.css, toggled
  from the appbar.
- [x] Stored colors as palette SLOT ids, not frozen hexes — done (2026-06-20).
  `palette.ts` `PALETTE` (slot→hex) is the single source of truth; Notes/Groups/
  app-accent store opaque slot ids resolved via `resolveColor`. Fixes the drift bug
  (retuned accents left old saved hexes stale) and is the storage foundation for the
  item below.
- [x] **App palette switcher (2026-06-20).** Settings ▸ Appearance picks among
  built-in palettes (Default / Muted / Colorblind-safe); `paletteStore` holds the
  active base, persisted to localStorage, retinting the whole app (incl. node-kind
  headers). Node-kind accents DO follow the palette (resolved a question left open
  in the prior entry).
- [x] **Per-document palette overrides (2026-06-20).** `SavedGraph.palette`
  (`{ base?, overrides? }`) round-trips a doc's own palette declaration, layered over
  the app base. JSON/seed-authored (no editor UI — author's call).
- [x] **Socket colors built from the palette (2026-06-20).** Scalar `--sock-*` vars
  draw from palette slots (`SOCKET_SCALAR_SLOTS`); Default palette backfit to the
  liked socket hexes; appTheme live-drives sockets on non-Default palettes.
- [x] **Derive socket array/matrix siblings from the palette too (2026-06-20).** Done:
  `SOCKET_VARS` derives every `--sock-*` from its slot (scalar / ×0.8 array / HSL-shift
  matrix); App.css `--sock` defs removed. Whole socket family follows a palette switch.
  (string array slightly brighter + light-mode shifts off old bespoke values — author
  accepted going fully programmatic.)
- [ ] **Palette override editor UI (deferred).** A surface to edit the open doc's
  per-slot overrides (and maybe author/save custom named palettes) from inside the
  app, instead of hand-editing JSON. The store + persistence already support it; this
  is just UI.
- [x] **Revisit the Colorblind-safe palette with an OUTSIDE palette** — done
  (`palette.ts` `COLORBLIND`). Re-derived from the established **Okabe–Ito** 8-colour
  CVD-safe qualitative set rather than the home-grown optimizer: the 8 socket slots each
  take a unique Okabe–Ito colour, remaining slots double up (Okabe–Ito has no neutral, so
  gray keeps `#999999`). Replaces the prior self-optimized ΔE/Machado-2009 version.
  Muted palette is still first-pass (separate, lower priority).

## Customizability (general)

- [ ] **Moveable / resizable / hideable UI chrome.** User flagged
  this as a high-value direction:
    * Minimap corner choice (TL / TR / BL / BR)
    * Resize panels (minimap, future inspector, future toolbar)
    * Hide individual chrome elements entirely
    * Same principle should apply to anything we add later
      (command palette, sidebar, console, etc.)
  Probably warrants a dedicated `docs/customization.md` once a second
  customization request lands; for now, treat this as a principle to
  honour every time we add chrome.

## Visual polish (need eyes on a real build)

- [x] ~~**Popup GRID red-badge for an error cell**~~ — **SCRAPPED 2026-06-24.** Author: "I don't mind
  the look, doesn't need diff visuals." The grid showing an error cell as plain `#DIV/0!` text (not a
  red badge) is acceptable. (The genuinely-broken inconsistency nearby — list ÷0 producing `#N/A`
  instead of `#DIV/0!` — WAS fixed: `ArithmeticNode` now tags per-cell `#DIV/0!` via `broadcastErr`.)
- [ ] **Collapsed mini-preview for pure-visual nodes** (surfaced 2026-06-22). Chart / Gauge / Slicer /
  Sparkline / Heatmap are now `collapsible={false}` (collapsing them to "—"/blank was pointless). A
  richer collapsed form — a thumbnail chart, or the passed-through value — would let them collapse
  meaningfully instead of just opting out.
- [x] **Finish the verbose-copy ("claudetext") pass** — done 2026-06-23. Second pass trimmed the two
  clearest remaining offenders (Coalesce/Fill, Image) and confirmed the rest of the >150-char
  descriptions are dense reference info (lambda variable bindings, base-convert caveats, multi-fn
  IS-check), not bloat — a `grep` for bloat-tells ("allows you to", "simply", "powerful", "in other
  words") over every node description came back empty. Also fixed 5 mojibake em-dashes (`â€"` → `—`) in
  `finance.ts` descriptions (DDB/VDB/RATE/IRR/MIRR), and swept the stale **Reduce → Aggregate** rename
  through the FR Notes column + EXCEL_GAP composition notes (`nodeExcel.ts`). The big iteration this
  session was the **help/reference docs** — see dev-notes 2026-06-23.

- [x] **Right-side overlay chrome: less shadow, thicker borders** — done
  2026-06-20, author-tuned. New `--overlay-border-width` token (App.css base
  `:root`, theme-agnostic) = **2px**; every `--overlay-border` consumer now reads
  its width from it (was a hardcoded `1px` per site). `--overlay-shadow` softened in
  both ramps (blur 26→14, y 8→4, opacity ~⅓ down). Lifts all overlay chrome together
  — Minimap, SocketLegend (+ launcher), pinLayer (+ chips), alertLayer (+ chips),
  LoadOverlay. See dev-notes "Overlay chrome: thicker border, lighter shadow".

- [x] **Icon/glyph buttons misaligned — done 2026-06-20 (two root causes).**
  (1) The `×`/`✕` GLYPH close/remove buttons rode the text baseline → flex-centered
  `.sol-popup__close`, `.fr-close`, `.solenoid-outline__collapse`,
  `.solenoid-pin__remove`. (2) The real systematic one: **odd-sized SVG icons
  (15/13/11px) centered in even buttons land on a half-pixel** (`(26−15)/2 = 6.5`),
  which blurs and shifts as you zoom the browser. Rounded every icon to EVEN
  (`AppToolbar`/`NavMenu`/`TopBar`/`OutlinePanel`), fixed the nav-pill divider
  (layout `border-left` → non-layout inset shadow), removed the old `translateX(1px)`
  nudge. Verified with puppeteer: integer gaps, dx/dy=0. Rule now in CLAUDE.md
  + dev-notes. Residual: a couple of *asymmetric* glyphs (lock bottom-heavy,
  sparkle satellite) read optically off — art-balance follow-up, see next item.

- [~] **Optically center asymmetric icons.** Not a pixel bug — these glyphs are
  geometrically centered but their visual mass isn't. Fix by shifting the
  path/viewBox so the ink centroid sits at the viewBox center (measure via canvas
  rasterization centroid — see dev-notes 2026-06-20). DONE: pushpin (`PinSvg` ×2,
  viewBox `0 -1.4 24 24`), and all close buttons now use the symmetric SVG
  `CloseIcon` instead of a text `×`/`✕`. STILL OPEN: the canvas-lock toggle (solid
  body reads low) and the Cable-flourish sparkle (big star + satellite reads
  unbalanced — decorative, author's eye needed). Note: HUD pin/alert buttons also
  jitter ±1px on browser zoom, but that's `position: fixed` device-px rounding, not
  the icon — not fixable via centering.

- [x] **Close buttons use a shared SVG `×` (`CloseIcon`) — done 2026-06-20.** A text
  `×`/`✕` glyph's ink isn't centered on its em, so flex-centering left every close
  button reading low. `components/CloseIcon.tsx` (symmetric SVG) now backs all 7:
  popup Chart/Formula/Table close, fr-close, outline collapse, pin remove, alert
  dismiss. Alert HUD trigger/chip icons evened (13→14); context-menu icon slot is a
  fixed 16px flex box so text-glyph + SVG icons share one column.

- [x] Arithmetic handle alignment — superseded: socket vertical placement
  is now measured per-row (`MeasuredSocketRow`), no hardcoded offsets
  anywhere (see CLAUDE.md).
- [x] Native `<select>` op dropdown styling — addressed: `OpSelect` styles
  the closed control with theme tokens + a custom chevron; the OS-rendered
  open list is accepted (and needs the pointerdown-stopPropagation rule).

## Format Controller

**Milestone split (2026-06-24, updated 2026-06-25, see `roadmap.md`):** the FC
*architectural* items below — passthrough-INPUTS (IF/CHOOSE carry units; DONE), the
movement-functions docked-FC pass, upstream multi-hop annotation, the popup
formatted/source toggle (DONE) — are **v0.9**. The FC *visual/layout* redesign, `SegToggle`
unification, **and the function model** (author moved it to 1.1, 2026-06-25) are **v1.1**.

- [ ] **BUG (1.1): navigator group rows are blown out — solid full-strength accent, not
  matching the canvas (author 2026-07-01).** `OutlinePanel.tsx` paints a group row
  `background: r.color` (`:465`) — the raw accent at FULL opacity as a solid bar. On canvas a
  group's large area is a translucent tint (`GroupNode.tsx:352,445` `background: hexToRgba(color,
  fillAlpha)`); only the thin header is full-strength. So the row reads oversaturated/overbright
  vs the muted group the user sees. Fix: tint the group row like the canvas body (a low-alpha
  `hexToRgba(color, fillAlpha)` over the panel bg, accent as a border/label, not a solid fill).
  Also verify `colorOf` (`:44`) resolves the palette SLOT (`resolveColor`) the same way GroupNode
  does (`resolveColor(node.color)`, `:238`) — it currently passes `node.color` straight to
  `themeAccent`; if group colors are stored as slot ids, that path is also wrong.
- [ ] **BUG: FCs randomly mis-dock to a Note with frontmatter outputs, on load/switch
  (author 2026-06-25; hard to reproduce — random).** Symptom: opening / switching to a graph,
  FCs "from other chains" drift to / attach to a Note node that exports frontmatter inputs.
  Investigation done 2026-06-25 (ruled OUT, don't re-chase these): (a) ID collision — rete IDs are
  64-bit `crypto` random, so a stale/unremapped `hostNodeId` can't match the Note's; (b) cross-graph
  singleton contamination — `noderemoved` undocks, so `dockedNodeStore` is emptied on switch; (c)
  load-time proximity re-docking — `findDockTarget` runs ONLY on a deliberate FC drag (`nodedragged`),
  never on load. On load an FC's dock comes solely from its saved `hostNodeId` remapped through the
  id-map (`persistence.ts:395`), so a wrong dock must be PERSISTED, not invented at load. **Leading
  hypothesis:** `findDockTarget` snaps an FC to one of the Note's many frontmatter output sockets
  during editing — its `DOCK_SNAP_PX=34` threshold is in SCREEN px, so when zoomed OUT it covers a
  large canvas area and the globally-nearest socket can be a far-away Note (which has a tall stack of
  output dots). That gets saved and shows on reload. **Also found (ordering smell, probably harmless
  but worth fixing): `nodecreated` calls `dockSelf()` (`Canvas.tsx:2249`) on every FC BEFORE
  persistence remaps `hostNodeId` (line 395), so each FC docks twice on load — once with a stale id.
  Guard it with `!isGraphRebuilding()` (persistence's own `dockSelf` at line 425 handles the rebuild
  case post-remap).** **Diagnostic to run first:** open an affected graph's saved JSON, find a
  wrongly-docked FC, and check whether its `init.hostNodeId` equals the Note's `id` — confirms
  persisted-wrong (→ fix `findDockTarget`: make the snap radius zoom-aware / canvas-unit, prefer a host
  the FC is actually adjacent to) vs a load render transient. `Canvas.tsx` `findDockTarget` /
  `getSocketScreenCenter`, `dockedNodeStore`, `persistence.ts` remap+dockSelf.

- [x] **Locked format/unit propagates to downstream passthroughs (no trailing FC
  needed)** — done 2026-06-23. An FC LOCKS its format+unit onto the value; it now
  rides through every passthrough box (Display today) and shows there without that
  box needing its own trailing FC, breaking only at a transformative node.
  `unitFlow.makeAnnotationResolver` (FC locks → passthrough carries → transform
  drops; Convert is a unit transform so it drops the format); `DisplayNode` falls
  back to the resolved inbound annotation; the Note's output field renders the FC
  annotation an upstream FC writes onto it (the upstream half). See dev-notes
  2026-06-23 + subsystem-invariants. **Remaining:** (a) DONE 2026-06-25 — UPSTREAM
  multi-hop: a Display two hops ABOVE the FC (`Number→Disp1→Disp2→FC`) now shows the
  lock on Disp1, not just the immediate box-behind. Implemented as bidirectional
  segment resolution — `makeAnnotationResolver.downstreamAnnotation` walks FORWARD
  from a box through pure passthroughs (`passesUnitThrough`, i.e. Displays) to an FC
  ahead and returns its lock; `DisplayNode` consults it after the upstream
  `inAnnotation`. Stops at any transform/selector/Convert (the value changes there).
  Read-side only (no extra store writes → no FC-clobber). See dev-notes 2026-06-25.
  (b) See the passthrough-INPUTS item below.
- [x] **Designate node INPUTS as passthrough vs transformative** — DONE 2026-06-25
  (`b025d26` + `80dd70a`). A unit/format lock survives a node that merely SELECTS/routes a value:
  IF / CHOOSE / SWITCH / IFS now declare their value-branch inputs via `unitPassInputs()` and, crucially,
  are **data-aware** — each records the branch it actually returns (`_selectedUnitKey` → `selectedUnitInput()`),
  so the output carries THAT branch's unit (IF(true, km, mi) is km). `unitFlow` follows the selected branch;
  it only falls back to combining the branches when the selection is indeterminate (a LIST condition picking
  per-element). The condition / selector / `when` keys are excluded. See dev-notes 2026-06-25.
- [x] **Passthrough/selector nodes format their OWN value box** — DONE 2026-06-25. A node's value box
  (`ValueDisplay`) read only a DIRECT annotation, so an `IF`/CHOOSE/… that carries a locked unit showed a
  bare value while the downstream Display showed it formatted. `ValueDisplay` now falls back to the resolver's
  `outAnnotation`, gated to passthrough/selector nodes (sources/transforms stay raw, skip the walk). See
  dev-notes 2026-06-25.
- [x] **"Unit Flow" seed** — DONE 2026-06-25. `seedGraphs/unit-flow.json` (auto-registers): five labeled
  lanes demoing downstream carry, upstream multi-hop, transform-break, Convert forwarding, and selector
  pass-through. `unitFlowSeed.test.ts` asserts each captioned behavior with the real node classes.

- [ ] **Units by dimensionality — the unit/type architecture (flagship vision, author 2026-06-25).**
  Author: "unit carrying and data-type segregation are some of the biggest value adds of this project."
  The model, keyed to the dimensional ladder:
  - **Matrix → unit-AGNOSTIC, always** (pure numbers). A matrix IS a numeric frame stripped of its
    headers + formatting, so it carries no units by definition.
  - **List → units, PER ELEMENT.** A list is conceptually a ROW (`[3 km, 5 mi, 2 km]`), so each element
    can carry its own unit — the same way the array-semantics model already carries per-cell `null` +
    `SolError` (`valueKinds.ts`). A unit becomes a per-cell tag, not a per-value one.
  - **Frame → units PER COLUMN** (one unit per column — already the direction of "FCs on frame columns").
    Since a frame ROW is a list, per-column frame units == the per-element units of any row pulled out.
  - **Missing piece (can be later, part of the FC upgrade): FCs assign units to STRING-LIST elements used
    as HEADER KEYS.** An FC can put a unit on a header string; building a frame from that header list then
    LOCKS each column to its header's unit.
  - **Worked example (the target UX):** build an Orders header list `[id (none), Item (none), Revenue
    ($0.00)]` (a string list where "Revenue" carries `$0.00` via an FC), then feed it to Build Frame /
    Add Column with revenue values `[5, 6, 7]` → those are FORCIBLY formatted to `[$5.00, $6.00, $7.00]`,
    and the per-column FC inside the resulting Frame popup is LOCKED by the header list's unit.

  Touches: the value model (a list element / header gains an optional unit tag — define the
  representation: a parallel unit array? a tagged cell? — matrices opt OUT), `unitFlow` (propagate
  per-element / per-column units; passthrough/transform rules apply per cell; Build Frame/Add Column pull
  the unit from the header), FC + display (render mixed unit suffixes; the FC popup edits a list/column's
  units; an FC can target a string-list header key), aggregators (SUM over mixed units → convert or
  `#TYPE!`, like element-family separation already does), and the socket lattice (units are the
  finer-grained sibling of the element-family separation it already enforces). Independent of future
  dimensionality math (mph) — carrying mixed units through selection/filter/reshape/frame-build is
  valuable on its own. Big — its own milestone; design the per-cell/per-column unit representation first.

- [ ] **FC handling needs another pass across ALL movement functions** (noted
  2026-06-19, author) — **docked FCs especially.** Push / expand / collapse /
  autofit / tidy / drag each reposition nodes, and a docked FC has to ride along
  with its host and re-snap; the coverage is uneven (e.g. tidy already reserves
  the docked footprint + re-snaps in a deferred rAF, but other ops are less
  careful). Audit each movement op for docked-FC correctness the way the
  standoff-cluster pass just did for standoffs. See `repositionDockedTo`,
  `dockedNodeStore`, `realHostSize`/footprint logic in `Canvas.tsx`.

- [ ] **The function model (v1.1, author 2026-06-25).** Pin down ONE coherent definition of
  how an FC decides what to render, across every axis it controls at once — replacing today's
  per-style ad-hoc logic on `FormatAnnotation`. The axes that must compose:
  - **precision** — `decimalDigits` × `decimalMode` (`"places"` fixed decimals vs `"sig"` significant
    figures): one resolution rule for how it interacts with each format style (sig-figs on `percent`,
    `scientific`, `fraction`).
  - **format style** — `FormatStyle` (`auto | decimal | integer | percent | fraction | fraction_adv |
    scientific`) + `customPattern`.
  - **unit** — `unit`/`customUnit`, a SEPARATE axis applied after the numeric format (currency is a
    unit, not a format); must coexist with every style.
  - **value type** — the same FC can sit on number / date / text / logical; the model defines which
    controls light up vs no-op per incoming type (sig-figs meaningless on a date; `textCase` meaningless
    on a number).
  Deliverable is the spec FIRST (a truth table: which controls apply per value-type + the
  precision×style resolution rule), THEN the FC-redesign code. `formatAnnotationStore.ts` (`FormatAnnotation`,
  `FormatStyle`), the FC popup, the value renderers. Pairs with the SegToggle/visual redesign below.
- [ ] **FC expansion + SegToggle unification.** The FC is slated for a redesign /
  expansion (function + layout). When that happens, route its places/sig-figs
  toggle (and any new toggles) through the shared `SegToggle` component so there's
  one segmented-button definition. For now the FC keeps its own inline-row variant
  (`.solenoid-fc__seg` / `__segbtn`); `SegToggle` (Get Column / Add Column read-as)
  is the standalone full-width form with the same look.

- [x] **Popup "view formatted / view source" toggle** — DONE (in `TablePopup.tsx`:
  `displayMode` "formatted"/"source" + `showFmtToggle`). The list/table/frame popup offers a
  Formatted/Source toggle: a date column shows readable dates (`2026-01-03`) in Formatted mode and
  its raw serials in Source; a literal-source editor (Frame Input) edits raw text in Source and shows
  the derived render in Formatted. Resolves the "popup shows raw serials for date lists/tables" gap
  and the Frame Input literal-source editing. (Per-column FC *styling* form — numbers→percentages —
  is the separate v1.1 FC visual work.)

## Packs / pure-formula nodes & subgraphs

Design lives in [pack-architecture.md](pack-architecture.md): the simple
vs composite (subgraph) node shape, the locked-to-user / open-to-author
roles, per-port promotion (exposure + tier + default), input
restrictions, errors, and the "keep it legible" governing constraint.
Actionable follow-ups parked here:

- [ ] **Variant switch reconciles the socket set.** A simple pack's
  variant dropdown switches between similar formulas with different
  variables, so switching must add/remove input sockets and preserve
  cables on variables shared across variants. Reuse the Expression
  node's socket re-derivation rather than new machinery.
- [ ] **Aliasing — many internal ports → one shell parameter.** The
  stats example wants one promoted "confidence level" feeding several
  internal nodes, not N identical ports. Decide v1 vs fast-follow —
  the difference between a clean and a cluttered advanced panel.
- [x] **Typed error values** (`#CODE!`) as a foundation — DONE
  (`errorValue.ts`). Tagged `SolError` values flow + propagate + render the
  red badge; a 13-code set (more specific than Excel's seven; `#TYPE!` added
  2026-06-19 for element-family mismatches). The producer
  sweep (2026-06-15) converted the genuine-error null/NaN sites across
  finance / scalar / stats / convert / cast / text / matrix / list, plus
  engine-level `#CIRC!` cycle detection. See CLAUDE.md "Error values" and the
  `error-codes` showcase seed.
- [ ] **Error UX on restriction violation** — typed error out the
  socket vs. the node flagging the offending input locally. PENDING.

## External data / connections

Shipped: the shared connection layer (`connectionStore` — cached async fetch +
refresh) and the **Web Source** node (URL → numeric CSV/JSON Frame), under Input.
Future node types ride the same layer:

- [x] **CSV-folder connection (phase 2)** — done. The **CSV File** node reads a
  `.csv` from a Settings-configured target folder (Tauri `fs` + `dialog` plugins,
  folder-picker setting). Desktop only.
- [x] **Tauri HTTP for Web Source (CORS unlock)** — DONE (`httpBridge.ts`
  `fetchText()`): routes through `@tauri-apps/plugin-http` on desktop, falls back to
  `window.fetch` (with a `CorsLikelyError`) on web. Consumed by `nodes/connection.ts`.
- [x] **IMPORTHTML-style node** — done (`ImportHtmlNode`, `nodeCatalog.ts` →
  Import HTML). Grabs the Nth HTML table on a page as a Frame, columns
  auto-typed; stores the URL, refresh re-pulls. Desktop any URL / browser
  CORS-only (via `httpBridge.ts`).
- [x] **IMPORTXML-style node** — done (`ImportXmlNode`, → Import XML). Extracts
  a page's XPath matches (e.g. `//h2/a`) as a text list; URL-stored, refreshable;
  same desktop/CORS reach as Import HTML.
- [ ] **Finance connection** (GOOGLEFINANCE-ish). A thin Web Source preset over a
  chosen finance API (current quote + historical table). Brings API-key + rate-
  limit baggage; do only if wanted. Google's own backend isn't reusable.
- [x] **Quoted-CSV parsing** — done, then upgraded to a real library. `csv.ts`
  (`parseCsvRows` / `parseCsvLine`) now wraps **Papa Parse** behind a small
  synchronous `string[][]` interface, replacing the four bare `split(",")` sites
  (Table Input, Frame Input, the CSV popup, the Web Source / CSV File
  connection). This buys full RFC-4180: embedded commas, doubled-quote escapes,
  quoted fields spanning physical lines, BOM stripping, mixed CRLF/LF. The CSV
  popup already *wrote* quoted fields (`csvField`) but read them back unquoted —
  that round-trip is closed. File ingestion (`csvToFrame`) opts into delimiter
  auto-detection (`{ detectDelimiter: true }`) so semicolon/tab exports load; the
  in-app comma editors stay comma-pinned and deterministic. (Decimal-comma
  *number* parsing — `1,5` meaning 1.5 — is **decided against**: Solenoid is
  en-US-numeric and won't support decimal-comma locales. A comma-decimal cell
  parses to N/A, which is the intended behavior, not a bug. Delimiter detection
  is orthogonal — it splits semicolon/tab files; it does not reinterpret
  numbers.)

## Performance

- [~] **Graph load time isn't instant** — investigated 2026-06-16. The dominant
  cost was the **per-connection recompute** in Canvas's `connectioncreated` pipe:
  `rebuildGraph` adds every connection one at a time, and the pipe ran a full
  `processGraph()` (engine reset + re-fetch every node + `area.update` every
  node) **plus** `syncGroupCollapse` on *each* one — O(connections × nodes), all
  of it redone once at the end of `rebuildGraph` anyway. Fixed by gating those
  two passes behind `!isGraphRebuilding()` (the load already runs them once at
  the end). **2026-06-17 follow-up:** the same gate now also wraps the rest of the
  per-event settle that was still firing during rebuild — the `connectioncreated`/
  `connectionremoved` Convert-arrow sweep, the FC adapt/refresh sweep,
  `bumpConnectionVersion`, `rescanMismatches`, and the `noderemoved`
  `rebuildGroupMembership` + `syncGroupCollapse` + `restoreSettledPushes`. On a
  FC-heavy graph (Personal Finance: 18 FCs, 123 cables, 129 nodes) those were
  O(events × nodes) and dominated **clearing** the graph too, which is why
  deleting the open document (it reloads the next via `rebuildGraph`, which first
  clears the current) took noticeable time. All are redone once at the end of
  `rebuildGraph` (membership, collapse, dockSelf+refreshAnnotation, syncUnitArrows,
  and a final `processGraph` whose `cableValueStore.bump` re-renders cables).
  **DONE 2026-06-24 (perf arc):** the sequential build loop is now `Promise.all`
  (B1) and the final `processGraph` render-all is de-serialized (B2). Also landed:
  **targeted recompute** — `processGraph(changedNodeId?)` resets + renders only the
  edited node's downstream cone (A1/A2/A3), and the paste / bulk-delete / undo-redo
  **O(N²) hangs** (per-item connectioncreated/noderemoved settle) are gated. The
  double-RAF docked-FC settle and `zoomAt` are one-shot and minor. **Full arc +
  the definitive pan/zoom verdict (it's at the renderer floor; only a canvas/WebGL
  swap moves it): `docs/performance-hardening.md`.**

- [ ] **Custom WebGPU/wgpu renderer** — **SUPERSEDED as the zoom-at-scale lever (2026-06-27):**
  HTML-in-Canvas (`ctx.drawElementImage`) shipped as that lever instead (perf-validated, feature-gated,
  DOM fallback). The WGSL/Pixi work below was BUILT then PARKED (console-only `"canvas"` mode), not a
  live 1.0 track. Kept for the record / a future native-GPU escape hatch.
  deferred, greenlight-when-blocking. **Target = WebGPU (TS, in the Tauri webview) +
  WebGL2 fallback, hybrid (GPU geometry + DOM only for the active node).** Desktop-primary
  doesn't change it (Tauri is still a webview → same DOM floor); not raw Vulkan/DX12 — you'd
  write to `wgpu`/WebGPU regardless, and that lifts to native later if ever needed.
  The 2026-06-24 perf arc proved dense-graph zoom
  is at the DOM/rete renderer floor: content reduction AND render-resolution scaling
  were both measured negligible, so the cost is compositing the ~5k-element layer
  structure, which no CSS/content/transform trick touches (DOM has no
  render-resolution knob — only canvas/WebGL does). Scope: rete v2 is modular — replace
  the **render + area** plugins (~21 plugin-coupled files) while keeping `NodeEditor` +
  `ClassicPreset` node model, `DataflowEngine`, and ALL domain logic. Bounded but major
  (reimplement socket layout, cable drawing, pan/zoom, selection, drag; rehost node
  components off rete's render contract). Pairs with Phase-2 Polars/Tauri. Only worth
  it when zoom-at-scale is a real blocker, not a stress-test annoyance. **Plan FINALIZED
  2026-06-24 in `docs/archive/renderer-plan.md`** — feature-gated enhancement
  (DOM stays the universal fallback; WebGL2 is flaky in Tauri's Linux WebKitGTK webview +
  WebGPU absent there, so never a hard replacement), per-platform GPU matrix, phased
  outline (cables→canvas first). Reasoning: `docs/performance-hardening.md` "FINAL VERDICT".
  - [x] **Phase 0 — de-risk harness** — done (2026-06-25): render-mode store
    (`renderMode.ts`, persisted dom|canvas, default dom), GPU probe (`gpuProbe.ts`,
    WebGPU non-fallback → WebGL2 non-software → else DOM), transform-mirror overlay
    (`overlayTransform.ts` + `components/RenderOverlay.tsx`). No visual change.
  - [x] **2D-canvas cable attempt — MEASURED NET-NEGATIVE, replaced** (2026-06-25). The
    first cut used `CanvasRenderingContext2D` (re-strokes every bezier on the CPU per
    frame): dense-graph zoom went DOM ~43fps → canvas ~11fps. That's the wrong tool (the
    rejected-twice approach); switched to real GPU. Recorded for history.
  - [x] **WebGPU cable + node renderers — BUILT, WORK, PARKED** (2026-06-25, desktop-
    only per author). `gpuCableRenderer.ts` (WGSL, geometry uploaded once, pan/zoom =
    uniform + one draw, MSAA) and `gpuNodeRenderer.ts` (instanced rounded-rect SDF cards).
    Author CONFIRMED cables render + node cards align on the build. Behind canvas render-
    mode (`__solenoidCanvasCables()`); node cards an opt-in alignment overlay
    (`__solenoidNodeCards()`). Tauri `--enable-unsafe-webgpu` wired; `@webgpu/types` added.
  - [ ] **The LOD swap (the actual perf win) — BLOCKED, parked.** Dropping DOM nodes from
    the compositing tree when zoomed out is the win, but `display:none` on `.solenoid-node`
    LOOPS rete's renderer (per-node `ResizeObserver` → setSize → re-render oscillation;
    confirmed vs rete source). `visibility/opacity` don't loop but don't leave the layer
    tree. **Thesis still untested** (the hide never landed once). Resume with interactive
    testing: try `content-visibility:hidden` gated behind the debug flag, or GPU-render
    groups/notes/conduits then hide the whole holder (one element, no per-node storm).
  - [x] **Hit-test + misc groundwork — BUILT, UNWIRED, on ice** (2026-06-25):
    `cableHitTest` / `spatialIndex` / `cableHitIndex` / `nodeHitIndex` / `cssColor` /
    `cableTessellate` — pure + unit-tested, reusable for any future canvas hit-testing /
    rendering. See dev-notes 2026-06-25.

## CI / build

- [x] **Node.js 20 deprecation in GitHub Actions** — verified 2026-06-20. All
  actions already on current major versions that support Node 24 (`checkout@v4`,
  `setup-node@v4`, `upload-artifact@v4`, `rust-cache@v2`, `rust-toolchain@stable`,
  `action-gh-release@v2`). Project Node is already `"22"`. No changes needed.
