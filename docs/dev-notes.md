# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-23: decisions, specs and code comments lined up; author away)

- **What stands:** each fact has one home. Rulings and reasons live in `tree/decisions/`, mechanics in
  `tree/specs/`, and code keeps only one-sentence line constraints ([[C57]] commentMinimalism). About 14,000
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
  formulas in `packs/<id>Formulas.ts`, and `formulaPathIsReteFree.test.ts` roots at them ([[D19]]).
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

### SESSION DIGEST (2026-09-22d: fixing what the rebuild specs found; author away)

- **What stands:** the backlog section "Found writing the rebuild specs" is empty; each item was fixed or
  ruled, and its spec says what the code now does. Every round ran tsc, the full vitest suite, `dte validate`
  and, when the engine changed, `cargo test --lib`.
- **Two engines, one answer:** units ride through the desktop's native verbs (schema shadows in
  `PolarsBackend`), Join and Nest Join compare unit keys as quantities (`joinKeyTransform`, #UNIT! across
  dimensions), a join keeps every column's unit and format, Window reads NaN as blank on both engines,
  and share / pct_change agree on blanks. A parity fuzz (every corpus case re-run with NaN, infinities, blanks
  and -0 added, prepended, or with every cell blank) found one more break, NaN order keys in the ranks, now
  fixed. The generator lives in the session scratchpad, not the repo.
- **Formulas:** LAMBDA parameters shadow names and constants, a blank scalar argument gives a blank answer
  while an empty argument slot does not, arithmetic on text is #VALUE! with advice, malformed numbers are
  lexed as errors.
- **Documents:** composites re-save byte-identical (saved ids), `seedStore.ts` and `SavedGraph.seedId` are
  gone, the save version is one constant, a Placeholder's references follow renames. Reports export and write
  to Obsidian what the card shows (format picks, highlights, frames as tables, frontmatter stripped); an empty
  merge writes nothing; a blank page name numbers off the sink's name.
- **Canvas:** Composed and Bubble honor the axis options the Chart Builder offers; the pointer census drops
  stranded fingers (a primary touch or a window blur); expand push leaves the user's own overlaps alone;
  standoffs draw under nodes.
- **Ruled, not changed:** a one-element list collapsing on scalar rungs is D13's design, and Frames and Cubes
  crossing the unit boundary untouched is the design (compute-pass spec). E14's stack-merge line stands (the
  merge hasn't landed).

### SESSION DIGEST (2026-09-22c: DTE and specs, merged and made rebuildable; author present)

- **What stands:** the tree has one node per decision. Merged into survivors: D8→D7, D44→D45, E3→D15,
  C56→C26, D2→C1, C12→C11, and the seven HTML-in-Canvas tuning nodes D55–D61→C42 (their knobs now live in
  `../tree/specs/canvas/html-in-canvas.md`). C52's audit half became C108 auditDefaultsToFix. Every unratified node below
  ring A was rewritten for plain reading; the Why no longer restates the Decision.
- **The rebuild test:** five new specs cover the computational core, written from the code: `compute-pass`,
  `formula-language`, `computed-columns`, `frame-verbs`, `save-format`. Every other spec was rewritten, and
  the thin ones (conduit faces, input-cable pruning, live connections, stores) now state behavior.
  `subsystem-invariants.md` is one table; the docs that held pieces of these specs point at them.
- **Nodes corrected against code:** C60 (Running has no mode toggle), C63 (Record's views are ops), C62,
  C65 (the standoff depth isn't set anywhere; labeled), C95, C1, C45 (ordering is case-sensitive), C48,
  C51, C61, C72, D10, D20, D22, B16.
- **Open:** node candidates the spec writers flagged (sections of `../tree/specs/documents/literal-input-editors.md`,
  the drawn-cable rulings) are unmoved. Still without a spec: the node families (`node-coverage.md`
  stands in).
