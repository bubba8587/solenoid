# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-11-08: per-frame camera work trimmed; cloud session)
- A source read (no measuring) of what runs on every pan and zoom frame; four pieces of dead work went, each with its
  rule in its spec: the selection mirror scans only on a new `nodes`/`edges` array (`flow/selectionMirror.ts`, not RF's
  selection hook, which walked every node and edge per frame); the view keeps no canvas pointer position (nothing read
  it, and it cost a layout read per pointer move); the corner grip drives `XYResizer` itself with no store subscription,
  as the socket handle does; standoff bars and the HTML-in-Canvas frame loop skip their card walk while RF's `nodes`
  array is unchanged. Findings 4 (cables) and 5 (minimap) of `canvas-frame-cost-findings.md` stay open by the author's call.
- React Flow 12.12.1 is on `develop` (handle and resize control unchanged, so the app's copies still match). RF
  13.0.0-next.3 is ported on `bleeding-edge` as an `Edge:` commit: its split stores take every per-card and per-cable
  selector off the camera, which is finding 4 solved upstream. Port it with `port.mjs` once 13.0 ships stable.
- The HTML-in-Canvas change is unexercised in a browser (the mode needs a Chromium flag); the grip and selection were
  checked on the live canvas.
- The local `develop` here again held the 50 Android commits no remote holds; kept as `develop-stale-local` in this
  container only.

### SESSION DIGEST (2026-11-07: live multiplayer researched; cloud session)
- **Bundle 27** (`v2.0/27-multiplayer.md`, plan-only) is bundle 21 Stage 3's new home: link rooms with no accounts, a
  Loro CRDT at the `serializeGraph` boundary keyed by room-only sync ids, tables as rows × columns × raw-text cells,
  an encrypted dumb relay on Durable Objects, every client computing. netcore-rs is untouched by design.
- **Facts that steer it:** WebKitGTK (Linux desktop) has no `RTCPeerConnection` until about 2.56 (so no P2P-only
  design); hosted PartyKit shut down 2026-10-23; y-sweet stalled after Jamsocket joined Modal.
- **Step 1 stands alone:** `applyGraphDelta` would end the full `loadGraph` behind undo and the AI apply. Five author
  calls wait at the bundle's end.

### SESSION DIGEST (2026-11-07: function records, the Text family organized; cloud session)
- **Function records** ([[C140]] functionRecords, `tree/specs/computation/function-records.md`): one Cube-form record per function under `fixtures/functions/`, Excel's answer beside Solenoid's, a kind of truth, a verdict and a citation per case. Excel's answers come only from a workbook Excel saved, through `from-excel.ts`, which refuses anything else or a wrong calibration sheet.
- **Text is organized**: 33 records, 43,771 cases (the old tests and specs, IronCalc's workbooks vendored under `fixtures/functions/sources/ironcalc`, the edge grid); `harvest.json` gives every mention a case or a reason. No answer is filled: the run waits until every family is organized.
- **Traps the workbook handles**: bound values sit in cells, not constants (Excel reads them differently); every formula is a marked dynamic array (an unmarked one is intersected); Excel's `_xlfn.` prefixes come from Excel-saved files; arrays come back through ARRAYTOTEXT beside a shape cell.
- **Viewer**: the Excel Coverage tab's parity mark opens a function's record in the Cube popup.
- Develop was rewritten upstream mid-session; 50 Android commits no remote held were kept on the local branch `backup/android-local-2026-11-07` in the session's container only.

### SESSION DIGEST (2026-11-06: audit and bug hunt; cloud session)
- **Saves:** a text holding half a surrogate pair made the core read the save as null, so every save, autosave and undo snapshot became an empty document; the writer spells such halves U+FFFD and `textFormWrite` answers an unreadable save with `!`. The per-card `foreign` mark rides the text form's positions table ([[save-format]]).
- **Shared documents** ([[B18]] safeToShare): every picture path holds through `webUrl.ts` (the browser's URL parser decides what is the web); markdown text values use `sanitizeNoteHtml`; table-cell pictures go through `WebImage`; SVG `href`, `background`, `<style>`, `image-set()` and `@import` are held. An AI rewrite can't clear a mark (`keepCardTrust`). The Script worker's file is served with its own CSP (`vercel.json`) and a newly loaded graph retires the worker. File Link asks before UNC paths and more Windows launchers.
- **Desktop documents:** a write-through marks the copy's own time, so a mid-pass edit stays unsaved; opening a file a document keeps opens that document; a future `savedAt` is capped at now; `fileStem` drops leading dots, trailing dots and Windows device names.
- **Elsewhere:** binary reads/writes and Open go through the path's provider (Android granted folders, the demo vault); the file picker keeps its cursor through a background relist; Write to Obsidian refuses error cells and calls a value the note already holds unchanged; criteria fast paths read numbers to 15 digits as the scan does, a `"true"` criterion ignores case, and the SUMIFS card totals exactly; a wrapped group member's group holds the composite, and paste/unpack rebuild group tints.
- **Open:** the author's calls are the backlog's 2026-11-06 audit section. The author is building a formula test set in another session; no new card/formula tests were added after that.

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
- **Module headers** are two lines at most in 82 files (`tree/specs/floors/engineering.md` § Comments): what the spec
  already said went, a sentence about one item moved onto it, and noteHtml's network-gate rule moved into
  `tree/specs/documents/reports-and-notes.md`. The palette's OKLCh comment points at DESIGN.md, which holds the ruling.
- **Also:** 203 types only their own file names are no longer exported (the packages' public API kept); the docs
  pointer check now reads backticked `../` paths too; `.gitignore` lost two patterns nothing writes.
- **Open:** `.claude/settings.json` allows `npx tsx scripts/parity.ts` and `npx tsc *`, both stale.

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
