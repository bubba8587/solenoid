# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.4 is built** (2026-09-16: every promoted item in
`archive/1.4-plan.md` landed, the selling list + What's New deck are written and the author rewrote the deck
2026-09-16; the tag is the author's; the plan is archived). The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale and rules: the decision tree (`dte.md`).

## Dependency updates (walking them one at a time)

Current state (2026-10-10): everything is on latest except what's held below.
Held: `lodash-es` stays overridden to ^4.18.1 (mermaid 12's `chevrotain` 11.1 asks for 4.17.23, which
carries two high-severity advisories); drop the override once chevrotain moves off 11.1.
`@xyflow/system` stays an exact pin matching the version `@xyflow/react` pins (the socket handle calls its `XYHandle`); bump them together. `@tauri-apps/plugin-http` stays an exact pin matching the `tauri-plugin-http` crate in `Cargo.lock`;
bump them together. `magic-string` stays on 0.30 (the plugin build's pin; 1.x is a new major).
Vitest 5 transforms with Oxc, so the `esbuild: { keepNames: true }` in `vite.config.ts` serves only
the production minify, and its "esbuild options ignored" warning is expected.
- [ ] **Mermaid bundles KaTeX 0.16** (two low advisories, `npm audit`): clears when mermaid moves
  to KaTeX 0.18+; an override would hand mermaid a KaTeX major it wasn't built against.

## Expect
- [ ] **Convert units the FC doesn't list show no unit label** (yd, psi, stone, knot and others): the display id resolves the number, but `unitById` has no label for it, so the value box shows a bare number. Give every Convert unit an FC entry, or a label the registry knows.
- [ ] **Range can't check dates**: Min and Max are number sockets, so a date value is range-checked only against typed serials. Adoptive bounds (a date range for a date value) would fix it.

## Formula library
- [ ] **Replace Excel's criterion strings** (author 2026-10-23: "I always did hate Excel's syntax for those"): COUNTIFS, SUMIFS and kin read `">5"` and `">3/1/2024"` as a little language, the last place a formula reads a date out of text ([[C131]] noTextGuessing, unenforced there). Design a criterion that isn't text (an operator plus a typed value, the way the List Filter card takes one); until then the strings keep working as they do.
- [ ] **Publish the formula library?** (author 2026-10-21, to weigh): Formula.js is gone from rust-port; the core owns every body (`excel_functions.rs`, `fns_*.rs`; the reasons it differs are `tree/specs/computation/formulajs-divergences.md`). Option: export the bodies as a crate of their own, the frozen fixtures as its tests. Weigh against [[C17]] shareImpl and what a public package must keep stable.

- [ ] **12 pack cards collapse without their input pill** (`node scripts/collapse-sweep.mjs`: em-wavelength-frequency, th-ideal-gas, ch-moles-mass, ch-ph and others, 39 findings): a collapsed card with two or more inputs must draw one `CollapsedInputPill` ([[components]] § Collapsed). Predates the layout batching.

## Rust core (rust-port, [[D99]] rustIsSpec)
- [ ] **Typed-input text reading on the core, chrono-node only for relative dates** (author 2026-10-24: keep relative dates working): the input surfaces' reader (`parseDate` in `dateSerial.ts`, [[D93]] oneTextReading) moves to the core's date reader, month-first forms added (`March 5, 2024`); chrono-node stays only behind Settings ▸ Relative dates ([[D54]] relativeDatesOptIn), not ported. Freeze `parseDate`'s answers first over a generated corpus (every shape the reader takes × leap days, invalid days, month/day ambiguity, 2-digit and 0-99 years, times, DST edges, weekday names that disagree with the date, ordinals), port the absolute shapes as a closed list in Rust, and report every case that answers differently. After graph phase B lands.
- [ ] **Crate swaps the audit left for the author** (`audits/crate-audit-2026-10.md`; each row's evidence is a bit-for-bit comparison):
  - Same answers, trade-offs: NFD (`unicode-normalization`, +35 KB gzipped; `../tree/specs/computation/rust-core.md` § Size chose our table for size), `letters.rs` (`unicode-general-category`), `spelled.rs` (`strum`, adds proc-macro build deps), the day ↔ year/month/day helpers (`jiff`, once the time zone swap lands), Levenshtein and OSA (`strsim`; keep our Jaro-Winkler, whose prefix bonus differs), native random and UUID (`fastrand`, `uuid` on `crypto.getRandomValues`).
  - Answers change: the distribution kernels (`statrs`: more accurate, off Formula.js/jStat in the last digits) and Bessel (`libm`/`puruspe`: Formula.js's bessel.js is imprecise by design). Decide jStat parity vs accuracy ([[C14]] currentExcelParity).
- [ ] **IronCalc as an Excel-parity test oracle** (`ironcalc_base`, MIT/Apache, builds for wasm): a dev-dependency to check PRICE, YIELD, the COUP* functions, WORKDAY and kin against Excel's answers without Excel. Not a runtime dependency (it follows Excel, not Formula.js).
- [ ] **Watch:** `ferrigura-jsmath` (V8's Math in Rust; would replace `fdlibm.rs` once mature), `ssf-rs` (SheetJS's format engine, if TEXT moves to real Excel format codes).
- [ ] **A built `GraphEditor` is never freed**: `core.addPipe` hands the core JS closures, and wasm-bindgen keeps every JsValue the core holds in its module-level heap, so a closure (and every node, whose `listen` points back at the editor) keeps the editor, its core and the engine's cached outputs alive for good. Leaks a Composite's `internalEditor` on every load/undo/redo, each landing or scene mount, and every `HtmlCanvasLayer` effect's pipe. Needs a `dispose()` that frees the core at those sites (a weak dispatcher alone isn't enough: nodes hold the editor).
- [ ] **Big files on desktop**: `read_parquet` (and CSV) send the whole table over IPC as JSON and then into wasm32 memory (4 GiB ceiling; running out traps, and every resident frame answers #REF! until reload). The Polars path kept the frame native behind a handle. Columnar IPC at least, and `../tree/specs/computation/rust-core.md` § Where it runs should state the size ceiling beside the speed one.
- [ ] **IM* still reads numeric text** ([[C131]] noTextGuessing, author's call): `IMABS("2")` is 2 and `IMSUM(COMPLEX(1,1),"2")` is 3+i (`to_cx`, `fns_complex.rs`), while `COMPLEX("3","4")` refuses. Either list IM* as a text-form reader (Excel's inumber) in `../tree/specs/computation/formula-language.md`'s list, or refuse plain numeric text.
- [ ] **Desktop hardening** (security review 2026-10-24): `src-tauri/capabilities/default.json` lets the webview write any `$HOME/**/*.json|md` (dot-dirs like `~/.claude`, `.vscode`, `.git` included), read `$HOME/**/*.json|csv|md|yaml`, fetch `http(s)://*:*` (localhost, LAN, 169.254.*) and `opener:allow-open-path` unscoped; deny dot-dirs and private ranges, scope fs to the folders the user picked. `read_parquet` should run off the main thread (`spawn_blocking`) with a size cap. A foreign document's `<img src=http…>` (Image node, Note markdown) loads before the network gate, and pasted cards lose the foreign flag. Script cards in a foreign document run without asking (`../tree/specs/computation/script-sandbox.md` assumes the author wrote them).
- [ ] **Card bodies still on the TS:** Note and Report (knap templating, async frame reads); `tree/specs/computation/node-bodies.md` lists what moved.
- [ ] **The TS schedule engine** (`packages/schedule-engine`'s cpm, graph, calendar, diagnostics, mermaid, `writeMspdi`) is unused by the app now that Schedule, Gantt and Earned Value run on the core's port; only its own tests use it. Deleting it touches [[C69]] ganttPackages (an MIT package meant to publish on its own): the author's call. The MSPDI round trip and DCMA corpus tests would move onto the card first.
- [ ] **Decimal places slider and the 0-decimal format fix** are on rust-port only; develop still has the 2/3/4/6 segments.
- [ ] **CLAUDE.md still routes "a `registerInternal` override"** to `tree/specs/computation/formulajs-divergences.md`; the registry is gone (the core's `route` and `data/call_traits.json`). The author's file: reword the pointer to "before changing a function whose answer differs from Formula.js's".
- [ ] **A big frame crosses the card wire as JSON** ([[node-bodies]]): a million-row, five-column answer is about 130 MB of text and takes a few seconds both ways. The columnar hand-off frames already use (`binary.rs`, `wasmReadBin`) would make it a copy.
- [ ] **The graph's next step ([[D102]] graphOnCore), phase C:** the graph calls the card bodies on the core with no JavaScript hop, so a pass stops crossing into JS per node. What blocks it: `../tree/specs/computation/graph-core.md` § What blocks phase C.
- [ ] **Clippy in CI denies dead code**, so a helper that lands a commit before its caller turns `engine-test.yml` red. Decide: keep it strict, or add `-A dead_code` to the two clippy lines.
- [ ] **`V` carries `Frame`, `Cube` and `Json`**, which only card bodies make or read, so every formula body matches them (`V::Frame(_) | V::Cube(_) | V::Json(_) => NaN`) and the type admits a frame where [[C15]] matricesInFormulas says none goes. A card value (`enum Card { V(V), Frame(..), Cube(..), Json(..) }`) for `nodes/` would leave `V` the formula's value.
- [ ] **A JS throw is a thread-local flag, not a type**: `throw()` sets `THROWN` and answers `V::Undef`, so a body that throws reads like one that answered undefined, and each caller asks `take_raised()` after (`Calc` scopes it per call). `call_function` answering `Result<V, Raised>` would let the compiler carry it; it can move module by module.
- [ ] **Names still dispatch as strings below `call_function`'s arm**: `regex_call`, `finance_function`, `Eval::host` and `error_handler` take the name, and `reads_lists`, `takes_whole_lists` and `reads_matrices` are `matches!` chains run per call. Pass the `F` down and fold the predicates into `Traits.fast` ([[C120]] linearWork).
- [ ] **A card's saved options are read as text per call**: Arithmetic matches `op` per item inside its broadcast; `combine`, `agg` and the rest compare strings. Parse each into an enum once, as `FrameOp` does (List Filter's condition and Add Column's `addAs` do now). Cube Roll-up's aggregates (`AggOp` and `first`/`last`) keep their own copy of the readings tables in `nodes/frames.rs` `agg_unit_plan`; an enum over `AggOp` would share `frame_verbs`'.
- [ ] **`nodes/units.rs` `dim_of` clones the cell's `BTreeMap` dimension**, twice per `arithmetic_cell`, and `pure_currency` builds a map per check. Return `&Dim` (a `static` empty map) in the per-item paths.

## Tooling
- [ ] **Warm vitest cache hides a new globbed file** (`fsModuleCache: true`): a new seed JSON was invisible to `seeds.ts` locally, so `siteThumbs`/`prerender` passed locally and failed in CI. Workaround: delete `node_modules/.vitest-cache`. Decide whether to keep the cache or invalidate it on glob changes.
- [ ] **`scripts/touch-pan-probe.mjs` is stale**: its drill-in step times out waiting for `.solenoid-composite-editor__canvas .solenoid-node` (fails on develop before 2026-10-06's grip work too), and it needs `--no-sandbox` to launch as root.

## Seeds (after the 2026-10-08 scalar input fold)
- [ ] **Bring the Unit Flow example back**: restore or rebuild it from `../backups/unit-flow.seed.json` and `../backups/unitFlowSeed.test.ts` (outside the repo) with Value Inputs; the test pinned unit-flow's captioned behaviors A to J.

## Performance (found 2026-10-06, not done)
- [ ] **A Parquet file crosses IPC as JSON** (`read_parquet`): a million-row file is a large string; a binary reply in the columnar hand-off's buffers (`binary.rs`) would skip the JSON.
- [ ] **Input lists are copied per consumer per pass** (`familyCells`, now a plain loop, ~0.5 ms per 100k cells): passing the upstream array through needs an audit that no node reorders or splices an input in place.
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

## For 1.6 (author 2026-09-28; 1.5 is the release in progress)
- [ ] **Equation outputs vs the formula surface.** The Equation node takes the whole formula
  surface, but every variable's output is a number socket ([[C47]] equationNode: "every real root"),
  so a relation whose answer is complex (`x^2 + 1 = 0`, expected ±i), text, a date or a logical has
  nowhere to go: a negative discriminant is `#SOLVE!`. The fix decides what an unknown's output is
  when its answer leaves the number family (a retype, [[B11]] maximalMerge, or fixed wider
  sockets) and amends C47. Quadratic Roots already answers the conjugate pair.
- [ ] **Solver cards show only what they solve** (author 2026-10-07): the Equation node, and the Triangle Solver with it,
  take every variable as an ordinary input and grow an output box only for the unknown left unwired, instead of a hero
  box per variable (a, b, c, A, B, C). The Triangle Solver keeps its Area, Perimeter and Valid boxes. Decide it with the
  item above (both are what an unknown's output is) and amend C47.

## Sets pack
- [ ] **COUNT DISTINCT on a text list is `#TYPE!`** (found 2026-10-07; numbers work): it is an op on the Aggregate card, whose
  input is a number list (`listIn`), so names never reach it, yet counting distinct names is the Sets pack's use for it.
  COUNTBLANK already reads the raw list; COUNT DISTINCT needs a socket that takes any scalar list (read input-roles and the
  socket lattice before retyping it).

## Node merges (parked by the author, [[B11]] maximalMerge)

- [ ] **Paired-list aggregate**: SUMPRODUCT, the SUMX functions, CORREL, COVARIANCE and a weighted average as one two-list Aggregate (the author said to wait), and the remaining smaller pairs.

## Empty argument slots (author 2026-10-05; [[C80]] blankArgIsExcelBlank, [[D96]] emptySlotShowsItsValue)

- [ ] **Leaf number clash:** this session's D96 emptySlotShowsItsValue took the number the parked `pivot-list-cells` branch gave D96 pivotPoolsItems; move that branch's leaf (`dte move`) when it merges.

## Cubes and lists (author 2026-09-26)
- [ ] **Cards preview what a nested cell holds** (author 2026-10-05, [[C114]] cardsView): a cube card shows a nested
  list, table, Frame or Cube only as its drill chip. Explore example layouts (first task names, a mini table, counts) and
  write the new card-interpreter rules into table-popup § The Cards view before building.

- [ ] **Review the settings sweep ([[D86]] blankRoles).** Built on Claude's judgement (2026-09-26); the calls and the
  exact roles are in `settings-audit.md`. Still to sweep: Frame verbs' column references, an as-of Join's tolerance,
  the Slider's bounds (the `[decided 2026-09-26]` rows of input-roles' "What each input kind does today").
- [ ] **A list read as a column** (the author, 2026-09-26): if TAKE/DROP ever need to count a list's items as rows,
  that is a toggle on the card plus a formula argument, never an exception in [[D85]] columnsStayColumns.
- [ ] **Blank in a typed list literal** (author to rule): `1,,3` in List Input is `[1, 3]` (empty fields drop, compute-pass
  § Typed list literals) while `1,x,3` is `[1, null, 3]` and a wired blank stays in place.
- [ ] **Affordances for do-nothing sorts** (the author, 2026-09-26, if needed): SORT and UNIQUE on a list change nothing
  without by_col. Options named: card toggles (built), a custom LISTSORT / ROWSORT with shortcut behavior, or `#SYNTAX!` on a
  do-nothing setup ("drastic").
- [ ] **A single-record cell in the Cube editor** (a YAML mapping, or `{ ... }` typed into `cubeText`, not `[{ ... }]`):
  its chip drills to an empty level, since each level edits a records array at its path (`cubeViewAt`). Read it as a
  one-row array and write edits back through it.
- [ ] **Formula columns on nested Cube Input levels**, if wanted; types reach every level ([[D90]] cubeTypesAtDepth),
  Fx stays top-level.
- [ ] **Cube Input λ inputs** for Fx columns, as Frame Input has (`lambdaKeys`); today a name that is no column is `#REF!`.
- [ ] **Functions short of Excel's signature** (the parity check, `excelArityParity.test.ts`, lists each with its reason): the
  day-count `basis` on PRICE, YIELD and the four odd-coupon functions; GROUPBY's five trailing options;
  LINEST and LOGEST's const and stats (their answer's shape first: Excel's is a row, or a 5 × 2 grid with stats); MAP past three arrays. TEXTAFTER, TEXTBEFORE and
  TEXTSPLIT read one delimiter, not Excel's array of them (formula-language § the text kernels). The reference (`fixtures/excelArity.ts`) covers the registered Excel names that declare an arity.
- [ ] **List Sort and List Filter names** (author to rule): both take tables now; rename to Sort / Filter beside Frame Sort
  and Frame Filter, or keep the "List" names.

## Composites

- [ ] **LATER — Optimize run mode on composites (1.4 A6; author 2026-09-04c: in, not now).** Excel
  Solver's shape as a sixth composite run mode beside Goal Seek; spec + steps in `archive/1.4-plan.md`
  § A6. Gate: the author says go (and settles the constraint forms; integer no).

## Sources

- [ ] **Widget nodes Tier 2 (`v2.0/16`), post-1.4:** Air Quality/Pollen preset of Weather, Ticking Now timer.

## Obsidian + TaskNotes (author 2026-09-07: THE adoption bet — correct, great, useful)

The bundle `v2.0/24-obsidian-vault.md` is promoted to the flagship track; its § Defaults are the
build rules and § Sequencing the order (A′ → A → B → D → C → F → I → J → E). Every item ships
verified in the desktop app against the demo vault. Landed ledger: the bundle's § What stands today.

- [ ] **`whatsnew` video (plugin 0.1.5, approved 2026-09-28) to `assets/video/`** on the author's word: re-render with
  `DEMO_FPS=60`, recording `wn-cards` in its own run after the rest (`demo-video` skill).
- [ ] **A Note card's bare `{{ list }}` on its own field prints Knap's JSON**; in Obsidian a Knap note draws the
  chip ([[D87]] knapNotes, as [[C68]] asks of a bare tag). Embed the card's own object fields as a Report does?
- [ ] **Knap notes on show:** a `knap: true` note in the demo vault and on the `/obsidian` page, once the plugin
  release carrying it is in the community store (the demo vault installs from there).
- [ ] **Plugin chip tap target on a phone** (review with the author): a chip is 15px tall on Obsidian's 41px phone
  row (measured 2026-09-22 in the rig's mobile emulation), under the "always `sm`" ruling in
  `tree/specs/integrations/obsidian-plugin.md`. Options: `md` under `body.is-phone`, or a taller hit area on the chip's button.
- [ ] **Daily-notes targeting** (author, keep — the removed `{{daily}}` successor): a way to write
  today's daily note in its configured folder + format, wireable (a source node emitting the
  daily-note path from `.obsidian/daily-notes.json`, not inline template syntax). Not necessarily a
  node — still shaping. (dev-notes 2026-09-11.)
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

- [ ] **Schedule row faults vs [[C70]] oneScheduleRule (author to rule):** C70 says a per-row fault (a bad
  Duration, an unparseable date) stays on its row, but the Schedule card's reader (`read_level` in
  `crates/solenoid-core/src/nodes/sched.rs`) fails on every fault and the whole run is one `#VALUE!` on all
  outputs. Either the code grows a per-row path or C70's line changes.
- [ ] **Project-exported goldens** (author): export MSPDI from a Project trial / 2024 for the two
  seeds' plans and drop them in `fixtures/schedule/` as `project-*.mspdi.xml`; the parity test
  picks them up; name any disagreement in `divergences.json`. Until then the corpus is authored.

## Decision Matrix (author 2026-09-28)

- [ ] **The plugin's breakdown bars in the app** (author 2026-09-29, queued as its own task): the Decision Matrix
  Bases View's Rankings view draws each option as a bar split into each criterion's signed contribution, with
  penalties hatched left of zero and a legend (`src/rankings-view.ts` and `styles.css` there). Bring that visual
  to the Decision Matrix node's card or popup, under [[B17]] typedValueModel and DESIGN.md; ask which dev
  environment verifies it before starting.

## Choice Ladder (built 2026-10-16, [[C122]] choiceLadder)
- [ ] **Loose ends from the last review (NICE):** a Nest Join key carrying a unit, or matched number-to-text, isn't recognized as a key and scores; ladder cards show 3 decimals where Plan shows 4.
- [ ] **Capital earned back changes what's possible next**: an option that earns rough capital only moves up the order today; letting it enable others makes order in time matter (the leaf's reopen condition).

## Charts
- [ ] **Sunrise / Sunset prints raw serials** (46194.508 for a sunrise) where a time of day is meant; and a resized Chart card keeps drawing its plot at 218 × 150 (`ChartNode.tsx` W/H).

- [ ] **Radar `ymin`/`ymax` under Scale = per axis (author to pick):** a multi-series radar normalizes each axis,
  so the range does nothing; a single-series radar honors it. Either a set range implies a shared scale, or it
  stays the documented [[C96]] exception. Multi-series `color` is the other exception (the author skipped the fix).
- [ ] **Gauge Dial has no Options input**, so no title or font size in Dial mode (author's call).
- [ ] **Multi-output services still fall to math blue:** Geocode, Weather, Holidays, FX; input amber would fit
  ([[B14]] reaches only one-output cards).

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
- [ ] **Collapse sweep leftovers** (`collapse-sweep.mjs`, needs the author's ruling): solver cards (TVM, Ohm's Law, Triangle Solver, Ideal Gas and kin) keep a row per variable collapsed rather than one pill; settings still visible collapsed on Expect, Grid Painter, Curve, Point Plotter, RANDARRAY, Color, Resistor Code and Query's buttons.

- [ ] **Hand-tidied groups then a canvas Tidy, twice, moved personal finance ~530 px** (2026-09-30, both alignment modes; Cleanup itself is a fixed point). Recheck since `separateAll` stopped treating a standoff cluster's bounding box as solid.
- [ ] **Collapsed stadium pill hover preview** — a collapsed node's input pill shows a hover
  preview listing EVERY cable item (name + value), not just the first. Author's extension to
  consider with it: a special Conduit → bundled cable → Cube node (the bundle's lanes land as one
  cube). Design first (DESIGN.md, `tree/specs/canvas/conduit-lane-faces.md`); stage after the
  Obsidian track.
- [ ] **Linux desktop: tooltips are very large and appear very fast** (author 2026-09-21, not urgent). Lead:
  every tooltip is a native `title` (469 of them, no tooltip component), and WebKitGTK hands those to GTK, so
  size and delay come from the system theme, not the app. Windows (WebView2) and the web draw the browser's own.
  Fixing it means the app drawing its own tooltip; that is a design call (DESIGN.md, `tree/specs/canvas/layout-chrome.md`).
- [ ] **Linux desktop: the canvas dots are harsher / sharper than on Windows and Chromium** (author 2026-09-21,
  not urgent). Lead: the grid is React Flow's `<Background variant=Dots>` (`FlowSurface.tsx`), an SVG pattern of
  small circles, and WebKitGTK antialiases a sub-2px circle harder than Skia does. Candidates: a per-webview
  `--canvas-dot` a step closer to the ground, or a slightly larger, softer dot, keyed on
  `html[data-webview="webkitgtk"]` as the zoom fixes are (`tree/specs/canvas/layout-chrome.md` § Desktop window frame). DESIGN.md
  § 2 holds the structure: dots legible without shouting.
- [ ] **Palette stragglers left for a call** (2026-10-02 sweep): the lasso colors (`FlowSurface.tsx`,
  `htmlCanvasRenderer.ts`), `CableFlourish.tsx`'s fixed Okabe-Ito list, the conduit stripe (`conduit.css`, Default
  vermilion but not an error), the slate `--node-accent` on Image, File Link and SVG Picker, and the
  `FlowCableEdge` ribbon gray. Each is a hard-coded hue that ignores the palette.
- [ ] **PIVOTBY over Cube list and grid cells** is parked on branch `pivot-list-cells` (D96 pivotPoolsItems lives
  there): the author is choosing how a group reads lists (pool items vs average of row results) and grids
  (pool every cell, lists only, or each grid column as a field).

- [ ] **Palette on wide-gamut displays** (author 2026-09-21 noticed the Linux desktop reads more saturated than
  the dev server; cause in `archive/dev-notes-history.md`, digest 2026-09-21b). The hexes are sRGB, so a color-managed engine (Chromium, WebView2
  with a display profile) shows them accurately and an unmanaged one (WebKitGTK) stretches them to the panel.
  The author tuned the palette by eye on an unmanaged P3 panel, sees the same vivid look on their phone, and
  prefers it; managed Chromium on Linux is the outlier among their screens. Design call: leave it, or
  author the accents in `color(display-p3 …)` with sRGB fallbacks so managed engines on P3 panels get the vivid
  version too (DESIGN.md § 2; `palette.ts` derives siblings in HSV from hex, so this is not a token swap).

- [ ] **Card sections: open calls** (DESIGN.md § Card sections). Write to Obsidian was left without sections (its
  panel lays itself out; author call). Untested: a ribbon (bundled) cable into a folded section's pill, and the
  liquid fold on a card inside a group's sub-flow (`flowYOf` reads the viewport transform, so it should hold).

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
- [ ] **35 inbox items** await the author (each says what ratifying it changes, with a lean).
- [ ] **Author places `tree/decisions/inbox/scope-boundary.md`** (proposed ring A); then `out-of-scope.md`'s 13
  categories become B leaves and that doc goes.
- [ ] **C80 blankArgIsExcelBlank still hangs off A5** (author-ratified): its natural parent is [[B16]]
  oneFormulaSurface. The one skipped-ring finding left.
- [ ] **Two author-held `*Where:*` lines remain** (B7, C80). The author deletes them or rules they stay.
- [ ] **Optional:** `python tools/dte.py hook` (pre-commit validate) — not installed; `validate` is not in CI.

## Socket labels (author 2026-09-26)

- [ ] **Parentheticals move to the Inspector** (the author: "backlog a wider sweep on parentheticals in socket labels which
  should move to the Inspector per-socket descriptions"). "(1-based)" moved (ec1de47). What is left needs the author:
  - units: `T (K)`, `p (Pa)`, `ρ (kg/m³)`, `a (m/s)` (thermo), `(UTC)` on the astro sockets, `Marker size (px)`,
    `Font size (pt)` (chart options);
  - the λ-table binding hints `Values (value)`, `value2 (optional)`, `value3 (optional)` (MAP), a named exception in
    [[B14]] oneDesignSystem, so moving them amends that leaf.
  Math notation stays (`arg(z)`, `P(lo ≤ X ≤ hi)`).

## Formatting & units

- [ ] **The Running card adds mixed units' shown numbers**: it isn't `unitAware`, so `[1 km, 500 m, 2 km]` strips to `[1, 500, 2]` and answers `[1, 501, 503]` (develop and the core alike); RUNNING's own unit branch is never reached from the card. Making the card unit-aware means retiring its `formatCarry` for the unit.
- [ ] **Cards that strip units** ([[C25]] firstClassUnits): 33 of about 317 card classes are `unitAware` (the money finance cards joined under [[D101]] financeCarriesMoney); the rest read the numbers their inputs show and answer plain numbers, the boundary's fallback. Each family is owed carrying, as its formula functions do; do them family by family, a unit test per card. CEILING.MATH, QUOTIENT and EVEN in formulas likewise still sit in unit-flow's "any other function" row.

- [ ] **LATER (author, 2026-09-04): fold the Format Controller into the Display** — format and
  unit set at sources and displays, flowing downstream only; the docking subsystem and the
  upstream walk go. Analysis + scope in `archive/1.4-plan.md` Track I. Gate: the author's go after the
  downstream-flow work has been lived with, plus the source-node control design.

## Frame popup (follow-ups from the 2026-09-19 header session)

- [ ] **The formula highlighter paints a called λ socket (`λ1(`) as an unknown function** (`identClass`,
  formulaSyntax.ts). No surface shows it today (the popup's formula field is a plain input); fix it the day a
  highlighted editor edits a Frame Input column formula.
- [ ] **A computed column's date typing is conservative** (`yields_date`, `nodes/columns.rs`): `XLOOKUP` / `MAX` / `MIN` over a date column type the computed column
  Number (their `returns` is "any" / "number"). Extend the declarations if a date-valued lookup column shows up.
- [ ] **A blank frame's CSV view starts with a blank header line** (`buildText`): a CSV pasted below it makes its
  header row the first data row, with the columns unnamed. Found filming the demo video (a new Frame property in
  Obsidian); the author held the behavior until a change is shown rigorous, so the video clicks at the top first.
- [ ] **Pivot view follow-ups** ([[C127]] pivotView, built 2026-10-20): fold column items as rows fold; sort an
  axis from its header (Configure Fields holds the sort today); Excel's "Merge and center cells with labels";
  drill-through (a value cell opens the source rows behind it, which needs the Pivot's filtered source).
- [ ] **Pivot keeps or drops a missing field?** The card drops a field whose column leaves its source (frame-verbs § pivot),
  meant for a source swap; a column briefly absent drops it too. Keeping it, flagged in Configure Fields, is the
  alternative; the author's call.
- [ ] **Write nodes' Keys split on bare commas** (`WriteNodes.tsx`, two places): read and write them with
  `listLiteralItems` / `listLiteralText` so a key holding a comma survives.
- [ ] **Escape with the column-format panel open closes the whole popup** (`ColumnFormatButton` registers no
  escape layer); it should close the panel first, as the ⋯ menu does.
- [ ] **The editor footer's Insert and Delete menus and Cancel / Save keep their older square style** beside the
  pill family; Cancel and Save are dialog actions, the menus could join the pills.

## Family-name polish ([[D22]] oneNamePerCard revised 2026-09-13 — card shows the class-derived family name)

A few families still read awkwardly as `nodeTypeName` output. Fix = rename the class
(no override map, [[D22]] oneNamePerCard), verifying seeds + the generator (type = class name):
- [ ] `IFErrorNode` → "If Error"; `MatDetNode` → a real family name (covers MDETERM /
  MINVERSE / TRACE / NORM / MATRIXRANK — "Matrix"?); `MRoundNode` → a name for the
  MROUND / CEILING / FLOOR family. Author picks the two names.
- [ ] "URL Encode" / "E-Series" can't come from a class rename: `nodeTypeName` only
  splits camelCase (lower→upper), so `URLEncode` and `ESeries` don't gain the space/hyphen.
  Either teach `nodeTypeName` acronym/hyphen handling (a derivation tweak, author to okay)
  or accept "Url Encode" / "ESeries".

## Packs

- [ ] **LOW — variable definitions on every pack Expression** (author 2026-09-24): fill `varDescriptions` on each
  pack formula entry (`packShared.ts`); the card already shows them. Only a handful of entries have them now (EM's
  wavelength, a few Timesavers). Metadata only, DESIGN.md §7 voice; pairs well with the pack-units lead below.

## From the comment lift (rest partition)
- [ ] **Voice lint over option tables.** `uiCopy.test.ts` skips the `tsx-opt-*` records `copyCorpus.ts` already
  collects (dropdown rows, op-meta labels and descriptions); widen the lint to them, a sweep of its own.
- [ ] **Custom packs.** Settings shows `customPacksFolder()`, but `loadCustomPacks()` is a stub returning none until
  filesystem access and a pack format are settled. When they load, the Add menu's per-type caches (`catalogSearch.ts`
  `_sigCache`, `families`) must clear, since a reloaded pack can change a type's sockets.


