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

## Release planning (author-run)

- [ ] **Walk `2.0-plan.md`** (1.4.2 shipped 2026-09-22 with plugin 0.1.3; 1.4.1 was the first Windows + Linux release).
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The ARR pass over the tree** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules: walk `python tools/dte.py tree` and ratify node by
  node ([[C7]] authorRuled; `archive/1.4-plan.md` D3).

## Node merges (parked by the author, [[B11]] maximalMerge)

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

- [ ] **Schedule row faults vs [[C70]] oneScheduleRule (author to rule):** C70 says a per-row fault (a bad
  Duration, an unparseable date) stays on its row, but `scheduleCpm.ts` throws on every fault and the whole
  run is one `#VALUE!` on all outputs. Either the code grows a per-row path or C70's line changes.
- [ ] **Local File's plan `frame` writes Predecessors as grammar text** (`Framing SS+2`), so wiring that frame
  (not the `plan` cube) into Schedule reads the text as one task name and fails as unknown. Verify, then
  either write structured predecessors or let Schedule's frame path parse the grammar ([[D67]]).
- [ ] **Project-exported goldens** (author): export MSPDI from a Project trial / 2024 for the two
  seeds' plans and drop them in `fixtures/schedule/` as `project-*.mspdi.xml`; the parity test
  picks them up; name any disagreement in `divergences.json`. Until then the corpus is authored.

## Canvas chrome (queued by the author 2026-09-07, "not top priority")

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
- [ ] **Palette on wide-gamut displays** (author 2026-09-21 noticed the Linux desktop reads more saturated than
  the dev server; cause in `archive/dev-notes-history.md`, digest 2026-09-21b). The hexes are sRGB, so a color-managed engine (Chromium, WebView2
  with a display profile) shows them accurately and an unmanaged one (WebKitGTK) stretches them to the panel.
  The author tuned the palette by eye on an unmanaged P3 panel, sees the same vivid look on their phone, and
  prefers it; managed Chromium on Linux is the outlier among their screens. Design call: leave it, or
  author the accents in `color(display-p3 …)` with sRGB fallbacks so managed engines on P3 panels get the vivid
  version too (DESIGN.md § 2; `palette.ts` derives siblings in HSV from hex, so this is not a token swap).

## Landing pages

The site is four pages sharing `landing/siteNav.tsx` chrome (see architecture.md). Open items:

- [ ] **Author reviews the site copy.** An agent pass (2026-09-23) brought every page to DESIGN.md §7;
  the Packs and Examples pages now render from the pack definitions and the seed list.
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
- [ ] **Author ratifies the tree** — A1, B7, C80 and D62 are ratified; next D42 / E11
  (contested, kept), then the B ring. `python tools/dte.py validate` prints the
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
