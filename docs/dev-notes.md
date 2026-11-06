# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-11-06: pre-1.6 cleanup sweep; cloud session)
- **What went:** one-off probes nothing ran (chart-contact-sheet, heap, layout, undo-drift, gantt-shots, touch-pan,
  formula-node-parity), the orphaned `relativeDateCorpus.ts`, `.impeccable/`, the bitmap fonts in `public/fonts/`, the
  Unit Flow gallery thumbnails (`site-shots --thumbs` remakes them when P16 lands), three stray `assets/` files, the TS
  `guardFinite` (the core's `guard_finite` is the spec), `triangleOps.ts` and four unused exports, about 30 CSS classes
  nothing renders, all 52 `eslint-disable` comments (no eslint runs here), redundant per-file clippy allows, dated
  "author's Excel" stamps in non-test Rust comments (the conformance tests hold the measurements), and 25 archive docs
  plus review-plan, python-r-gap, upstream-formulajs, the crate audit and `docs/plans/`. Open boxes from review-plan
  and python-r-gap moved to the backlog; 17-matrix-formulas' B-table moved into [[formula-language#Broadcasting]].
- **Fixed on the way:** `package.json` had `test:core` twice (the cargo one stands; the TS tier is
  `npm run test:bucket core`); `tests/buckets.mjs` lost the regex names an earlier rule always claims (no file moved
  bucket); two stale `ISOLATED` entries left `vitest.config.ts`; 1.6-plan holds only what is left.
- **Kept on purpose:** the perf probes an open backlog or deferral item names, `scripts/shot-graphs/`, the demo videos,
  `docs/google-style/` (the author's call), `stillGranted` in `androidFolders.ts` (unused, but the Android grant check
  it is for is new), the `__hcDiag` / `__hcProbe` diagnostics (`tree/specs/canvas/html-in-canvas.md` documents them), `build:wasm:opt`
  (the author's release step).
- **Open:** module headers over two lines (about 170 files, `tree/specs/floors/engineering.md` § Comments); `palette.ts`'s dated
  OKLCH ruling wants a leaf or a DESIGN.md line; `.claude/settings.json` allows `npx tsx scripts/parity.ts` and
  `npx tsc *`, both stale.

### SESSION DIGEST (2026-11-06: geometry figure cards, pack seeds and examples, pack constants, formula layout, the Element card; cloud session)
- **Geometry figure cards** (the author 2026-11-06): Triangle Solver, Unit Circle, Circle Solver, Regular Polygon,
  Two Points, Polygon from Points and Solid. Each is a frame in (or its own keyed `frameText`), a frame out, one row per
  figure with a unit per column; XWide, the figure in a Recess, the Record pager, the Preview. Rust in `nodes/geometry.rs`
  (`FigureTable`, `Measure`), TypeScript in `GeometryFigure.tsx` and `GeometryCards.tsx` (`FigureCard`). A size the
  solve didn't need is checked, a mirror pair is `#SOLVE!`, text in a part is `#VALUE!`. Unit Circle answers blank where
  a function is undefined, says so in its card warning, and has exact values every 15°.
- **Direction** (the author 2026-11-06): Solenoid should be broadly usable in education, STEM above all. The figure
  cards (exact values, every part keyable, honest "two answers fit" errors) and the Element card are built that way.
- **Every pack ships an example seed** (`Pack.seed`, `seedGraphs/packs/`, written by `scripts/gen-pack-seeds.test.ts`),
  offered under Packs while the pack is on; each charts what it computes (`frameOf` + `chart`), but Geometry's figures
  and Timesavers' QR code are already the visual. Comparison is core. **Seeds open as examples** (`SolDoc.seed`): out
  of the file tree until changed and kept, "Discard changes?" on leaving an edited one (`requestChoice`).
- **Pack constants are cards** ([[C76]] formulaPackDefault, `pack-architecture.md` § Physical constants): a preset
  names a physical constant as a variable and declares it (`constants`); placing the card places a Physics Constant
  cabled in (`companions`, `src/graph/companions.ts`, both placement paths). The variable is required (`varRequired`,
  `nodes/formula.rs`): cut and untyped, it answers `#SYNTAX!` naming it, never a hidden CODATA copy. Physics Constant
  is a core card the five physics packs tag. Empirical fit coefficients stay in their formulas.
- **Every preset input has a description**, its name and unit and nothing else (author 2026-11-06); `packs.test.ts`
  fails on a bare one.
- **Formulas lay out by their parentheses** (`formulaLayout.ts`, [[formula-language#Editor support]]): tab indents,
  Enter indents by the open brackets, a closer on a blank line dedents, Shift+Alt+F lays out the whole formula. Presets
  arrive laid out; a card's narrow formula field shows one flowing line. The popup's editor has its own resize grip.
- **The Element card is the periodic table** (`data/elements.json`: PubChem's properties, IUPAC weights;
  `nodes/elements.rs`): a symbol, name or atomic number in, or a list of them; g/mol, Z and a 19-column Elements frame
  out; `ELEMENT()` answers every property. The picker is an edge-to-edge table tinted by category (palette series
  slots, inset borders) with a detail panel and legend.
- **Smaller:** Blueprint and Orchard pull every color toward their home slot (a standing derivation); Value Input's date
  mode takes the medium width; chart markers are solid dots in the series color.
- **Open:** a Chart fed a table (not a frame) plots nothing, silently (`values: [null…]`), where it should plot or say
  why. Earth's radius is still a number in the haversine and horizon presets (no Physics Constant op for it).
- **Save is autosave done now** (author 2026-11-06, `saveNow`): Ctrl+S captures and says "Saved"; on an example it
  asks, then keeps it in the tree named in place (`treeRename.ts`); on desktop a file-bound document writes through.
  Save As is the export. No Keep button.
- **The 1.6 desktop session** (the author 2026-11-06): the develop build's Linux AppImage runs headless here
  (`Xvfb`, `xdotool`, a throwaway `HOME`; the cloud app can't start Actions runs, the author does, and artifacts download
  through the GitHub tool). F2 verified, F1 landed (dot-dirs closed everywhere, local network refused, Parquet async and
  capped; fs-to-picked-folders after 1.6), F12 landed (every kept desktop document a file, autosave writing through).
  A local `npm run tauri build -- --no-bundle` (about 4 minutes once warm) tests `src-tauri` changes before a CI build;
  it needs `libwebkit2gtk-4.1-dev` and friends, as `desktop-build.yml` installs them.
- **Waiting on the author:** remove the 15 Geometry formula presets the figure cards cover; whether the comparison
  functions (IS, ABOVE…) move to core with the Comparison card; record the education direction as a leaf (which ring).

### SESSION DIGEST (2026-11-06: mathlib as a lens, the spec vocabulary and an overnight research run; cloud session)
- **Spec vocabulary from mathlib** (develop 4b7b526, 9491962): `value-semantics` § Points and differences is the one
  home for point kinds (dates, °C/°F readings) and point weight; why the Kleene tables are forced; `socket-lattice`
  § The shape of what connects (widening is a preorder, narrowing and wildcards don't compose, coercions agree along
  paths except through the bridge and the other families' matrix rungs) and the Type Settle's real cap (256 passes);
  dimensions as exponent vectors; the four aggregate kinds (`formula-language`, "What a total can be built from");
  glossary entries. Mathlib's names go in specs as words, never backticked (docsPointers holds backticked names to the
  code).
- **The research** lives on `research/mathlib-lens` (its research doc under `docs/audits/` and two probe test files), six
  of eight hourly passes run before the author stopped it. Its confirmed bugs are in the backlog, § Found by the mathlib
  research. Two choices wait in the inbox: `dates-weigh-as-points` (`(d1 + d2) / 2` is `#TYPE!` for dates but a
  reading for °C) and `aggregates-of-nothing` (MAX, MIN and PRODUCT of nothing make up a 0).
- **The research landed** ([[C139]] mathlibLaws, made with the author 2026-11-06: mathlib is the reference for the laws Solenoid's math keeps): MDETERM has no singularity
  cutoff (a singular matrix is 0, as Excel), MINVERSE and SOLVE decide singularity at any scale
  (`singular_at_any_scale`) while computing as before; the Equation solver's tolerances are purely relative; the
  spreads sum their terms exactly (`terms_sum`); the Type Settle visits cards in topological order (`visit_order`).
  The laws behind each are in the specs with their mathlib declarations (`../tree/specs/floors/engineering.md` § Laws come from mathlib, by
  name, pinned to mathlib `9c8f67d`) and held by `properties.rs` and the graph crate's `lattice.rs`, `settle.rs` and
  `boundary_core.rs`. Refrozen: MDETERM of a singular matrix (0 now), and last-digit moves of at most 7e-12 relative.
  Then the rest: every family's matrix rung shapes what arrives (`to_matrix`); PRODUCT multiplies in sorted order
  (`product_of`); running and rolling sums are exact and snap as SUM does; dimension exponents snap to small
  fractions (`snap_exp`); MOD and QUOTIENT say which quotient MOD pairs with (Lean core's `Int.fmod_add_fdiv_mul`).
  The research list is empty. The author's calls landed too: [[E19]] datesWeighAsPoints (a refused date formula is
  weighed whole, then piece by piece, `by_point_weight`) and [[D125]] aggregatesOfNothing (MAX and MIN of nothing
  blank, PRODUCT 1, GCD 0, LCM 1). Date cards are back in the 210px tier (`nodeMedium`).
- **`#POINT!`** ([[E20]] pointError, the author 2026-11-06): a position (a date, a °C or °F reading) used as an amount
  is its own error, where it was `#TYPE!` for dates and `#UNIT!` for readings. `point_error` beside `unit_error`,
  `point_refused` for dates; `#TYPE!` keeps wrong kinds, `#UNIT!` real unit clashes. Scheduling's dates come from
  adding durations to dates, never dates to dates.
- **Before pushing Rust, even a prototype test: `bash scripts/check-rust.sh <crate>`** (the crate bans `powi`, clippy
  runs with warnings as errors) and give a new test file a leaf citation, or coverage fails CI.

### SESSION DIGEST (2026-11-06: 1.6 release copy and the value-handling triage; cloud session)
- **Marketing copy is looser than UI copy** (DESIGN.md §7, author 2026-11-06): the What's New deck lives in `src/graph/whatsNewSlides.ts`, which the UI-copy sweep skips; no em dashes, American spelling and true claims still hold. The 1.6 deck is in (`WHATS_NEW_VERSION` 1.6); `docs/release-notes-features.md` is its source, `docs/release-notes-1.6.md` the plain changelog.
- **Empty text is nothing typed in a total** ([[D109]] aggregatesRefuseText): a card that answers text as its formula reads `""` as a blank at the port (`family_cell`, both boundaries), and SUMSQ and SUMPRODUCT skip it. PTP, IQR, MAD, SEM, CV and RMS refuse text in formulas, as their cards did.
- **Two temperature scales never meet** ([[C25]] firstClassUnits): `temperatures_mix` (`unit_value.rs`) refuses K with °C or °C with °F on the Arithmetic card, in an aggregate or running list, in a formula whose inputs carry two scales (a list mixing scales mapped item by item doesn't count) and in a computed column. Δ°C is still owed: two °C readings subtract to K.
- **AVERAGEIF(S) over nothing is blank**, as AVERAGE's is, in the formula and on the SUMIFS card.
- **CSV junk cells are NaN** (`infer_text_column`): missing markers and up to a tenth of other text keep a number or date column, their text in `raw`. A stopgap until the NaN walk; the full CSV pass is in the backlog.
- **Query is Pipeline, a run mode** ([[C53]] pipelineIsCompositePreset, author 2026-11-06): computes as Manual refresh (`refreshes()`), plus `pipelineChain()` (one chain from the Table marker to the Result marker; side inputs through the Pipeline's own ports; the first fault named) and the read-only `PipelineSteps` list on the card, numbered, with a folded Preview of the selected step off its `cachedResult`. Nothing on the card edits the graph. Shot graph: `scripts/shot-graphs/pipeline-steps.json`.
- **Freezing**: `bodies_over_values_with_a_unit`, `fold-units` and `tests/csv.rs` now refreeze under `FREEZE_NATIVE` like the other suites.
