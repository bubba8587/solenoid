# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-24: adversarial review rounds over the tree and specs; author checking in)

- **What stands:** about 20 reviewer branches, one slice each (compute, frames, values, documents, canvas,
  charts, chrome, composites, Obsidian, node classes, packs), checked code against specs and nodes; well over
  100 bugs fixed with tests, specs corrected where the code was right. Full suite about 6500 tests, green
  under `--sequence.shuffle`; `dte validate`, `coverage --check` and `cargo test --lib` green.
- **Author rulings, author present:** GROUPBY min/max over text is alphabetical ([[D76]] textMinMax); constants
  always win in a LAMBDA and a parameter named `e`/`pi`/`tau`/`phi` is `#NAME?` ([[D77]] constantsAlwaysWin,
  reversing two agent commits); the list Group By is Group Lists all the way down and prose calls the frame
  card GROUPBY; the Group card is Node Group; questions for the author go to `tree/decisions/inbox/`, never chat.
- **Tree:** the author's outbox notes were processed: D4 rewritten plainly with E1 folded in, E2 into D13 and the
  lattice spec, E4 into D15 and the spec, E5's Why says why Any Matrix can't stand in. New: [[C112]]
  noOverlapsEver (every layout op ends with `separateAll`). Contested and kept: C16, D29, C85, C89, D63, C112,
  C11 (Conduit lane exception), C43 (names its hooks), C95.
- **Units:** °C/°F are classified statically (`affineWeight`): a reading plus a number is a reading, two readings
  subtract to a delta in K, two readings added are `#UNIT!` (`READINGS_ADD`) on every surface: formulas, the
  Arithmetic and Aggregate cards, frame verbs on both engines (`readingScale` on the wire), computed columns.
  Expression computes in a shared linear display unit; a function the dimension pass doesn't know refuses a
  united argument; lookups carry their return column's unit.
- **Engines:** the frame-verb fuzzer covers window, fill, replace, slice, bind and cross join; every divergence it
  found is a named corpus case.
- **Saves and edits:** keys with `.`/`λ`/`-` are quoted in the text form (a save could break for good); literals
  no longer enter `init`; composites keep inner references, nested composites, FC docks and store state across
  reload, wrap and undo; one delete path for main canvas and drill-in; paste works from a snapshot.
- **Tests:** a `vi.mock` file outside ISOLATED fails `sourceInvariants.test.ts`; the flaky shared-pool failures
  are gone.
- **Late merges:** the webpage export escapes values after rendering and embeds images; open drafts flush before a
  switch, save or close (`draftFlush.ts`); composite inner cards keep size, collapse and flip (`savedNodeBody.ts`);
  Thermo presets declare their input units (`readInDeclaredUnit`); Triangle Solver solves in one unit; FIXED rounds
  like ROUND.
- **Open:** 30 inbox items await the author. A DTE tool patch (processed outbox items leave a review card in the
  inbox; a node dragged into `outbox/` stays a node) is stashed, not applied, pending the author's go.

### SESSION DIGEST (2026-09-23: decisions, specs and code comments lined up; author away)

- **What stands:** each fact has one home. Rulings and reasons live in `tree/decisions/`, mechanics in
  `tree/specs/`, and code keeps only one-sentence line constraints (`tree/specs/floors/engineering.md` § Comments). About 14,000
  comment lines left roughly 820 files, comment-only (verified token-for-token against the parse tree); what
  they said landed in a spec or node first. tsc, the full vitest suite, `dte validate` and `coverage --check`
  are green.
- **Tree:** C72 merged into B11 and C104 into C103; D73 nodeCoversFormula split out of C17; new C109
  linuxOwnWindowControls and D74 webkitgtkNoNodeLayers give the Linux window chrome its reasons. About 30
  nodes gained a Why or a correction from the lift, each with a History line. The E14 vs C48 stack merge is
  deferred (`deferrals.md`).
- **Specs:** `format-model`, `value-semantics`, `layout-chrome` and `touch-gestures` moved into the vault and
  are cited as wikilinks. New: `table-popup`, `palette-and-theme`, `command-palette`, `outline-panel`. Nearly
  every other spec was restructured for reading in Obsidian with no fact dropped. Stale
  "subsystem-invariants §" pointers across docs now name the spec itself.
- **Tests:** the suite runs in about 15s instead of about 100s. `vitest.config.ts` splits a shared project
  (`isolate: false`, reset by `tests/setup/sharedWorker.ts`) from a short isolated list of files that need
  a fresh module graph.
- **Code fixes riding along:** the Composed chart draws its legend below the plot like Scatter; the
  HTML-in-Canvas renderer draws `anycombo` as a split square like the DOM socket.
- **Comment-lift suspects:** fixed or ruled (`a6cb19b2`); the last one, Range including Stop, is now
  [[C110]] rangeIncludesStop on the author's reason (not an Excel function, so it matches LinSpace).
- **Author rulings, author present:** C90 retired (the drawn-cables spec covers its files); D62 ratified;
  Conduit N and the Slider's per-change speed are exceptions under D22 and C95; op switches stop writing
  `node.label` (a sweep in `sourceInvariants.test.ts` holds it, [[D22]]).
- **Demo data:** Local File's folder falls back to the demo vault's `Data` like the vault does ([[C1]]), and
  Personal Finance reads its CSVs from there with Local File cards. The demo vault serves
  `.obsidian/types.json` and `daily-notes.json`, so demo reads match a real vault.
- **Formula side:** every kernel a pack formula calls lives in a rete-free `nodes/*Ops.ts`, each pack's
  formulas in `packs/<id>Formulas.ts`, and `formulaPathIsReteFree.test.ts` roots at them (`../tree/specs/floors/engineering.md` § The formula path is rete-free).
- **Site:** the Packs and Examples pages render from `BUILTIN_PACKS` and `SEED_GROUPS`; the Obsidian page
  leads with Solenoid Properties, a live panel of the plugin's own `PropertyChip` over the demo vault; each
  page gets its own title and link-preview tags (`siteMeta.ts`, `<page>.html`, `vercel.json`). Phone
  layout: the scene thread hides in one column and scene frames cap at 82vw. The author's own copy is theirs:
  flag, don't rewrite ("turbocharges" restored).
- **Also:** the Schedule and Gantt spec is in the vault (`schedule-and-gantt`); dependencies are on latest,
  `mermaid` 12 with a `lodash-es` override. **For the author:** C70's per-row faults vs the whole-run error,
  and Local File's grammar-text Predecessors (both in the backlog).
- **Charts:** every figure the Chart Builder titles now draws its title, and the Sankey, KPI and Gauge cards
  render through `ChartFigure`, so options apply on the card ([[D75]] builderExposesEveryOption: a type's
  builder keys are exactly what its renderer honors; `chartTitles.test.ts`). The audit made alpha, radar,
  canvas-figure fontsize and the Gantt view keys real. Sankey merges repeated From/To pairs (`mergeFlows`)
  and lifts a flow on hover. Every chart card, Chart Builder, Mermaid and Record included, is the chart
  kind; an unfiled card with one non-numeric output wears its output's color ([[C111]]).
