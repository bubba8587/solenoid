# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems. Per-item entries are
swept to `archive/dev-notes-history.md` once digested — read a digest first;
drill into the archive (or `git log`) only for the mechanics of a specific item.

### SESSION DIGEST (2026-07-06 pm — C-4 XLOOKUP + C-2 Input Switcher + F-1 custom palette)

**F-1 custom palette editor (`palette.ts` + `components/PaletteEditor.tsx`).** The app
palette dropdown gains **"Custom…"** → a user-authored full 12-slot map.
- Model: `_appBase` is now `PaletteChoice = PaletteName | "Custom"`; `_customMap` persists
  separately (`solenoid.palette.custom`), seeds from Default. `recompute`/`recomputeReport`
  route through `baseMapFor` (Custom → the user map). New store API: `activeBase()`/`setActiveBase`
  accept "Custom"; `customMap()`, `setCustomSlot(slot,hex)` (live retint when Custom active + no
  doc pin), `loadCustomTemplate(name)` (seed from a built-in). Doc/report palettes stay
  built-in-name-only (a doc pin still wins over app Custom). `initPalette` loads both keys.
- UI: `PaletteEditor` shows when Custom is active — 12 role-labelled native color wells
  (Number/Text/Date/… not the opaque slot ids), Load-template buttons (Default/Muted/CVD/
  Solarized), and a **live sample** (a node in a Group + a Lorem Note, retinting live; the
  Group/Note slot are pickable via SwatchGrid). Only the 12 base slots edit — array/matrix
  stay derived siblings (DESIGN.md Sibling Rule). Slot edit retints via CSS vars (onChange)
  + rebuilds the group-dot cache on blur (not per drag-tick). `palette.test.ts` covers it.
  EYEBALL: Settings → Appearance → Color palette → "Custom…"; edit a well, watch the canvas
  retint; Load a template to start from one; the sample previews in-context.

### SESSION DIGEST (2026-07-06 pm — C-4 XLOOKUP merge + C-2 Input Switcher upgrade)

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

### SESSION DIGEST (2026-07-06 pm — author-present, C-4 unified XLOOKUP merge)
Local dev server (HMR); commit freely, no pushes. tsc + full vitest (2243) green.
- **C-4 XLOOKUP merge — REAL merge, not a wire-driven socket swap.** The author vetoed
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
