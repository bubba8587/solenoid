# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.4 is built** (2026-09-16: every promoted item in
`archive/1.4-plan.md` landed, the selling list + What's New deck are written and the author rewrote the deck
2026-09-16; the tag is the author's; the plan is archived). The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale and rules: the decision tree (`dte.md`).

## Dependency updates (walking them one at a time)

Current state (2026-09-23): everything is on latest, `mermaid` 12 included. Mermaid 12's
`chevrotain` 11.1 still asks for `lodash-es` 4.17.23, which carries two high-severity advisories;
`package.json` `overrides` pins `lodash-es` ^4.18.1, the release that fixes both. Drop the override
once chevrotain moves off 11.1. `@tauri-apps/plugin-http` stays an exact pin matching the
`tauri-plugin-http` crate in `Cargo.lock`; bump them together. `magic-string` stays on 0.30 (the
plugin build's pin; 1.x is a new major). Vitest 5 transforms with Oxc, so the `esbuild: { keepNames:
true }` in `vite.config.ts` serves only the production minify, and its "esbuild options ignored"
warning is expected.

## Expect
- [ ] **Range can't check dates**: Min and Max are number sockets, so a date value is range-checked only against typed serials. Adoptive bounds (a date range for a date value) would fix it.

## Tooling
- [ ] **`scripts/touch-pan-probe.mjs` is stale**: its drill-in step times out waiting for `.solenoid-composite-editor__canvas .solenoid-node` (fails on develop before 2026-10-06's grip work too), and it needs `--no-sandbox` to launch as root.

## Seeds (after the 2026-10-08 scalar input fold)
- [ ] **Bring the Unit Flow example back**: restore or rebuild it from `../backups/unit-flow.seed.json` and `../backups/unitFlowSeed.test.ts` (outside the repo) with Value Inputs; the test pinned unit-flow's captioned behaviors A to J.

## Performance (found 2026-10-06, not done)
- [ ] **Engine commands run on the UI thread**: `#[tauri::command(async)]` frees it, but `engine_drop` is fire-and-forget (`frameBackend.ts`), so a drop could race a preview of its handle; needs a desktop check.
- [ ] **Native CSV crosses IPC twice**: `engine_read_csv` returns every row, then the first verb re-uploads it; register a handle as Parquet does.
- [ ] **Input lists are copied per consumer per pass** (`familyCells`, now a plain loop, ~0.5 ms per 100k cells): passing the upstream array through needs an audit that no node reorders or splices an input in place.
- [ ] **`raw` source text** rides beside every imported number/date column (`inferColumn`), doubling its memory; only the value popup reads it.
- [ ] **Table popup filter** formats every row per keystroke (`TablePopup.tsx` `matchedOrder`), and up to 1000 rows × every column render unvirtualized; a memo needs every display dep (format controls, Source toggle, column types, computed values) or it filters stale text.
- [ ] **Each edit serializes the graph twice** (history at 400 ms, autosave at 700 ms): sharing one capture needs an edit counter every mutation bumps, or a store-only edit between the two could be dropped from the save.
- [ ] **Undo rebuilds the whole graph** (`loadGraph`); a per-node delta restore needs each node to re-apply state in place ([[B12]] losslessSaves).

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
  Duration, an unparseable date) stays on its row, but `scheduleCpm.ts` throws on every fault and the whole
  run is one `#VALUE!` on all outputs. Either the code grows a per-row path or C70's line changes.
- [ ] **Project-exported goldens** (author): export MSPDI from a Project trial / 2024 for the two
  seeds' plans and drop them in `fixtures/schedule/` as `project-*.mspdi.xml`; the parity test
  picks them up; name any disagreement in `divergences.json`. Until then the corpus is authored.

## Decision Matrix (author 2026-09-28)

- [ ] **Flip points** ([[B17]] typedValueModel): per criterion, the nearest weight at which a different
  option takes first place with the other weights held, the way the Decision Matrix Bases View plugin shows them
  under each weight (`flipWeights` in its `src/scoring.ts`, tested there). Pairwise order is linear in each
  weight since every score shares Σ|w|; the plugin ignores `round4`, so the flip weight lands on a near-tie
  rather than a clean handover. A home here: a Breakdown column or a Decision Sensitivity mode. Weigh it
  against `v2.0/10`'s ±N% affordance first, which answers the same "how close is the call" question.
- [ ] **Blanks score as the criterion's median** ([[B17]] typedValueModel): a blank criterion cell scores 0
  today, so under a negative weight an unscored option looks best (an unpriced option is the cheapest). The
  Decision Matrix Bases View plugin scores a blank, or a number cell that reads as NaN, as that criterion's
  median across the options (raw values, before normalizing; a blank logical stays FALSE), and shows it
  dimmed (`fillBlanks` in its `src/scoring.ts`). Its parity fuzz fills Solenoid's blanks the same way to
  compare the rest. Adopting it is a C64 change (frame-verbs spec step 2) and puts the two back in step.
- [ ] **The plugin's breakdown bars in the app** (author 2026-09-29, queued as its own task): the Decision Matrix
  Bases View's Rankings view draws each option as a bar split into each criterion's signed contribution, with
  penalties hatched left of zero and a legend (`src/rankings-view.ts` and `styles.css` there). Bring that visual
  to the Decision Matrix node's card or popup, under [[B17]] typedValueModel and DESIGN.md; ask which dev
  environment verifies it before starting.

## Charts
- [ ] **Sunrise / Sunset prints raw serials** (46194.508 for a sunrise) where a time of day is meant; and a resized Chart card keeps drawing its plot at 218 × 150 (`ChartNode.tsx` W/H).

- [ ] **Radar `ymin`/`ymax` under Scale = per axis (author to pick):** a multi-series radar normalizes each axis,
  so the range does nothing; a single-series radar honors it. Either a set range implies a shared scale, or it
  stays the documented [[C96]] exception. Multi-series `color` is the other exception (the author skipped the fix).
- [ ] **Gauge Dial has no Options input**, so no title or font size in Dial mode (author's call).
- [ ] **Multi-output services still fall to math blue:** Geocode, Weather, Holidays, FX; input amber would fit
  ([[B14]] reaches only one-output cards).

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

- [ ] **Convert and the FC name the same unit differently** (`km_h`/`kmh`, `m_s`/`ms1`; `CONVERT_UNIT_DEFS` vs the FC list): a Convert to km/h or m/s gets no display unit (`fcUnitToUnit(toUnit)` misses), so its output and everything downstream lose the unit label. One id space fixes it.
- [ ] **Convert's output format is ignored when the result carries a unit**: the value box's annotation wins over the card's `render` (`ValueDisplay`, `render && !ann`), so 279.617 mi stays unrounded under Integer.
- [ ] **FV, PV and PMT refuse a currency argument** (author to rule): unit-flow § Functions makes every unlisted function read plain numbers, so `FV(rate, n, -$107)` is `#UNIT!`. A money class (currency in, the same currency out) would let the finance functions carry dollars.

- [ ] **LATER (author, 2026-09-04): fold the Format Controller into the Display** — format and
  unit set at sources and displays, flowing downstream only; the docking subsystem and the
  upstream walk go. Analysis + scope in `archive/1.4-plan.md` Track I. Gate: the author's go after the
  downstream-flow work has been lived with, plus the source-node control design.

## Frame popup (follow-ups from the 2026-09-19 header session)

- [ ] **The formula highlighter paints a called λ socket (`λ1(`) as an unknown function** (`identClass`,
  formulaSyntax.ts). No surface shows it today (the popup's formula field is a plain input); fix it the day a
  highlighted editor edits a Frame Input column formula.
- [ ] **`exprYieldsDate` is conservative**: `XLOOKUP` / `MAX` / `MIN` over a date column type the computed column
  Number (their `returns` is "any" / "number"). Extend the declarations if a date-valued lookup column shows up.
- [ ] **A blank frame's CSV view starts with a blank header line** (`buildText`): a CSV pasted below it makes its
  header row the first data row, with the columns unnamed. Found filming the demo video (a new Frame property in
  Obsidian); the author held the behavior until a change is shown rigorous, so the video clicks at the top first.

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


