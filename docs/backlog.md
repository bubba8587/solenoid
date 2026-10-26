# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.4 is built** (2026-09-16: every promoted item in
`archive/1.4-plan.md` landed, the selling list + What's New deck are written and the author rewrote the deck
2026-09-16; the tag is the author's; the plan is archived). The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale and rules: the decision tree (`dte.md`).

## Dependency updates (walking them one at a time)

Current state (2026-10-10): everything is on latest except what's held below.
`@xyflow/system` stays an exact pin matching the version `@xyflow/react` pins (the socket handle calls its `XYHandle`); bump them together. `@tauri-apps/plugin-http` stays an exact pin matching the `tauri-plugin-http` crate in `Cargo.lock`;
bump them together. `magic-string` stays on 0.30 (the plugin build's pin; 1.x is a new major).
Vitest 5 transforms with Oxc, so the `esbuild: { keepNames: true }` in `vite.config.ts` serves only
the production minify, and its "esbuild options ignored" warning is expected.

## Formula library

- [ ] **12 pack cards collapse without their input pill** (`node scripts/collapse-sweep.mjs`: em-wavelength-frequency, th-ideal-gas, ch-moles-mass, ch-ph and others, 39 findings): a collapsed card with two or more inputs must draw one `CollapsedInputPill` ([[components]] § Collapsed). Predates the layout batching.

## Rust core (rust-port, [[D99]] rustIsSpec)
- [ ] **Build the shipping module with `npm run build:wasm:opt`** before rust-port merges into develop: the branch commits it unoptimized (`wasm-opt` is opt-in), about 6% bigger raw.
- [ ] **Watch:** `ferrigura-jsmath` (V8's Math in Rust; would replace `fdlibm.rs` once mature), `ssf-rs` (SheetJS's format engine, if TEXT moves to real Excel format codes).
- [ ] **Decimal places slider and the 0-decimal format fix** are on rust-port only; develop still has the 2/3/4/6 segments.
- [ ] **A JS throw is a thread-local flag, not a type**: `throw()` sets `THROWN` and answers `V::Undef`, so a body that throws reads like one that answered undefined, and each caller asks `take_raised()` after (`Calc` scopes it per call). `call_function` answering `Result<V, Raised>` would let the compiler carry it; it can move module by module.

## VaultBridge
- [ ] Spec the Vault Read (Vault Folder's Cube: columns, tags, daily-note dates, types), the TaskNotes card and Write Tasks; `tree/specs/integrations/vault-bridge.md` marks them "no spec yet".

## Tooling
- [ ] **`scripts/touch-pan-probe.mjs` is stale**: its drill-in step times out waiting for `.solenoid-composite-editor__canvas .solenoid-node` (fails on develop before 2026-10-06's grip work too), and it needs `--no-sandbox` to launch as root.

## Seeds (after the 2026-10-08 scalar input fold)
- [ ] **Bring the Unit Flow example back**: restore or rebuild it from `../backups/unit-flow.seed.json` and `../backups/unitFlowSeed.test.ts` (outside the repo) with Value Inputs; the test pinned unit-flow's captioned behaviors A to J.

## Performance (found 2026-10-06, not done)
- [ ] **`raw` source text** rides beside every imported number/date column (`inferColumn`), doubling its memory; only the value popup reads it.
- [ ] **Table popup filter** formats every row per keystroke (`TablePopup.tsx` `matchedOrder`), and up to 1000 rows × every column render unvirtualized; a memo needs every display dep (format controls, Source toggle, column types, computed values) or it filters stale text.
- [ ] **Each edit serializes the graph twice** (history at 400 ms, autosave at 700 ms): sharing one capture needs an edit counter every mutation bumps, or a store-only edit between the two could be dropped from the save.
- [ ] **Undo rebuilds the whole graph** (`loadGraph`); a per-node delta restore needs each node to re-apply state in place ([[B12]] losslessSaves).

## Canvas frame cost (found 2026-10-08b, not done)
- [ ] **A zoom step re-records every card on screen** (zoom snaps to 0.1, so each notch that crosses a step is one full repaint): personal-finance at 0.2, about 20 ms paint and 40 ms main per step in dev, 7 ms main at zoom 1. Priced by knockout, no card style dominates (shadow, filter, radius, text, opacity, clips, cables each within noise); the dot grid is about half the step's raster in headless CPU raster only; hidden group members cost about 1 ms of layout; keeping the pan layer through the zoom saved nothing. What's left scales with elements per card (about 3,000 on screen). The minimap re-lays out a rect per card whenever its viewBox follows the camera.
- [ ] **Layerize runs every pan frame** (~1.5 ms on personal-finance at zoom 0.1, more in dev): Chrome takes no direct-transform fast path for a style-driven transform; RF writes the viewport transform as inline style.
- [ ] **Unmeasured on the author's XPS 15 (UHD 630) and in WebKitGTK**: the pan layer is Chromium-only, so the Linux desktop build pans as before.

## Release planning (author-run)

- [ ] **Walk `2.0-plan.md`** (1.4.2 shipped 2026-09-22 with plugin 0.1.3; 1.4.1 was the first Windows + Linux release).
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The ARR pass over the tree** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules: walk `python tools/dte.py tree` and ratify node by
  node (`docs/dte.md` § Solenoid practice; `archive/1.4-plan.md` D3).

## Empty argument slots (author 2026-10-05; [[C80]] blankArgIsExcelBlank, [[D96]] emptySlotShowsItsValue)

- [ ] **Leaf number clash:** this session's D96 emptySlotShowsItsValue took the number the parked `pivot-list-cells` branch gave D96 pivotPoolsItems; move that branch's leaf (`dte move`) when it merges.

## Cubes and lists (author 2026-09-26)

- [ ] **A list read as a column** (the author, 2026-09-26): if TAKE/DROP ever need to count a list's items as rows,
  that is a toggle on the card plus a formula argument, never an exception in [[D85]] columnsStayColumns.
- [ ] **A single-record cell in the Cube editor** (a YAML mapping, or `{ ... }` typed into `cubeText`, not `[{ ... }]`):
  its chip drills to an empty level, since each level edits a records array at its path (`cubeViewAt`). Read it as a
  one-row array and write edits back through it.
- [ ] **Cube Input λ inputs** for Fx columns, as Frame Input has (`lambdaKeys`); today a name that is no column is `#REF!`.
- [ ] **Functions short of Excel's signature** (the parity check, `excelArityParity.test.ts`, lists each with its reason): the
  day-count `basis` on PRICE, YIELD and the four odd-coupon functions; GROUPBY's five trailing options;
  LINEST and LOGEST's const and stats (their answer's shape first: Excel's is a row, or a 5 × 2 grid with stats); MAP past three arrays. TEXTAFTER, TEXTBEFORE and
  TEXTSPLIT read one delimiter, not Excel's array of them (formula-language § the text kernels). The reference (`fixtures/excelArity.ts`) covers the registered Excel names that declare an arity.

## Sources

- [ ] **Widget nodes Tier 2 (`v2.0/16`), post-1.4:** Air Quality/Pollen preset of Weather, Ticking Now timer.

## Obsidian + TaskNotes (author 2026-09-07: THE adoption bet — correct, great, useful)

The bundle `v2.0/24-obsidian-vault.md` is promoted to the flagship track; its § Defaults are the
build rules and § Sequencing the order (A′ → A → B → D → C → F → I → J → E). Every item ships
verified in the desktop app against the demo vault. Landed ledger: the bundle's § What stands today.

- [ ] **`whatsnew` video (plugin 0.1.5, approved 2026-09-28) to `assets/video/`** on the author's word: re-render with
  `DEMO_FPS=60`, recording `wn-cards` in its own run after the rest (`demo-video` skill).
- [ ] **Knap notes on show:** a `knap: true` note in the demo vault and on the `/obsidian` page, once the plugin
  release carrying it is in the community store (the demo vault installs from there).
- [ ] **Knap for dynamic write paths / content** (author, parked): use Knap to template a Write to
  Obsidian `path` or the written body from wired values — the successor to the removed `{{date}}`
  grammar, now that `path` is a plain wireable string.
- [ ] **Write mega-merge, phase 2** (author 2026-09-10, maximalMerge): the vault half LANDED
  2026-09-11 — Write Properties folded into Write to Obsidian (Auto / Note / Properties target).
  Remaining: fold **Write File** (disk CSV/JSON/MD) and **Write Tasks** (API) into the same sink as
  further targets. Original note: Write File + Write to Obsidian as
  ONE sink with a target selector (file / vault), formats as arguments (CSV, JSON, Markdown),
  and the merge-to-folder behavior (`ec715ed` built it on Write File: a document input, one
  `.md` per page into the path as a folder, a frame under MD as a pipe table; backed out
  pending the merge). Write Tasks / Write Properties are candidates for the same card.
- [ ] **File the Knap upstream PRs** (`knap-upstream.md`, re-verified on 0.6.0): the typed-value
  bug first (its two remaining repros, `slice` singletons and `set`), then whitespace control,
  filters in comparisons, the `sort` parameter; the API asks as issues. Retire the noted
  workarounds as each lands.

## Gantt + Schedule (BUILT 2026-09-12 — `v2.0/25-gantt.md` § 9 is the ledger; follow-ups)

- [ ] **Project-exported goldens** (author): export MSPDI from a Project trial / 2024 for the two
  seeds' plans and drop them in `crates/solenoid-schedule/tests/corpus/` as `project-*.mspdi.xml`; the parity test
  picks them up; name any disagreement in `divergences.json`. Until then the corpus is authored.

## Decision Matrix (author 2026-09-28)

- [ ] **The plugin's breakdown bars in the app** (author 2026-09-29, queued as its own task): the Decision Matrix
  Bases View's Rankings view draws each option as a bar split into each criterion's signed contribution, with
  penalties hatched left of zero and a legend (`src/rankings-view.ts` and `styles.css` there). Bring that visual
  to the Decision Matrix node's card or popup, under [[B17]] typedValueModel and DESIGN.md; ask which dev
  environment verifies it before starting.

## Choice Ladder (built 2026-10-16, [[C122]] choiceLadder)
- [ ] **Loose ends from the last review (NICE):** a Nest Join key carrying a unit, or matched number-to-text, isn't recognized as a key and scores; ladder cards show 3 decimals where Plan shows 4.

## Recharts coverage (author 2026-10-14: wire up everything recharts 3 offers that we skip)
Audited against recharts 3.10.1; only `chartRender.tsx` imports it. Each item lands as Chart Builder options and a spec line in `tree/specs/computation/chart-figures.md`.
- [ ] **Stacking:** stacked Column, Bar and Area (`stackId`), 100% stacked (`stackOffset="expand"`), streamgraph (`silhouette`, `wiggle`); `BarStack`.
- [ ] **Dual y axes:** a second value axis on the right (`yAxisId`, `orientation="right"`), per series, through Merge Plots too.
- [ ] **Curve types** on Line, Area and XY lines: `monotone`, `natural`, `basis`, `step`, `stepBefore`, `stepAfter`.
- [ ] **Line and Area:** `connectNulls`; `baseValue` (fill to a value, not zero); range areas from a `[lo, hi]` pair (confidence bands); `layout="vertical"` for Line and Area.
- [ ] **Bars:** floating and range bars from a `[lo, hi]` pair; rounded corners (`radius`); a `background` track; `minPointSize`, `maxBarSize`, `barGap`, `barCategoryGap`.
- [ ] **Pie:** donut (`innerRadius`), half and partial pies (`startAngle`/`endAngle`), `paddingAngle`, `cornerRadius`, nested rings (several `Pie`s), `activeShape` hover pop-out.
- [ ] **Axes:** reversed axes; `sqrt`, `pow` and `symlog` scales beside linear and log; rotated tick labels (`angle`); ticks inside the plot (`mirror`); `unit` suffixes; a log x axis.
- [ ] **Markers:** marker shapes beyond on/off (circle, square, diamond, triangle, cross, star, wye via `Symbols`).
- [ ] **Value labels:** `LabelList` on Column, Bar, Line, Area and pie slices (today only Funnel, XY `annotate` and `pielabels`); the `Label` component for positioned axis and reference text.
- [ ] **Legend:** position (top, right, left) and vertical layout; swatch `iconType`.
- [ ] **ErrorBar** whiskers on bars, lines and scatter points, from error columns.
- [ ] **Brush:** a range slider under a long series for zoom and pan.
- [ ] **ZAxis** for Bubble size instead of the hand-sized markers.
- [ ] **SunburstChart** for hierarchies; nested Treemap (`children`); Sankey node and link styling; RadialBar `background` and `label`.
- [ ] **ReferenceLine `segment`:** sloped lines between two points (trendlines) in References; needs a call on how a row asks for it, since `x`, `x2`, `y`, `y2` already draw a box.
- [ ] **`syncId`:** shared tooltip and cursor across charts on one canvas or Report.
- [ ] **`Customized` / chart hooks** (`useXAxisScale`, `usePlotArea` and the rest) for our own marks inside a chart; first use: draw dense XY markers and dots as one canvas or path layer, since the settle redraw of a 30k-dot scatter still takes about 3 s (one SVG element per point).
- [ ] **`Text`** (wrapping SVG text) for long titles and labels.
- Skipped on purpose, reopen if the reason goes: `ResponsiveContainer` (we size every figure), `RechartsThemeProvider` and its themes (the palette themes charts), animation (`AnimationControllerProvider` and the rest; charts draw static), the shape primitives (`Cross`, `Curve`, `Dot`, `Polygon`, `Rectangle`, `Sector`, `Trapezoid`, `Surface`, `Layer`, `ZIndexLayer`) except as building blocks for the items above.

## Canvas chrome (queued by the author 2026-09-07, "not top priority")
- [ ] **Sideways phone: verify on the S25+ (2026-10-04, untestable headless):** the scale watchdog against the right-side
  cut-off, the fullscreen chrome zoom and its 18px corner inset ([[layout-chrome#Phones in landscape]]). Open asks: refit the
  camera on rotate; a service worker if Android Chrome still won't offer Install; the six-rung mark for the desktop icon.
  Also on the phone: a pinch whose leftover finger lifts on a card no longer selects it (fixed by reading, untested headless).

- [ ] **Hand-tidied groups then a canvas Tidy, twice, moved personal finance ~530 px** (2026-09-30, both alignment modes; Cleanup itself is a fixed point). Recheck since `separateAll` stopped treating a standoff cluster's bounding box as solid.



## Landing pages

The site is five pages (`/about` is the landing page; `/` is the app) sharing `landing/siteNav.tsx` chrome (see architecture.md). Open items:

- [ ] **solenoid-ngc.com follow-ups (author):** Google Search Console has the domain and its sitemap (2026-10-08).
  Left: Bing Webmaster Tools (skipped for now; Import from GSC needs no DNS). Optional: `solenoidngc.com` as a redirect.
- [ ] **Bluesky handle `@solenoid-ngc.com` (author, later):** Bluesky Settings → Account → Handle → I have my own domain →
  DNS panel; add its TXT record (`_atproto`, `did=did:plc:…`) in Vercel's Domains → DNS Records, then Verify.
- [ ] **Tagline "node graph calculator" in the site copy** (author 2026-10-04, aligned during the copy pass): it is only in
  the README today; the planned domain (solenoid-ngc.com) carries its initials, the copy spells it out, never "NGC".
- [ ] **Author reviews the site copy.** An agent pass (2026-09-23) brought every page to DESIGN.md §7;
  the Packs and Examples pages now render from the pack definitions and the seed list.
- [ ] **Public changelog page (parked, author wants it later).** Would live at `/changelog` off
  `docs/release-notes-features.md` + the What's New slides. Deferred so it does not just mirror
  GitHub Releases; revisit when there is a reason it earns its own surface.
- [ ] **Finish the landing/Obsidian scene rebuild.** Feature scenes are real canvases (Obsidian
  hero `LiveGraph`, `VaultTableScene`, `LocalFileScene`, `NoteImportScene`, `TaskNotesScene` on the
  demo API fake). Still hand-built DOM/SVG: the Presenter scene (landing) and the Obsidian page's
  bridge + Plan vignettes — none maps to a single locked pass.

## Demo video (`assets/video/`, the `demo-video` skill)

- [ ] **Re-film the `types` and `units` scenes**: `scripts/demo-video/scenes.mjs` now builds Value Inputs, and the units scene's input FCs merged into the inputs' own units.
- [ ] **Re-film after 2026-09-29's UI changes:** type icons on every type toggle and column header, the narrower
  Cast card with its Separators, the 4-decimal number display, palette-following Add menu tints and neutral accents,
  card sections and the liquid fold, the Edit Frame / Edit Table buttons.
- [ ] **Author review before publishing:** listen to the synthesized soundtracks (the agent checked them by numbers
  only) and pick where each cut goes: the app tour (landing page, README, release notes), the one-minute Obsidian
  cut (the plugin's README and community listing, the `/obsidian` page).

## DTE — decision provenance (`docs/dte.md`)

The tree is the author's to ratify: 127 leaves, each a product call that follows from its parent; mechanics
live in specs. Tool findings and the next DTE version's input: `dte-feedback.md`.
- [ ] **Author ratifies the tree, one leaf at a time** — A1, B1, B2, B3, B7, C80, D62 and E10 are ratified.
  New today and unseen by the author: B18 safeToShare, B19 spreadsheetHabits. Next: the rest of ring B, then C.
  Ratifying adds the ID to `OWNER_RATIFIED` in `rules.test.ts`.
- [ ] **The outbox still lists A1, B1, B2, B3, B7 as ratified with no History line**: the author cleared those
  leaves' History by hand and will handle History themselves; leave them.
- [ ] **79 inbox items** await the author (each says what ratifying it changes, with a lean); the 2026-10-26 backlog sweep moved every decision-gated item there.
- [ ] **Author places `tree/decisions/inbox/scope-boundary.md`** (proposed ring A); then `out-of-scope.md`'s 13
  categories become B leaves and that doc goes.
- [ ] **C80 blankArgIsExcelBlank still hangs off A5** (author-ratified): its natural parent is [[B16]]
  oneFormulaSurface. The one skipped-ring finding left.
- [ ] **Two author-held `*Where:*` lines remain** (B7, C80). The author deletes them or rules they stay.
- [ ] **Optional:** `python tools/dte.py hook` (pre-commit validate) — not installed; `validate` is not in CI.

## Formatting & units

- [ ] **The Running card adds mixed units' shown numbers**: it isn't `unitAware`, so `[1 km, 500 m, 2 km]` strips to `[1, 500, 2]` and answers `[1, 501, 503]` (develop and the core alike); RUNNING's own unit branch is never reached from the card. Making the card unit-aware means retiring its `formatCarry` for the unit.
- [ ] **Cards that strip units** ([[C25]] firstClassUnits): 33 of about 317 card classes are `unitAware` (the money finance cards joined under [[D101]] financeCarriesMoney); the rest read the numbers their inputs show and answer plain numbers, the boundary's fallback. Each family is owed carrying, as its formula functions do; do them family by family, a unit test per card. CEILING.MATH, QUOTIENT and EVEN in formulas likewise still sit in unit-flow's "any other function" row.


## Frame popup (follow-ups from the 2026-09-19 header session)

- [ ] **The formula highlighter paints a called λ socket (`λ1(`) as an unknown function** (`identClass`,
  formulaSyntax.ts). No surface shows it today (the popup's formula field is a plain input); fix it the day a
  highlighted editor edits a Frame Input column formula.
- [ ] **A computed column's date typing is conservative** (`yields_date`, `nodes/columns.rs`): `XLOOKUP` / `MAX` / `MIN` over a date column type the computed column
  Number (their `returns` is "any" / "number"). Extend the declarations if a date-valued lookup column shows up.
- [ ] **Pivot view follow-ups** ([[C127]] pivotView, built 2026-10-20): fold column items as rows fold; sort an
  axis from its header (Configure Fields holds the sort today); Excel's "Merge and center cells with labels";
  drill-through from a value cell (Details lists a leaf's rows; a cell's rows also split by its column item), and
  Details on a subtotal or the grand total.
- [ ] **The editor footer's Insert and Delete menus and Cancel / Save keep their older square style** beside the
  pill family; Cancel and Save are dialog actions, the menus could join the pills.

## Packs

- [ ] **LOW — variable definitions on every pack Expression** (author 2026-09-24): fill `varDescriptions` on each
  pack formula entry (`packShared.ts`); the card already shows them. Only a handful of entries have them now (EM's
  wavelength, a few Timesavers). Metadata only, DESIGN.md §7 voice; pairs well with the pack-units lead below.

## From the comment lift (rest partition)
- [ ] **Voice lint over option tables.** `uiCopy.test.ts` skips the `tsx-opt-*` records `copyCorpus.ts` already
  collects (dropdown rows, op-meta labels and descriptions); widen the lint to them, a sweep of its own.


