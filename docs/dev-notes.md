# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-11-18b: the optimization suite's UI, the Solver in depth, a recalc leak, Plan C, HTML Page; cloud session)
**Solver** ([[frame-verbs#Solver]], pinned in `solver.test.ts` against exact answers)
- Limits are a saved `limitList`, edited in a PIVOTBY-style popup a sentence each and listed on the card in the pipeline
  stepper. A limit measures a Total, weighted Average, Share, Number used or Each option's, once or **for each** group,
  its number typed or read from a column ("at most its Supply"). Also Balance across (minimax) and Min If Used.
- The goal can be a formula of each option's amount (separable pieces, a switch per kink only: a switch per piece took
  20,000 branches and 29 s on a setup fee) or of the plan's totals (trust-region sequential LP from six starts, a local
  best, said so in the status). An independent review found five more bugs, all fixed and pinned.
- Lesson: a Share bug (always 100% without For each) was found by building the feed-blend example, not by the tests.
  Build the example.

**Greedy Queue and Local Search**
- **Configuration popups** ([[config-popups]]): the cards keep their tables, folded Formulas, Numbers and Columns
  sections, an accent Edit Rules button and their rules as plain stepper lines; every setting is asked in a popup on a
  shared kit (`RulesPopup.tsx`), which Solver's Limits use too. The author's rules for it are in the spec (no row hides
  when a cable lands, no caret on a non-dropdown, the app's touch sizes, one phone layout, guide-line hierarchy). The
  configPopup leaf the author asked for was refused twice by the leaf hook as feature design; the rule lives in the spec.
- **Transitions** (was Legs; author: "does it have to be roads?"): the cost of taking an item after another, by name, in
  any unit; Unlisted pairs go through others (a road network) or are refused (a changeover table).
- The rules summary says only what the engine does: "then by formula" when the Order formula breaks ties, a budget only
  once the engine ran with one (a wired blank Budget is none; `cachedOver` is blank then).

**Strings** (DESIGN.md § Voice): a setting's label is a noun phrase, the noun last (Unlisted pairs, Turn order, Oversize
items; Column total, Lower-is-better columns, On-time share). Labels name the quantity, never the unit (Staffing's Arrival
rate, Job time, Target wait; "socket labels carry no parentheticals", [[add-menu]]): the socket's description says what a plain
number is read in, and a wired value with any unit converts. **Pick Columns** is Keep/Drop
Columns' class (`PickColumnsNode`), so the header's hover names it; Columns stays the menu category.

**A leak on every recalculation** (`nodes/refs.rs` `preview`, pinned by `a_ref_goes_once_nothing_holds_it_or_its_preview`):
a lazy frame cached its card-face preview, and the preview names the frame as its source, so the two held each other
and every recalc left a frame behind (+19 MB a pass on the service-territory Monte Carlo; the main canvas the same per
edit). The ref now keeps its preview weakly. How it was found, for the next one: a counting global allocator and a
FrameRef live count (temporary, not committed); live bytes, not wasm memory size, separate a held value from
fragmentation, and bisecting the graph by card narrowed it to any lazy frame. `computeAll` never sends JavaScript's
collected ids (`forgetCollected`), only `pass` does, so a harness that loops `computeAll` sees the kept map grow on its own.

**Service territory, Plan C** (`scripts/service-territory/gen-baseline.mjs`, then the seed): an Operators table with home
bases and a Capacity (292 incidents a year: one job a day, kept 80% busy); every site paired with every operator within
250 miles, costed in incident-miles; the Solver picks one whole operator a site for the fewest, none past Capacity.
Without Capacity it is each site's nearest base, which is Plan B: the cap makes it a plan (three Houston-area sites move
to OP-01). The 250-mile prefilter cuts 2,500 pairs to 866 and the solve from 7 s to under 1 with the same answer; at
7 s, four engine tests that load the seed timed out in CI. The Monte Carlo runs all three plans on the same incidents:
Plan B saves about 109 drive hours a year, Plan C about 102, and all leave about 3 incidents open, within noise.

**Solenoid Properties ships a guide for agents** ([[obsidian-plugin#The guide for agents]], `agentGuide.ts`): each data
object type's YAML, `types.json`, the rules a value follows, column types and Knap notes, every example checked against
the plugin's validator and Solenoid's note reader. Written to the plugin's folder as AGENTS.md when its text changes,
as a note on command, and by `api.agentGuide()`. `plugin:lint` had drifted to 3 errors that would fail the directory's
review; it holds 0 again. Ships with the next plugin release (version and What's New are the author's step).

**Also:** sockets re-measure when a late row moves them (`flow/remeasure.ts`); Shortest Path's every-place view writes
each Route out and totals it; the optimize seed gained an ad budget, a shipping plan and a feed blend; fourteen
plain-language asks from an agent with no Solenoid context were built end to end and checked against brute force.

**HTML Page** ([[reports-and-notes#HTML pages]], `nodes/htmlPage.ts`, the author's idea): a page from an `.html` and a
`.css` in the data folder, each `{{ name }}` an input, shown full screen like a Dashboard, a figure wired in drawn as a
Dashboard box. The CSS is scoped to the page and can't fetch; each tag's print is escaped after its filters
(`renderKnapHtml`; escaping the inputs first broke `upper` and `length`); scripts never run. A page sets the app's color and
font variables, plus `--chart-1`… and `--chart-font-scale`, and figures read them from their own slot (`FigureScope`), so a
page's charts take its palette and type; `.sol-box`, `.sol-box__label`, `.sol-box__title` are the names a page styles; an
in-page `#id` link scrolls the page. Pictures and fonts a page names (`src`, CSS `url()`, `@font-face`) are read from
the data folder and inlined as `data:` URIs, from tags only (a `src` shown as text stays text); Print prints the page
alone. A bare tag inside an attribute prints as text; `prefers-color-scheme` follows the app's theme; an open page
re-reads its files on window focus; on the desktop, New page writes a starter pair under `pages/` (not yet eyeballed in
the desktop build). Links between pages (`pageLink`): a sibling `.html` opens the card showing
it, a web link opens outside the app, nothing moves the app's address. Figures a page restyles now include the US Map
(land, borders, ink) and a Waterfall's or Candlestick's rise, fall and total (`--chart-up`, `--chart-down`,
`--chart-neutral`). The showcase is eleven pages: Contents, the guide, the six earlier, a road trip (US Map), an annual
report (Sankey, Waterfall, Gauge) and a year of running (Calendar Heatmap, KPI; `runs-2026.csv` in the demo vault). A
slot is a `span`, so a page's rule for `span` reaches it (the guide says so). Audit, 2026-11-19: a page has the whole window (one back button, Back steps
through the pages, Ctrl+P prints, focus moves into the page); CSS scoping no longer leaks after `@charset` or `@layer
a, b;` or inside `@scope`, and splits selectors only on top-level commas; the sanitizer drops `<form>` (pages, Notes,
Reports); a light page in the dark app gets a readable tooltip; every showcase page passes a 3:1 text-contrast sweep in
both themes (the script is ad hoc, not in the repo; `oklch()` colors read wrong in it). The HTML Showcase example renders seven pages from `demo-vault/Data/pages/` (a one-pager, a project brief, a team
directory, a shop catalog, an invoice, a money letter and "Writing a page", a guide that is itself a page), with
OFL fonts and pictures in `pages/fonts` and `pages/images`, which the web build bundles (`DEMO_VAULT_BINARY`).

**Open, the author's call:** the Monte Carlo composite mode varies only inputs marked uncertain, so the seed's RAND-inside
simulation can't use it (Data Table over a Run index stands in); Staffing's In Time column could read On Time; the
dispatch simulation still starts each operator at their first job, not their home base; Plan C's capacity (292) is a
starting point. **Not done:** a limit that is itself a formula; a composite optimize mode (a goal no one formula can
say); shadow prices for averages, shares and counts; chart axes ignore a column's percent format.

### SESSION DIGEST (2026-11-18: a cut of tests with no lasting value; cloud session)
- About 95 test blocks went (plus ~85 loop-generated cases), none of them the only pin of live behavior: duplicates (the `LEGACY_ALIASES` loop in
  `formulaTier1.test.ts` already holds every blocked spelling; `searchSamples` holds the search queries; the frozen node
  fixtures hold 18 `widgetBodies` cases, confirmed by `scripts/answer-tests.mjs --list`), Formula.js-era and rete-era
  pins, tombstones for one retired name each (the picker `arg` prop, `INPUT_ROW_TOP`, the RUNNING* and per-distribution
  ids), answer-free recorder feeds in `computedColumnPaths`, a source-text pin in `touchActions`, a frozen 1.6 release
  checklist, and two benches of paths the app no longer runs (`perfScaling`, `cardBatchBench`; `passBench` is the bench).
- Dead code that only its test kept alive went with it: `cssColor.ts`, `stripUnitCells` (the core's `strip_unit_cells`
  does the strip), `logicalOrTypeError` (the core's `logical_or_type_error`), and the old whole-library key cleanup in
  `documentStore.restore()` (a migration, [[B7]]).
- Looked at and kept: the lazy-vs-eager parity in `frameNodeBackend`, the 200k-row window/aggregate guards in
  `frameVerbsEdge`, `pfSeedCheck`'s demo-data sums, `coreTextForm`'s seed round-trip (it reaches pack seeds
  `textForm.test.ts` does not), and `distributions.test.ts` (answer-tests finds calls not frozen). Not yet frozen and so
  TS-only pins: the Optimize cards (Solver, Assignment, Shortest Path, Pareto, Staffing, Greedy Queue, Local Search).
- `answer-tests.mjs` is conservative by file: one JS card in a file (`SvgPickerNode`) skips the whole file, and a helper
  calling `magnitudeOf`/`dimOf`/`parseDateToSerial`/`formatDim` or assigning `.mode =` keeps a test. Running it per test
  on `convert`, `colorBlend` and `distributionInvariants` is the next pass.
- That pass ran (a scratch copy of `answer-tests.mjs`: per-test JS-card check, `magnitudeOf`/`dimOf`/`parseDateToSerial`/
  `solDate`/`isUnitCell` as value inspectors, a `.mode`/`.op` set before the call allowed): 29 more card tests, every
  call frozen and answering the same, mostly chart payloads in `visual.test.ts`. The rest of `convert` and
  `distributionInvariants` stays: their calls are not all frozen. Also gone: an empty test left in `taskNotesWrite` when
  `parseWrittenTaskPath` was deleted. Sweeps that found nothing more: whole-test copy-paste, tests with no assertion,
  opt-in suites nothing sets, and the core's inline `#[cfg(test)]` modules. `buildModel` (`flow/flowModel.ts`) has no
  caller in `src`: a test-only loader beside `persistence.loadGraph`.
- Every vitest run now ends with a per-area summary (`tests/setup/bucketReporter.ts`, wired in `vitest.config.ts`):
  each of the 11 domains in `tests/buckets.mjs` as ✓, ✗ with its failing tests named, or `not run`, and no counts.
  A `--reporter=` flag on the command line replaces it, as it replaces the default.
- Cargo too: `scripts/cargo-test.mjs` wraps `cargo test` (CI's core and graph steps, `check-rust.sh --test`) and
  ends with each test binary's plain name, ✓ or ✗ with the failed tests, also on the job's summary page on GitHub.
  `cargoLabels.test.ts` fails a core or graph test file with no name in its `LABELS`.

### SESSION DIGEST (2026-11-17b: the US Map card, a service-territory baseline; cloud session)
- **Greedy Queue** (`GreedyQueueNode`, `nodes/queue.rs`, [[frame-verbs#Greedy Queue]]): the sequential loop of a
  run-optimization model, generic; the rule is LAMBDA cards (Order by, a number or a list sorted in turn; Cost; Allowed)
  over the item's columns, `last_` (the group's last pick), `group_` (its Start row), `wait`, `step`, `used`. Groups take
  turns or best pair first; budget a step with stop or skip on a misfit; blank group = shared; blank Steps = until done.
  The **Greedy Queue: three run problems** seed (`scripts/greedy-queue/gen-examples.mjs`): a job shop (earliest due
  4 days late in total vs shortest first 37), truck loading (first-fit decreasing 12 trucks vs 14), a route (nearest
  next 310 km vs 684). It replaced a dispatch-only card from the same day, which buried the rule in Rust.
- **Local Search** (`LocalSearchNode`, `nodes/improve.rs`, [[frame-verbs#Local Search]]): the improvement half (OR-Tools'
  first solution, then local search). Moves: move (relocate), swap, flip (2-opt), between groups or within; fewer
  Allowed refusals first, then the lower total; Cost reads `before`/`position`, Penalty reads `at`. With no formula
  reading those, a move is scored by its links, O(1); else by walking from the change. 250 stops: nearest-next 14,693
  to 12,595 in well under a second. Not built: a metaheuristic past the local optimum (guided local search,
  annealing). The seed is now "Greedy Queue and Local Search: three run problems", each problem three flat groups
  (shared, not optimized, optimized) with a note each; the job shop's earliest-due plan goes 2.0 to 0.8 days late by
  the hour. Both cards' copy is plain English (dropdowns included). A value-axis bound set alone now keeps the other
  at the axis' default (floor 0), so `ymax` alone no longer lifts a Column chart's floor to its smallest bar.
  `validate-graph` flags a group inside a group (groups don't nest; the tidy scatters one).
- **Rules that are only a column are picked, not written** (author: a formula card that names a column is a UI gap).
  Greedy Queue's Order by is a column with Smallest first / Largest first, an Order formula (a LAMBDA) after it or alone; Cost (both
  cards) is a column plus an optional Cost formula. Conditions are named value cards ("Hours a machine works a day")
  wired into Budget and the rest, and both cards show a wired card's whole name. Picks lead with their question
  (`AskSelect`: "If an item won't fit" Stop / Skip it). Typed-in-place formulas were tried and refused (author).
  Notes are the last resort: the seed keeps one per problem for what no card shows.
- **Local Search runs of 2 and 3** (Or-opt) beside single moves: 250 random stops 12,595 to 12,375 km at no
  measurable time. **Greedy Queue guards:** a Budget with no Cost is `#VALUE!`; picks over the budget on their own
  (a step's first always goes) show as an **Over budget** count on the card.
- **Plan B on the same incidents** (service-territory seed): Plan B Operator is a visible column (crossovers back to
  the nearest operator; the outliers were already their nearest's, so moving them saved exactly 0). Each run feeds one
  draw of incidents to both queues, so the saving is paired (common random numbers): 110 h a year ± 6.7, where one
  plan's own total carries ± 23.
- **CI's Test was red from 11a3e6788** (`graphDelta`, `graphEditReach` timing out at 20 s on the greedy-queue seed: 12.5 s
  here). The job-shop Local Search ran its formulas in the slow (walking) path with every name built per call. Now
  `Body::call_by` builds only the names a LAMBDA reads, walking formulas keep answers by their place, a changed
  walk stops where it rejoins the old one, and don't-look bits skip settled items: 1.4 s. **Search: Quick /
  Thorough** (guided local search, bounded at 10x the Quick work) is never worse; a choice because it costs time.
- **An Optimize category** (Frames): Greedy Queue, Local Search, and four new cards. **Solver** (`nodes/solver.rs`,
  engine `crate::lp`): Excel's Simplex LP from an Options table (Min, Max, Whole by name) and limits (since 18b, the
  card's own, edited in a popup), with Used, Slack and Shadow Price; branch and bound for Whole.
  **Assignment** (Hungarian), **Shortest Path** (Dijkstra; From/To columns by name), **Pareto Front**. A csv field
  reads through `Call::csv_text`, not `unwired` (which answers Undef for it).
- **Staffing (Erlang C)** joins Optimize: arrivals, minutes a job, target wait and share in; a row per server count
  and the fewest that meet the share out (checked against Erlang C computed directly). The **Optimize seed**
  (`scripts/optimize/gen-seed.mjs`) has six problems: a roast mix with shadow prices, a project portfolio, crews to
  jobs, a road route, plans worth weighing, dispatchers on shift. Seeds now use SUM, ROUND, AVERAGE, STDEV.S,
  CONFIDENCE.NORM, Range and Running cards where they had single-function Expressions. Not done: a Gantt of the
  job shop (it works in machine hours; the Gantt needs dates, and a job crossing a day's end needs a split).
- **Units through the optimization cards** ([[C25]] firstClassUnits; `nodes/measure.rs`, unit-flow § Optimization
  cards): every cost, total, Best, Used, path and wait carries its column's unit, a plain number takes the other's unit
  as arithmetic does, two dimensions refuse with `#UNIT!`. Found by reading the tree: the cards had dropped units
  everywhere (a kg budget beside hour costs passed). The seeds now key units in their tables ("Hours (h)").
- **Engine checks**: `lp.rs` runs 300 random whole-number programs against every integer point, 300 random programs
  against their duals (feasible, equal to the best total: the shadow prices hold), 200 assignments against every
  permutation. The Solver's size cap is the tableau's (25 million cells): a 40 × 40 transport plan solves in < 1 s.
- **Service-territory step 2** (`scripts/service-territory/sim-graph.mjs`, in the seed): a Data Table Composite, a pass
  per run (sites × days, a draw each, then the Greedy Queue); 50 runs solve in ~2 s and settle near 2,350 drive hours
  a year, ±0.9 %. Past ~60 passes the core-table leak in `docs/backlog.md` § Performance slows it. Not done: common
  random numbers (a seeded draw) to compare assignments on the same incidents. Pooled dispatch (best pair first)
  measured ~3,500 h a year against ~2,330 for the territories; the author's real problem assigns by set lists.
- **Pivot inside Markdown**: `.sol-md`'s table rules out-ranked the Pivot view's in Dashboard boxes and Reports
  (collapsed borders, so a seam beside the frozen column); its grid rules now sit under `.pivot-view`.
- Tooling: `run-graph --solve`; `shot-graph --eval`, `--hscroll`, `--wheel`; the grounding names every card of a
  class of up to four (Keep Columns was invisible to `--list`).

- **US Map** (`UsMapNode`, `us_map` in `nodes/visual.rs`, op `usmap`): a pin per frame row on the states, Lower 48 or All 50 on a
  `scope` toggle, `c`/`s`/`annotate` plus new `lat`/`lon` option keys. The projection is d3's `geoAlbersUsa` written out
  (`geo/albersUsa.ts`, pinned to d3 in a test); outlines are `geo/usStates.json` (44 KB, lazy, `scripts/gen-us-states.mjs`).
  Spec: [[chart-figures#US Map]]. Not done: a Chart Builder target, and a fit-to-pins view (a regional data set draws small).
- **`.ownwheel`** ([[pointer-gestures#Opt-out classes]]): a figure that zooms itself takes the wheel only while its card is
  selected, so a map passed over never traps canvas zoom. `shot-graph` gained `--wheel <css> <dy>` to check it.
- **`scripts/service-territory/`** and the **Service territory baseline** seed (Modeling; temporary, the author will remove it): a seeded 250-site baseline (`gen-baseline.mjs`; 113 west, mostly spread over southeast Texas with about 20 in
  Arkansas, 137 east; none in Mississippi, west Tennessee or the Gulf; 20 crossovers) for a dispatch Monte Carlo, with an
  Operator Load Composite and two maps. No home bases: service starts at a site, so the graph carries no distances yet. Friction worth a look: PIVOTBY renames values to `Sum of …`, and a later
  `@[Old Name]` reads 0 quietly rather than `#REF!` (the documented unknown-name-is-an-input rule, but here it hid a real slip).

### SESSION DIGEST (2026-11-17: React Flow 13.0.1; cloud session)

- **React Flow is 13.0.1, `@xyflow/system` 1.0.0** (exact, as RF pins it): bleeding-edge's next.3 port (`3374277`) carried to the
  stable release. The split stores, changesets and `forceColorMode` are as that finding had them; the stable release added two
  things it didn't: a bare-number fit padding is pixels (every fit now passes RF 12's fraction as the same-zoom percentage,
  [[react-flow-surface-contract#What RF owns]]), and the pane cursor lives on `::before`. `elevateEdgesOnSelect` is held at false.
- Checked live (card drag, grip resize, socket drag, pane cursor, theme, minimap) and the full suite. Not re-measured: the frame
  cost the split stores should save (`docs/canvas-frame-cost-findings.md` § 4).
