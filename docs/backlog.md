# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.4 is built** (2026-09-16: every promoted item in
`archive/1.4-plan.md` landed, the selling list + What's New deck are written and the author rewrote the deck
2026-09-16; the tag is the author's; the plan is archived). The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale and rules: the decision tree (`dte.md`).

## Dependency updates (walking them one at a time; TypeScript 7 landed 2026-08-11a)

Current state (2026-09-13): the walkable set is on latest in-range (`react` 19.3,
`vite` 8.3, `@xyflow/react` 12.11.6, the Tauri plugins, `@anthropic-ai/sdk` 0.125 — git
has the walk), and **`vitest` 5 landed** (5.0.0; the whole suite is green, and it now
transforms with Oxc — the `esbuild: { keepNames: true }` in `vite.config.ts` is only for
the production `minify: "esbuild"` path, so vitest 5's "esbuild options ignored" warning
is expected and harmless). **Held major: `mermaid` 12** — it hard-depends on
`chevrotain` 11, which bundles a `lodash-es` with two unfixed high-severity advisories
(`_.template` code injection, `_.unset`/`_.omit` prototype pollution); no patched
`lodash-es` is published, so an `overrides` pin can't clear it. Stay on 11.17.2 until
chevrotain ships a fixed lodash-es. The rete RENDER packages and `styled-components` were removed outright
by the React Flow cutover (rete core 2.0.6 + rete-engine + elkjs 0.12 + `@xyflow/react`
remain). The `.npmrc` `legacy-peer-deps` workaround is REMOVED — the old
elkjs-vs-rete-auto-arrange peer conflict left with the plugin.

## Release planning (author-run)

- [ ] **Walk `2.0-plan.md`** (1.4.2 shipped 2026-09-22 with plugin 0.1.3; 1.4.1 was the first Windows + Linux release).
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The ARR pass over the tree** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules: walk `python tools/dte.py tree` and ratify node by
  node ([[C7]] authorRuled; `archive/1.4-plan.md` D3).

## Found in the comment lift (verify against the code, then fix or rule)

Suspected while reading code to lift its comments; none is confirmed yet.

- [ ] **Frame verbs:** `reconcileFrames` drops a row with a non-finite key outright (neither matched nor skipped); `promoteHeaders` keeps `raw` unsliced, one row out of line with the values; `engine_column` matches a name untrimmed while `getColumn` trims.
- [ ] **Node classes:** FindPeaks reads a wired blank minimum as "no minimum" ([[D33]] unwiredNotBlank); SeriesSum and tableLambda's `cell()` turn non-finite results into null ([[D48]] classifyNonFinite); CubeColumns reads `names` raw instead of through `readInput`; old-save shims survive despite [[B7]] preAlphaBreakFreely (Filter's "none" → "and", stale-op guards in Sets, Constant and ColorBlend).
- [ ] **Formulas:** DIAGONAL's matrix branch is unreachable (a matrix answers `#SHAPE!` at dispatch); `signatureParams` splits a "use the X node" redirect as a parameter; `highlightFormula` doesn't treat a dot as a name character (NORM.S.DIST); `collectRowRefs` matches `LAMBDA` case-sensitively where `collectNames` uppercases; `interpolateLinear` may pick the later y at a duplicate x.
- [ ] **Popups:** no opener passes `onSave` or `onSaveFrame`, so those two Table popup modes may be dead; `TablePopupState.literalSource` is set and never read.
- [ ] **Canvas:** the HTML-in-Canvas graph snapshot still scrapes text, sliders and boxes for a Pixi renderer that no longer exists; only `snap.cables` is read.
- [ ] **Scripts:** `scripts/op-exposure.ts` branches on a `NODE_OPS` "argument" kind nothing declares ([[C26]] opArgDistinct).
- [ ] **For the author:** DESIGN.md still lists Table Coral for table and frame data, while `--sock-table` is gold; the AI-mode "quiet accent" rule in the Command Palette isn't in DESIGN.md; the Range kernel includes Stop on an author ruling whose reason was never recorded.

## Node merges (parked by the author, [[B11]] maximalMerge)

- [ ] **The stack merge (author to rule):** Append and Bind Columns (Frames) sit beside XSTACK (lists and tables). [[E14]] frameVerbExcelNames says the Frame pair becomes VSTACK and HSTACK when the stack merge lands; [[C48]] appendLadder keeps one append node per rank, which reads as keeping them apart. Pick one and the other node gets reworded.
- [ ] **Paired-list aggregate**: SUMPRODUCT, the SUMX functions, CORREL, COVARIANCE and a weighted average as one two-list Aggregate (the author said to wait), and the remaining smaller pairs.

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

- [ ] **Project-exported goldens** (author): export MSPDI from a Project trial / 2024 for the two
  seeds' plans and drop them in `fixtures/schedule/` as `project-*.mspdi.xml`; the parity test
  picks them up; name any disagreement in `divergences.json`. Until then the corpus is authored.

## Canvas chrome (queued by the author 2026-09-07, "not top priority")

- [ ] **Collapsed stadium pill hover preview** — a collapsed node's input pill shows a hover
  preview listing EVERY cable item (name + value), not just the first. Author's extension to
  consider with it: a special Conduit → bundled cable → Cube node (the bundle's lanes land as one
  cube). Design first (DESIGN.md, `subsystem-invariants.md` § Conduit faces); stage after the
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
- [ ] **Palette on wide-gamut displays** (author 2026-09-21 noticed the Linux desktop reads more saturated than
  the dev server; cause in `archive/dev-notes-history.md`, digest 2026-09-21b). The hexes are sRGB, so a color-managed engine (Chromium, WebView2
  with a display profile) shows them accurately and an unmanaged one (WebKitGTK) stretches them to the panel.
  The author tuned the palette by eye on an unmanaged P3 panel, sees the same vivid look on their phone, and
  prefers it; managed Chromium on Linux is the outlier among their screens. Design call: leave it, or
  author the accents in `color(display-p3 …)` with sRGB fallbacks so managed engines on P3 panels get the vivid
  version too (DESIGN.md § 2; `palette.ts` derives siblings in HSV from hex, so this is not a token swap).

## Landing pages

The site is four pages sharing `landing/siteNav.tsx` chrome (see architecture.md). Open items:

- [ ] **Copy pass on `/download` + `/examples` + `/packs`.** New-page prose is placeholder in the
  author's voice, marked `NEW COPY` in those page files. Author to rewrite.
- [ ] **Public changelog page (parked, author wants it later).** Would live at `/changelog` off
  `docs/release-notes-features.md` + the What's New slides. Deferred so it does not just mirror
  GitHub Releases; revisit when there is a reason it earns its own surface.
- [ ] **Per-route meta description.** `index.html` now has a description, OG/Twitter tags and an
  `og:image` (hero), plus `sitemap.xml` + `robots.txt`. Still one static default for every route;
  per-route text needs a small prerender step.
- [ ] **Finish the landing/Obsidian scene rebuild.** Feature scenes are real canvases (Obsidian
  hero `LiveGraph`, `VaultTableScene`, `LocalFileScene`, `NoteImportScene`, `TaskNotesScene` on the
  demo API fake). Still hand-built DOM/SVG: the Presenter scene (landing) and the Obsidian page's
  bridge + Plan vignettes — none maps to a single locked pass.

## DTE — decision provenance (`docs/dte.md`, [[B8]] treeIsTheHome)

Every rule and settled decision is a node (2026-09-15). Tool findings: `dte-feedback.md`.
- [ ] **Author ratifies the tree** — A1, B7 and C80 are ratified; D62 is the author's to reword first (two agent
  drafts rejected 2026-09-16), then D42 / E11 (contested, kept), then the B ring. `python tools/dte.py validate` prints the
  unratified list; `ratify <ID>... --by`, and the same change adds the ID to `OWNER_RATIFIED` in
  `rules.test.ts` ([[C7]] authorRuled).
- [ ] **Author places `tree/decisions/inbox/scope-boundary.md`** (proposed ring A): `dte place scope-boundary A --by <name>`.
- [ ] **Coverage is 100% and pinned** (`rules.test.ts` runs `coverage --check` + `validate`). The bulk pass cited
  whole classes by blast radius (every component cites [[C27]] noDataInComponents, every node class [[C34]]
  classNameIsType + [[D50]] everyFieldClassified, every store [[B10]], every op module [[D19]] + [[C17]], tests the
  leaves of the sources they import, MUSTs only where another test already enforces them). Those are true but
  thin: the comment sweep ([[C57]]: WHY → node, HOW → spec) still owes each file its SPECIFIC leaf where one
  exists; `dte scope --comments` lists the comment-heavy ones. The 2026-09-18 agent sweep did the 206 thinnest
  (components, nodes, packages, core modules); what is left is line-granular.
- [ ] **Relapses the sweep found, each a code change the author should rule on first:** (a) `nodes/conduit.ts`
  upgrades a saved bare "Conduit" label to "Conduit N" on load, a migration shim [[B7]] preAlphaBreakFreely forbids;
  (b) `DateNodes.tsx` (and any op handler calling `setLabel(OP_META[next].label)`) syncs a label on op change against
  [[D22]] oneNamePerCard's "the ONE derivation is nodeDisplayName"; (c) `ConnectionNodes.tsx` LocalFile says
  "desktop only" off-desktop while [[C1]] demoVault says it reads a demo CSV on web; (d) `PacksPage.tsx` /
  `ExamplesPage.tsx` hand-copy pack descriptions and seed labels ("keep in step") against [[C8]] declareOnce;
  (e) `SliderInputNode.tsx` writes `literals.speed` per keystroke (no recompute, so the [[C95]] sweep passes, but
  it is the pattern); (f) pack kernels (`hrZonesMatrix`, `standardAtmosphere`, `emSpectrum`) are consumed by the
  formula path through `rete-nodes.ts`, so pack formulas pull rete: either [[D19]] implReteFree names the exception
  or the kernels move to rete-free siblings.
- [ ] **`docs/v2.0/25-gantt.md` § 6 is the schedule/Gantt spec** (the packages' headers point into it) but lives in
  the proposals folder, excluded from coverage. Lift § 6.1–6.5 into a spec under `../tree/specs/` (schedule-and-gantt) serving [[C70]]
  oneScheduleRule / [[C69]] ganttPackages and leave the survey (§ 1–5, 7–8) where it is.
- [ ] **Docs triage (author's rule 2026-09-18: every system-describing doc is a node or a spec; on-ramps,
  proposals and history keep their homes).** Done: `subsystem-invariants.md` → `specs/` (27) + the mechanics docs
  declared as the spec layer; the comment policy → [[C57]] commentMinimalism; `agent-coordination.md` reduced to the claim board, its protocol → [[C83]]
  parallelAgents (the file is the live claim board); the Formula.js divergences → `../tree/specs/computation/formulajs-divergences.md`. Exempt as queues:
  `deferrals.md`, `upstream-formulajs.md` (a few rulings inside deferrals are node candidates when touched).
  **Blocked on the author:** `out-of-scope.md` is the draft of `inbox/scope-boundary` (the four tests + the mirror
  test) and its 13 categories are that node's children; nothing can hang off an unplaced node, so
  `dte place scope-boundary A --by <name>` first, then the categories become B nodes and the doc goes.
- [ ] **C80 blankArgIsExcelBlank still hangs off A5** (author-ratified, so not re-parented by an agent); its family
  parent is now [[B16]] oneFormulaSurface. One `parents:` edit by the author closes the last ring-skip finding.
- [ ] **Two author-held `*Where:*` lines remain** (B7, C80; the other 41 went 2026-09-18 once their files cited
  back). The author deletes them or rules they stay.
- [ ] **20 SKIPPED RING findings under A5 / A6** are the owner's placement (`dte scope`); either B nodes are
  missing under Excel parity / divergence, or the finding is noise (feedback 4). The author decides.
- [ ] **Optional:** `python tools/dte.py hook` (pre-commit validate) — not installed (touches the
  commit flow); `validate` is not in CI either.

## Canvas annotation

- [ ] **Drawn cables: nothing tows one.** A drawn arrow annotating a node stays put when that node
  moves, Tidy runs, or a group expands. An optional per-END anchor to a node id would fix it and is
  the natural v2; deliberately out of v1 (they take no part in layout).


## Formatting & units

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

## From the comment lift (rest partition)
- [ ] **Voice lint over option tables.** `uiCopy.test.ts` skips the `tsx-opt-*` records `copyCorpus.ts` already
  collects (dropdown rows, op-meta labels and descriptions); widen the lint to them, a sweep of its own.
- [ ] **Custom packs.** Settings shows `customPacksFolder()`, but `loadCustomPacks()` is a stub returning none until
  filesystem access and a pack format are settled.
