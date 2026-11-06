# Solenoid — Backlog

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.5.0 shipped 2026-10-08; the 1.6 cut is
`1.6-plan.md`** (three rounds and a desktop session; everything else waits until after 1.6). The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale and rules: the decision tree (`dte.md`).

## Socket naming

- **`anydata` and `trueany` as their own category** (author 2026-11-03): unlike the rank wildcards (`any`, `anycombo`, `anylist`, `anytable`, which lift a value to their rank or collapse a singleton), these two take a value at its own rank. The socket legend shows them as their own row under a working name, "As-is"; settle the category's name, then carry it through the socket reference, the glossary and the type names if the author wants them renamed.

## Leaves the code breaks

Each line is a leaf whose rule the code doesn't keep yet. The leaf carries an `*Unenforced:*` bullet pointing here ([dte.md](dte.md) § Solenoid practice). Highest stakes first; delete a line when the code keeps the rule, and delete the leaf's bullet with it.

- [ ] **C25 firstClassUnits** (a temperature difference stays a difference): subtracting two °C or °F readings, and a spread over readings (STDEV, GROUPBY's), should give Δ°C or Δ°F. Today it gives K, and converting that to °C shows −263.15 °C. Needs Δ°C and Δ°F units that convert by scale and add back to a reading.
- [ ] **C112 noOverlapsEver**: Align and opening a collapsed card don't end with the No-Overlap Pass, so Align can stack two cards and an opened card can cover the one below. Both should end with the same small cleanup Tidy, nudge and distribute do (`../tree/specs/canvas/group-expand-push.md` § LayoutFx).

## Dependency updates (walking them one at a time)

Current state (2026-10-10): everything is on latest except what's held below.
`@xyflow/system` stays an exact pin matching the version `@xyflow/react` pins (the socket handle calls its `XYHandle`); bump them together. `@tauri-apps/plugin-http` stays an exact pin matching the `tauri-plugin-http` crate in `Cargo.lock`;
bump them together. `magic-string` stays on 0.30 (the plugin build's pin; 1.x is a new major).
Vitest 5 transforms with Oxc, so the `esbuild: { keepNames: true }` in `vite.config.ts` serves only
the production minify, and its "esbuild options ignored" warning is expected.

## Dates as a kind ([[D114]] dateIsAKind; `tree/specs/values/date-values.md`)
- **Probe a first-time-empty answer for its type** (parked; reopen if wildcards staying untyped until a result arrives feels bad): when an output that has never carried a value answers empty, run the card once on one sample value per wired input's family and type the socket from that, in place of the source's declared type ([[D117]]).
- A refused date call answers one `#TYPE!` where a broadcast once answered one per item; decide whether the refusal should broadcast.
- REDUCE/SCAN over dates need a date start (the default 0 is a mix); consider a blank start that takes the first item.

## Value handling (author 2026-11-02, walked piece by piece; [[C134]] functionsFollowAlgebra, [[C17]] shareImpl)

- [ ] **The author's lean for the walk below (2026-11-04):** the formula surface reads a blank one way, functions and operators alike (today a blank answers blank, [[C24]] arraySemantics; Excel's 0 or "" is the inbox item operators-read-blank-as-zero); a card differs only in its defaults and placeholders ([[D124]] comparisonFunctions).
- [ ] **The kinds of "nothing" under C134**, walked in `p7-walk.md`: the empty field and empty slot are built; empty text `""` is ruled (the same as typing nothing), with its card side next; a blank on a cable, a formula variable left empty (`x`) and NaN are still to walk. NaN is common, not rare: "a" typed in a number column is NaN with its raw text kept ([[C58]] tableInputRawText); probe that path, not just a bare NaN. Today a bare NaN is `#DOMAIN!` in SUM/AVERAGE/MAX and `2 + x`, but COUNT counts it and AND reads it FALSE.
- [ ] **Card vs formula on a cabled blank, `""` and NaN** (must align, C17): Boolean Op reads a cabled blank Kleene-style (`AND(TRUE, blank)` blank on the card, TRUE in the formula; NOR the other way) and NaN as blank; `""` on a typed port that doesn't pass text to its body is still the port's `#TYPE!` (the cards that answer text as their formula, Aggregate, Rank & Percentile and Boolean Op, read it as a blank since 2026-11-06); COUNT with an error in the list answers the error on the card, skips it in the formula; Rank & Percentile called directly skips logicals.
- [ ] **PRICE, YIELD, ODDFPRICE, ODDFYIELD, ODDLPRICE, ODDLYIELD don't implement Excel's `basis`**: passing one is `#SYNTAX!` (too many arguments) since 2026-11-05, where it was silently ignored.
- [ ] **Array literals** (`{1, 2, 3}`, Excel's) don't parse in a formula, so a list argument's empty slot can't fall back to a typed list (`p7-walk.md` § Open).
- [ ] **Text leftovers after [[D109]] aggregatesRefuseText / [[D110]] logicRefusesText:** a Frame's `min`/`max` over a text column answer first/last text where the formula is `#TYPE!` (keep the feature?); Pivot `percentof` skips text; Frame `count` counts text (COUNTA's meaning); Group Lists skips error cells; Mode, Trim Mean, Rank, Percent Rank and Correl may skip text in formulas but error on cards (unchecked; PTP, IQR, MAD, SEM, CV and RMS joined D109 on 2026-11-06); MODE.SNGL undecided (equality, not arithmetic).
- [ ] **SUMX2MY2, SUMX2PY2, SUMXMY2** still skip logical pairs ([[D108]] aggregatesCountLogicals) and text pairs (D109).
- [ ] **A hint for a formula shaped like a date** (found 2026-11-04): `IF(TRUE, 01-Feb-1992)` is `01 − Feb − 1992`, `Feb` a variable socket read as 0, so -1991. Never guessed as a date ([[C10]] socketLattice), and no date literal syntax (no spreadsheet has one; the author 2026-11-05): when a formula has a number-month-number shape, the card says "for a date, write DATE(1992, 2, 1)".

## Formula library
- [ ] **`INDEX(m, 0, c)` gives a one-column table** ([[A5]] excelParity, [[D85]] columnsStayColumns), in formulas and on the INDEX card, not a list: with `m = [[3,1,2],[9,8,7]]`, `m / INDEX(m, 0, 1)` should divide each row by its first value, not across the columns.
- [ ] **Cards that lack their formula's options** ([[D73]] nodeCoversFormula): WORKDAY and NETWORKDAYS take a weekend pattern like "0000011", CONCAT rows take a list, TEXTJOIN gets more than one text row. FILTER's include mask and if_empty, and XLOOKUP over plain lists are already on another card (Frame Filter, Frame from Lists); point to it from the card's description.
- [ ] **Merges under [[B11]] maximalMerge**: REDUCE with SCAN; Append with Bind Columns; FIXED with DOLLAR (DOLLAR adds the currency sign); Web Source, Import HTML and Import XML as one fetcher with a format choice. Group Lists stays, as the quick one-dimensional version of the Frame GROUPBY card. Formula names and answers stay; old saves break (pre-alpha).
- [ ] **More 2-D from numpy / scipy / MATLAB** (rounds one and two landed 2026-11-05: Smooth, Convolve, Integrate, DIFF with ∇², Find Peaks and RANDARRAY Grid modes, INTERPOLATE's Points, the Connected Regions card; hole filling is INTERPOLATE's Grid mode): GRIDDATA's `linear` method (a Delaunay triangulation, a library is fine), FFT2 (waits on complex values). A smooth 2-D density (`kde2d`) is already Histogram 2-D into Smooth's Gaussian.
- [ ] **EWMA as a Smooth op** ([[B11]] maximalMerge): both smooth a series, so they belong on one card, but EWMA is core and Smooth sits in the Signals & Grids pack (off by default); the merge needs the author to pick the home.
- [ ] **Card-to-formula checks skip every `parity: false` row; they shouldn't** (author 2026-11-05: we own the whole formula surface, so `parity` is an Excel note only). `cardFormulaTwins.test.ts` and `emptyFieldKinds.test.ts` gate on `eq.parity`. Waiting on the author's pick of how to take it. Done on the way (2026-11-05 parity audit): the harness sets Distributions' INV forms and reads a card's own input order; the REPLACE, REPT, Date Add (EDATE), Roman, Bessel and Coupon cards answer as their formulas, and COUPDAYS shares the coupon kernel. Still to compare: the harness can't read IM Unpack, LINEST, LOGEST (several outputs), Forecast's GROWTH socket order, FILTER, SORTBY, MAP, GROUPBY, FORECAST.ETS.CONFINT, RANDBETWEEN, Cast's TEXT. Still real: DOLLARDE/FR, BINOM.DIST.RANGE, CHISQ.TEST and ISPMT blank where the formula errors; ACCRINT and PRICEDISC codes; CEILING and FLOOR lenient on a mismatched sign or zero significance. The empty fields follow the author's rule (2026-11-06, [[input-roles#Placeholders]]): a card's Fallback is what the formula's empty slot reads, and a Fallback where Excel's empty value means something is set wrong (it becomes that value). The parity functions are done but XIRR and XNPV's dates (`EMPTY_PENDING`, `emptyFieldKinds.test.ts`: the card reads empty dates as a periodic schedule, a behavior with no formula slot yet); the `parity: false` ones (ACCRINT's rate and par, DATE's year, PRICE and YIELD, the rest the gate hides) are the ongoing walk once the gate goes.
- [ ] **A check for [[D73]] nodeCoversFormula**: a card marked `parity: false` skips every card-to-formula test, so nothing notices a card missing one of its formula's arguments (RANDARRAY's columns went unnoticed until 2026-11-05). `rolesFrom` maps only settings, so it can't tell; each card would declare the socket or field that covers each argument, and a test would fail a gap that isn't written into its Excel note.
- [ ] **Finish the settings sweep** ([[D86]] blankRoles): the inputs `docs/settings-audit.md` § Not swept yet lists (column choices on table cards, an as-of Join's tolerance, the Slider's bounds) get their roles the way the swept ones did.
- [ ] **Equation answers any type, and solver cards show only the solved output**: an unwired variable's output retypes to fit its answer, so `x^2 + 1 = 0` gives a complex answer instead of `#SOLVE!` (complex, text, date or logical). The Equation card then shows an output box only for the unwired variable (asked for 2026-10-07).
- [ ] **List Input keeps a typed blank** ([[C24]] arraySemantics): `1,,3` gives two numbers today, while `1,x,3` keeps three items and a wired blank stays in place. A typed gap should be a blank item.


## Rust core ([[D99]] rustIsSpec)
- [ ] **Layer the core**: five groups (formulas, values, tables, planners, cards), each relying only on those below; today it's a flat list and a couple of low-level pieces reach up into card code. Publishing the function library on its own needs it.
- [ ] **Build the shipping module with `npm run build:wasm:opt`** before develop merges into main (the author's step): develop commits it unoptimized (`wasm-opt` is opt-in), about 6% bigger raw.
- [ ] **Desktop hardening** (security review 2026-10-24): `src-tauri/capabilities/default.json` lets the webview write any `$HOME/**/*.json|md` (dot-dirs like `~/.claude`, `.vscode`, `.git` included), read `$HOME/**/*.json|csv|md|yaml`, fetch `http(s)://*:*` (localhost, LAN, 169.254.*) and `opener:allow-open-path` unscoped; deny dot-dirs and private ranges, scope fs to the folders the user picked. `read_parquet` should run off the main thread (`spawn_blocking`) with a size cap.
- [ ] **A JS card's answer that throws while the core reads it hangs the fetch** (found 2026-11-04, after 1.6): a list with a throwing index getter, or one deep enough to overflow the JS stack, unwinds through wasm frames (`js_sys::Array::get` doesn't catch), so the fetch never settles and the error is unhandled; the RefCell flags it held stay set. No card makes one today (Script results are coerced; Note and Report bodies are app code). The fix reads a card's answer through calls that catch, or converts a JS card's answer in JavaScript before it crosses.
- [ ] **Quadratic work the C120 sweep left** ([[C120]] linearWork, 2026-10-24; the small ones landed):
  - INTERPOLATE's grid fill (`fill_grid`, `fns_lists.rs`) scans every known point per candidate corner; needs a spatial index.
- [ ] **Text-reading calls the no-text-guessing sweep left for the author** ([[C10]] socketLattice): NAND, NOR and XNOR answer #TYPE! for text where AND, OR, XOR and NOT answer #VALUE! ([[D110]] logicRefusesText): one error for the family? And `COALESCE(list, "n/a")` drops a text (or logical) fallback, as `../tree/specs/computation/formula-language.md` § COALESCE says ("any other fallback is ignored"); a silent drop reads as a bug, so confirm it's wanted.

## JavaScript the core still imitates ([[B27]] computeAnswersToExcel, [[B7]] preAlphaBreakFreely)

Audit 2026-11-01. Each fixture an item touches is rewritten in that commit ([[D99]] rustIsSpec). Checked in the live engine: the LOG and DATEVALUE examples below; the rest are read from the code, Excel's answers from its documentation.

- [ ] A case setting on the cards and functions that order text (sorts, `<`/`>`), case-insensitive as Excel's when on; [[C59]] byteStringOrder stays the default and text against a number stays `#TYPE!` (author 2026-11-01).
- [ ] What's left is wording: comments that still describe a body by the JavaScript it once copied (`V8's Math.hypot`, `JS undefined`, `JS a > b`) and `truthy`'s name for the logical reading of a number. No answer changes; the coercions, number readers, regex, TEXT, zones and card truthiness went 2026-11-01 and 02.

## VaultBridge
- [ ] Spec the Vault Read (Vault Folder's Cube: columns, tags, daily-note dates, types), the TaskNotes card and Write Tasks; `tree/specs/integrations/vault-bridge.md` marks them "no spec yet".

## Tooling
- [ ] **Upstream the interim patches** (`crates/vendor/interim/PATCHES.md`, 11 of them): file each as a pull request on conradludgate/interim, the three bug fixes (1, 8, 10) first; drop each from the list as it lands, and once all have and a release carries them, depend on the release and delete the vendored copy.
- [ ] **A signed count (`+3 days`, `-3 days`) never reaches the date reader** (found 2026-11-04): interim reads it (patch 7), but `is_relative` lets no phrase through without a word such as ago, next or in, so a date Value Input never treats it as relative. Let a signed count with a unit through the gate, or drop patch 7.
- [ ] **Relative dates, left over from the move to interim:** "next friday" reads as the Friday of next week (interim's UK dialect, as chrono did); the US reading would make it the coming one, the author's call (`Dialect::Uk` in `relative_date.rs`). Still unread: "end of month", "next quarter", "tuesday next week", "in 3 business days".
- [ ] Regex recursion (`(?R)`, `(?1)`, `(?&name)`) and branch-reset groups (`(?|…)`): Excel runs both (author's Excel 2026-11-01), fancy-regex has neither, so they are `#VALUE!` naming the feature (`excel_regex.rs` `pcre2_lower`). Needs a PCRE2 engine in the wasm or a rewrite (a branch reset renumbers each alternative's groups onto one set, which `Found` would map back).
- [ ] **chrono-node in Rust, as its own repository** (author 2026-11-01, the author sets it up): seed it from `relative_date.rs` and `fixtures/core/relative-dates.json.gz` as they stood before `relative_date.rs` moved to interim (git history), the fixture as its conformance suite. Solenoid moves to it only if it reads better than the patched interim.
- [ ] **Type Check's ISNULL duplicates its ISBLANK** since ISBLANK tests per cell (2026-11-02); the author kept ISNULL for now. Dropping it breaks saves that use `isnull` ([[B7]] preAlphaBreakFreely) and renames the error table's "detect missing" (`tree/specs/values/error-values.md`).
- [ ] **Dead CSS, by eye:** `node scripts/dead-css-classes.mjs` lists 66 classes nothing emits, among them library classes (`react-grid-*`) and BEM suffixes built at run time; each needs a look in the running app before it goes.
- [ ] **Renumber the tree once it is ratified** (author 2026-10-30): `python tools/renumber_tree.py` closes each ring's id gaps (131 of 136 change today) and rewrites the `[[ID]]` citations; run it as a commit of its own, then hand-check the bare id mentions it lists outside `docs/archive/`.
- [ ] **IronCalc as a test oracle**, tests only, never shipped: check PRICE, YIELD, the COUP functions, WORKDAY and their like against an engine built to match Excel. Today they're checked only against answers frozen from Formula.js, and no Excel runs in CI.
- [ ] **Name the behind-the-scenes processes** in `docs/glossary.md`, as LayoutFx and VaultBridge are: the Pass (one recalculation), the Dimension Pass, the Type Settle, the Rebuild, the Error Guard, and candidates such as the Reader and the Formatter. "Plan" alone has five meanings today.
- [ ] **A Frame embedded in a Report picks its view** (author 2026-10-28): the Dashboard box's Show as Cards (`FrameCards`, `DashboardOverlay.tsx`) offered on a Report embed too, kept per ref; the static webpage export needs its own cards markup.
- [ ] **Scroll hands on at the edge, app-wide** (author 2026-10-28; the Dashboard is done: a box scrolls the board once at its end): canvas card scrollers (`flowWheel.ts`: a `.nowheel` area swallows the wheel while it *can* scroll in that direction, even at its end, so the canvas never gets it; test the edge, not the overflow), `overscroll-behavior: contain` on `.table-cards-wrap` (TableCards.css) and any popup body, `ladderView.tsx`'s wheel `stopPropagation`; a swipe already under way hands on only through `installTouchScrollChain` (`touchScrollChain.ts`, browser scroll latching), so install it on the other outer scrollers (popups, the Report, panels).
- [ ] **Headless runner as a pipeline step** (author 2026-10-28, pitch: "build the model visually, run it from a script, feed any dashboard"; `out-of-scope.md` §1/§5/§11 keep it a step, not a dashboard backend or server). `npm run build:cli` makes dist-cli/ (about 9 MB, 3 MB gzipped, Node only). Left: publish it to npm (author's account and package name; a package.json for dist-cli/ with `bin`), `--set name=value` inputs by node name, `--out name` to print only chosen outputs, a check of Script and the file and network connections under plain Node, and one example (a seed + a scheduled GitHub Action publishing JSON a dashboard reads). No serve or watch mode.

## Android app (`android.md`)
- [ ] **First build, by a local agent on the author's machine** (prepared 2026-11-04): `android.md` § Plan for the local agent, phases 1 to 7. A Play Store release would need the Storage Access Framework in place of All files access.

## Script card
- [ ] **A Python option for the Script card?** (open question for the author, 2026-10-31; [[C66]] scriptNode): JavaScript stays the default (no download, runs natively in the browser's sandboxed worker, and the Rust port gives no reason to change it). Python through Pyodide would suit spreadsheet and data users who know Python better than JS, at the cost of a large download loaded only when used, a slow first start and slower runs; as an option on the card or a pack, never a replacement. An embedded language (Rhai, Lua) would be sandboxed by construction but almost nobody knows one. A foreign document's scripts wait for a Run press whatever the language (`../tree/specs/computation/script-sandbox.md` § A document someone else wrote).

## Seeds (after the 2026-10-08 scalar input fold)
- [ ] **Bring the Unit Flow example back**: restore or rebuild it from `../backups/unit-flow.seed.json` and `../backups/unitFlowSeed.test.ts` (outside the repo) with Value Inputs; the test pinned unit-flow's captioned behaviors A to J.

## Performance (found 2026-10-06, not done)
- [ ] **`raw` source text** rides beside every imported number/date column (`inferColumn`), doubling its memory; only the value popup reads it.
- [ ] **Table popup rows aren't virtualized** (DONE on the `tan` branch, TanStack Virtual in `VirtualRows.tsx`; it merges into develop once TanStack upstream is more stable): a 366×41 frame is ~15k inputs, so the first resize step (the card turning sized: ~0.3 s style, ~0.8 s layout) and crossing a `table-popup` container breakpoint (560, 640: ~0.4 s style) restyle every cell; steady resize is ~80 ms a step in headless Chromium. Rendering only the visible rows fixes all three, and the filter item below with them.
- [ ] **Popup zoom control (author 2026-11-02), pulled for now**: a − 100% + control in the Table, Cube and Chart popups' header that applies CSS `zoom` to everything under it, one shared setting (`popupZoom`, 70% to 200%). It landed as `36819d3f` and was reverted while the resize lag below is open, since the author noticed the lag after it; reverting that commit's revert restores it whole.
- [ ] **Popup resize feels laggy again in real Chrome (author 2026-11-02)**, noticed after the zoom control landed; headless Chromium shows no difference between `99bdfcb9` (the resize fix) and `36819d3f` (zoom) and can't measure it (its steps are ~60 ms software paint). Leads, each tried once in headless and inside the noise there: the `.table-popup` size container costs a second style pass per step (~6 ms per step without it, ~12 with); replacing it with width flags set on the card helped only when nothing read the card's width per step (no ResizeObserver, no `clientWidth` in a layout effect; the grip's `size.w` works); `useHeaderHeightVar` rewrites `--header-h` every step (guard it to changes); the auto-growing column-name textareas against plain inputs; reverting the zoom control's body wrapper. Needs a measurement in the author's Chrome (Performance panel, a 366×41 frame) before any of these lands.
- [ ] **Table popup filter** (the render half lands with `tan`'s virtualization) formats every row per keystroke (`TablePopup.tsx` `matchedOrder`), and up to 1000 rows × every column render unvirtualized; a memo needs every display dep (format controls, Source toggle, column types, computed values) or it filters stale text.
- [ ] **Each edit serializes the graph twice** (history at 400 ms, autosave at 700 ms): sharing one capture needs an edit counter every mutation bumps, or a store-only edit between the two could be dropped from the save.
- [ ] **Undo rebuilds the whole graph** (`loadGraph`); a per-node delta restore needs each node to re-apply state in place ([[B12]] losslessSaves).

## Canvas frame cost (found 2026-10-08b, not done)
- [ ] **A zoom step re-records every card on screen** (zoom snaps to 0.1, so each notch that crosses a step is one full repaint): personal-finance at 0.2, about 20 ms paint and 40 ms main per step in dev, 7 ms main at zoom 1. Priced by knockout, no card style dominates (shadow, filter, radius, text, opacity, clips, cables each within noise); the dot grid is about half the step's raster in headless CPU raster only; hidden group members cost about 1 ms of layout; keeping the pan layer through the zoom saved nothing. What's left scales with elements per card (about 3,000 on screen). The minimap re-lays out a rect per card whenever its viewBox follows the camera.
- [ ] **Layerize runs every pan frame** (~1.5 ms on personal-finance at zoom 0.1, more in dev): Chrome takes no direct-transform fast path for a style-driven transform; RF writes the viewport transform as inline style.
- [ ] **Cable beads on a canvas overlay (low priority, author 2026-11-03).** Every bead frame makes Blink rebuild and layerize the whole page's paint (personal-finance idle, beads on: ~826 ms/s main, ~1.6 s/s raster; `scripts/cable-flow-probe.mjs`). Plan: one canvas above the graph draws the beads, with card rects and socket glyphs cut out so beads still pass under them; prototype and measure before building. Needs a spec entry first (a new canvas layer), and care for isolate dimming, collapsed-group ribbons, the selected cable's lift, HTML-in-Canvas mode and the phone's GPU texture budget. A 30fps shared clock (~25% main, ~half raster, beads step ~1px) was offered as a stopgap and declined.
- [ ] **Unmeasured on the author's XPS 15 (UHD 630) and in WebKitGTK**: the pan layer is Chromium-only, so the Linux desktop build pans as before.

## Release planning (author-run)

- [ ] **Walk `2.0-plan.md`** (1.4.2 shipped 2026-09-22 with plugin 0.1.3; 1.4.1 was the first Windows + Linux release).
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The ARR pass over the tree** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules: walk `python tools/dte.py tree` and ratify node by
  node (`docs/dte.md` § Solenoid practice; `archive/1.4-plan.md` D3).

## Cubes and lists (author 2026-09-26)

- [ ] **A list read as a column** (the author, 2026-09-26): if TAKE/DROP ever need to count a list's items as rows,
  that is a toggle on the card plus a formula argument, never an exception in [[D85]] columnsStayColumns.
- [ ] **Cube Input λ inputs** for Fx columns, as Frame Input has (`lambdaKeys`); today a name that is no column is `#REF!`.
- [ ] **Functions short of Excel's signature** (the parity check, `excelArityParity.test.ts`, lists each with its reason): the
  day-count `basis` on PRICE, YIELD and the four odd-coupon functions; GROUPBY's five trailing options;
  LINEST and LOGEST's const and stats (their answer's shape first: Excel's is a row, or a 5 × 2 grid with stats); MAP past three arrays. TEXTAFTER, TEXTBEFORE and
  TEXTSPLIT read one delimiter, not Excel's array of them (formula-language § the text kernels). The reference (`fixtures/excelArity.ts`) covers the registered Excel names that declare an arity.

## Sources

- [ ] **CSV import, the full pass** (author 2026-11-06: production use leans on CSV, so value handling inside is finished first and import is then patched to match it). Since 2026-11-06 a number or date column keeps its stray cells as NaN with their text (`infer_text_column`, [[frame-verbs#Type inference]]), a stopgap: NaN is `#DOMAIN!` in SUM, so one `N/A` still breaks a column's total until the NaN walk (§ Value handling) decides how a NaN reads.
- [ ] **Widget nodes Tier 2 (`v2.0/16`), post-1.4:** Air Quality/Pollen preset of Weather, Ticking Now timer.

## Obsidian + TaskNotes (author 2026-09-07: THE adoption bet — correct, great, useful)
- **Solenoid Properties plugin: the app's type icons** (author 2026-11-03): its property type pickers use more of the family icons the app draws (`TypeIcon.tsx`: `#`, `Aa`, the calendar, the checkbox, the double-struck C, the Frame outline), as its Frame type already does.
- [ ] **A daily-note source card**: outputs today's daily-note path from the user's Obsidian daily-notes settings, to wire into a vault-writing card. It replaces the removed `{{daily}}` shortcut, asked back as something wirable; its exact shape is open.
- [ ] **A Note card shows a list property as a chip** ([[D87]] knapNotes): a bare `{{ items }}` holding a list or table prints raw text such as `[1,2,3]` on the card, where Obsidian with the plugin draws the chip.
- [ ] **Plugin chips easy to tap on a phone**: a chip is 15 px tall in Obsidian's 41 px phone row. Keep the small look and give it a taller tap area (the `md` size overpowers a property row, `../tree/specs/integrations/obsidian-plugin.md`).

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
- [ ] **A Duration in days or weeks counts working days and weeks**: `2 day` converts through hours to 48 h today, which an 8-hour calendar spreads over 6 working days. After, `2 day` is 2 working days and `1 week` is 5.
- [ ] **A bad Schedule row errors only that row**, as `../tree/specs/computation/schedule-and-gantt.md` says: today one bad Duration or unreadable date makes every output `#VALUE!`.

- [ ] **Project-exported goldens** (author): export MSPDI from a Project trial / 2024 for the two
  seeds' plans and drop them in `crates/solenoid-schedule/tests/corpus/` as `project-*.mspdi.xml`; the parity test
  picks them up; name any disagreement in `divergences.json`. Until then the corpus is authored.

## Decision Matrix (author 2026-09-28)

- [ ] **The plugin's breakdown bars in the app** (author 2026-09-29, queued as its own task): the Decision Matrix
  Bases View's Rankings view draws each option as a bar split into each criterion's signed contribution, with
  penalties hatched left of zero and a legend (`src/rankings-view.ts` and `styles.css` there). Bring that visual
  to the Decision Matrix node's card or popup, under [[B17]] typedValueModel and DESIGN.md; ask which dev
  environment verifies it before starting.

## Hidden until they get their own pass (author 2026-11-04)
- [ ] **Choice Ladder, Gantt (card and Chart Builder target), Schedule and Earned Value are out of the menus** ([[C138]] addMenuReachesAll) (`hidden: true` in `nodeCatalog.ts` and `chartOptions.ts`; the `choice-ladder` and `product-launch-gantt` seeds hidden). Saved documents still load them, and `whats-new` and `kitchen-remodel-tasknotes` still show Gantt and Schedule. Each gets an author pass (the Choice Ladder review below, the Gantt + Schedule follow-ups) before it comes back.

## Choice Ladder (built 2026-10-16)
- [ ] **Author review of the Choice Ladder** (author 2026-10-29): it was built with little author attention and needs a pass through its node, figure and spec (the ladder figure bullets in `../tree/specs/computation/chart-figures.md`, and `../tree/specs/computation/frame-verbs.md` § Choice Ladder) to sort out what stays. The spec prose there hasn't had the readability pass ([[spec-prose]]). Open idea from the inbox: an option that earns back a rough cost (political capital) could enable options that need it, so order in time matters; wait until a real plan needs it.

## Recharts coverage (author 2026-10-14: wire up everything recharts 3 offers that we skip)
- [ ] **A Bar gauge with a negative Max reads like a number line**: Max on the left, 0 on the right, the fill growing leftward from 0 (today Max -50 reads "0 … -50"). A Max of exactly 0 draws an empty track.
- [ ] **A multi-series radar honors y min and max**: with Scale per axis, a y max of 100 is silently ignored when there are several series (one series honors it). Setting either switches Scale to shared, so the range takes effect.
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

## Workspace tree (`v2.0/26-navigator-tree.md`, [[C132]] workspaceTree)
- [ ] Desktop: a new document is a file at once, Untitled in the selected folder, kept by autosave (the author, 2026-11-06; in 1.6's desktop session).
- [ ] Desktop: the tree reads the Documents folder ([[D103]] folderOnDisk), rename and move on disk, the watcher with bundle 21 Stage 0, Reveal in file manager and Copy path in the row menu. Graph files stay `.json` (the author, 2026-11-06).
- [ ] Pages and page folders as rows once bundle 20's model lands; drop outline rows on a page row; This page search scope; drop the `?navpreview=1` mock (`workspacePreview.ts`).
- [ ] Row status beyond unsaved: changed on disk, a Problems count (needs problems kept per document).
- [ ] Drag on touch (long-press to lift); today touch moves through Move to….

## Canvas chrome (queued by the author 2026-09-07, "not top priority")
- [ ] **Remove drag-to-scrub** (author 2026-11-04: it doesn't work in the app and isn't wanted): `useNumberScrub` in `inlineInput.tsx` (the number field) and `ValueInputNode.tsx`, and whatever spec or test mentions it.
- [ ] **Custom logomarks on desktop** (author 2026-11-01): let a desktop user replace each of the app's logomarks (the wordmark, the mark in the menu bar and top bar, the app-menu trigger, the help dialogs' and the site nav's marks; `TopBar.tsx`, `MenuBar.tsx`, `HelpDialogs.tsx`, `siteNav.tsx`) with their own SVG of exactly the same size, refused when its box differs. Desktop only (it reads a local file); kept per install, with a way back to the default.
- [ ] **Rename List Sort and List Filter to Sort and Filter**, beside Frame Sort and Frame Filter: both take tables now, so "List" no longer describes them. Update the seeds and the catalog.
- [ ] **Collapsed-card rules, the stragglers**: the solver cards (TVM, Compound Growth, Effective Rate, Ohm's Law, dBm/W, Wavelength/Frequency, Ideal Gas, Moles/Mass, pH) collapse to a row per variable instead of one pill, since each variable is both input and output; Expect, Grid Painter, Curve, Point Plotter, RANDARRAY, Color and Resistor keep settings visible when collapsed.
- [ ] **Expanding a group never leaves an overlap** ([[C112]] noOverlapsEver): with "Auto-arrange groups on expand" off, the setting also turns off the overlap cleanup, so an expanded group can sit on its neighbors. Off should skip the big push but still move a covered card just clear.
- [ ] **Fix titles that come out of code names**: "IFError" → "If Error"; Mat Det (MDETERM, MINVERSE, TRACE, NORM, MATRIXRANK) and MRound (MROUND, CEILING, FLOOR) get family names; automatic naming learns acronyms and hyphens ("URL Encode", "E-Series"). A bad family name is fixed by renaming the class (`../tree/specs/canvas/add-menu.md`).
- [ ] **The app's own tooltip** in place of the 469 system ones: on the Linux desktop app they're huge and instant, since WebKitGTK hands them to the system. Not urgent.
- [ ] **A collapsed card's input pill lists every cable on hover**, not just the first (after the Obsidian work; needs a design). The same note floats a Conduit that bundles into a Cube.
- [ ] **Softer canvas dots on the Linux desktop app**: WebKitGTK draws the tiny background circles with harsher edges than Chrome. Give that engine its own dot color or size, the way its zoom fixes are already set.
- [ ] **Surface rotation in a Display** ([[C100]] chartIsAValue): a Display carries every control that belongs to a rendered chart object (`../tree/specs/computation/chart-figures.md` § Display), but the 3-D Surface's rotate and Home buttons live only on `SurfaceNode.tsx`. Give the Display the same buttons for a surface chart, writing `yaw` and `pitch` back to the upstream Surface node the way `recordNav` steps the upstream Record node. Then delete the spec's exception sentence. Also check the chart popup and Report embeds for other in-figure controls they drop.
- [ ] **Sideways phone: verify on the S25+ (2026-10-04, untestable headless):** the scale watchdog against the right-side
  cut-off, the fullscreen chrome zoom and its 18px corner inset ([[layout-chrome#Phones in landscape]]). Open asks: refit the
  camera on rotate; a service worker if Android Chrome still won't offer Install; the six-rung mark for the desktop icon.
  Also on the phone: a pinch whose leftover finger lifts on a card no longer selects it (fixed by reading, untested headless).

- [ ] **Hand-tidied groups then a canvas Tidy, twice, moved personal finance ~530 px** (2026-09-30). A canvas Tidy run twice from the seed is a fixed point now (`tidy-drift-probe.mjs personal-finance`, 2026-10-26); the path that tidies each group by hand first is still unchecked.

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
live in specs.
- [ ] **Author ratifies the tree, one leaf at a time** — A1, B1, B2, B3, B7, C80, D62 and E10 are ratified.
  New today and unseen by the author: B18 safeToShare, B19 spreadsheetHabits. Next: the rest of ring B, then C.
  Ratifying adds the ID to `OWNER_RATIFIED` in `rules.test.ts`.
- [ ] **The outbox still lists A1, B1, B2, B3, B7 as ratified with no History line**: the author cleared those
  leaves' History by hand and will handle History themselves; leave them.
- [ ] **81 inbox items** await the author (each says what ratifying it changes, with a lean); the 2026-10-26 backlog sweep moved every decision-gated item there.
- [ ] **Author places `tree/decisions/inbox/scope-boundary.md`** (proposed ring A); then `out-of-scope.md`'s 13
  categories become B leaves and that doc goes.
- [ ] **C80 blankArgIsExcelBlank still hangs off A5** (author-ratified): its natural parent is [[B16]]
  oneFormulaSurface. The one skipped-ring finding left.
- [ ] **Two author-held `*Where:*` lines remain** (B7, C80). The author deletes them or rules they stay.
- [ ] **Optional:** `python tools/dte.py hook` (pre-commit validate) — not installed; `validate` is not in CI.

## Formatting & units
- [ ] **Socket labels lose their parentheses** (`../tree/specs/canvas/add-menu.md` states the rule): "T (K)", "(UTC)", "Marker size (px)" become "T" and so on, the unit moving to the Inspector's socket description; math notation stays. The lambda-argument hints ("Values (value)") are a written exception to the label rule, so moving them also deletes that exception.
- [ ] **Units in column headers are invisible** (author 2026-10-29): a number column named `Price (USD)` becomes `Price` tagged USD (`parseColumnUnitFromHeader`, `unitColumn.ts`; `../tree/specs/computation/frame-verbs.md` § Units and formats), but nothing in the UI says so. Find every path that reads a header this way (`buildFrame`, Build Frame, `addColumn`, CSV and pasted headers?), then decide whether it stays and, if so, how the user learns it: a hint in the column-name field, the Reference docs, or a notice when a header turns into a unit.

- [ ] **Cards that strip units** ([[C25]] firstClassUnits): 33 of about 317 card classes are `unitAware` (the money finance cards joined under [[C25]] firstClassUnits); the rest read the numbers their inputs show and answer plain numbers, the boundary's fallback. Each family is owed carrying, as its formula functions do; do them family by family, a unit test per card. CEILING.MATH, QUOTIENT and EVEN in formulas likewise still sit in unit-flow's "any other function" row.


## Frame popup (follow-ups from the 2026-09-19 header session)
- [ ] **A blank Frame's CSV view starts empty, and its header line looks like one** (author 2026-10-29): today it opens with an empty header line, so pasting `name,age` and rows makes `name,age` the first data row under blank names. Start empty, so a paste's first line becomes the column names, with a test of pasting into a blank Frame. In the CSV editor, set the first line apart as the header (a slightly darker band or similar, per DESIGN.md), so it's clear which line names the columns. Frames only: a table (matrix) has no header row.
- [ ] **Cards view previews nested cells** (asked 2026-10-05): a cell holding a list, table or Cube shows its first few names, a tiny table or a count ("12 orders") beside the chip. The layout is a design call, and Cards' row layout rules need writing first.
- [ ] **The editing footer's Insert and Delete menus are pills**, matching the toggles beside them; Cancel and Save keep their dialog-button style.

- [ ] **The formula highlighter paints a called λ socket (`λ1(`) as an unknown function** (`identClass`,
  formulaSyntax.ts). No surface shows it today (the popup's formula field is a plain input); fix it the day a
  highlighted editor edits a Frame Input column formula.
- [ ] **Pivot view follow-ups** ([[C127]] pivotView, built 2026-10-20): fold column items as rows fold; sort an
  axis from its header (Configure Fields holds the sort today); Excel's "Merge and center cells with labels";
  drill-through from a value cell (Details lists a leaf's rows; a cell's rows also split by its column item), and
  Details on a subtotal or the grand total.

## Packs
- [ ] **Save names inside a composite, scoped to it** (`../tree/specs/computation/composite-nodes.md` § Names belong to their composite): today a named inner card gets a fresh default name on reload or a drill-in undo. Save `name` in the snapshot, scope it to the composite (it may repeat a main-canvas name), and resolve a formula's names inside its own composite first.
- [ ] **Custom pack format and loading**: write down the file format of a custom pack and load the folder Settings already shows, so a pack saved there shows its cards in the Add menu. Waits on file access.
- [ ] **Optimize run mode for composites**, like Excel's Solver: the inputs that make a result as large or small as possible within constraints, no whole-number constraints. In, but not yet; how constraints are written is open.
- [ ] **Pack cards convert wired units** ([[C25]] firstClassUnits): each physical input states its unit (Standard Atmosphere's altitude in meters), a wired value converts into it, a bare number is taken as in it, the wrong kind is `#UNIT!`, and answers carry units. Today "2 km" reads as 2 m and "5 GHz" as 5 Hz, and the cards disagree with their own formulas.
- [ ] **Preset units, the rest** (`../tree/specs/values/unit-flow.md` § formula presets): coulomb, farad, mAh and bpm inputs still wait for units the app knows, and the presets' result units are the next step.

- [ ] **LOW — variable definitions on every pack Expression** (author 2026-09-24): fill `varDescriptions` on each
  pack formula entry (`packShared.ts`); the card already shows them. Only a handful of entries have them now (EM's
  wavelength, a few Timesavers). Metadata only, DESIGN.md §7 voice; pairs well with the pack-units lead below.



