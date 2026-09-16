# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.4 is built** (2026-09-16: every promoted item in
`1.4-plan.md` landed, the selling list + What's New deck are written; the deck walk, the
re-merge and the tag are the author's; `1.4-plan.md` archives with the tag). The
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

- [ ] **Walk the What's New deck** (author, one slide per turn; slide 1 "Your Obsidian vault is a table"
  was presented 2026-09-16 and not yet ruled). Cuts and rewordings land in `HelpDialogs.tsx` +
  `release-notes-features.md` together.
- [ ] **Re-merge `develop` → `main`, then tag v1.4.0** (the 1.4.0 bump is on both; `main` lacks the
  button-case sweep and the seed cuts); then walk `2.0-plan.md`.
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The ARR pass over the tree** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules: walk `python tools/dte.py tree` and ratify node by
  node (dte:C7 authorRuled; `1.4-plan.md` D3).

## Composites

- [ ] **LATER — Optimize run mode on composites (1.4 A6; author 2026-09-04c: in, not now).** Excel
  Solver's shape as a sixth composite run mode beside Goal Seek; spec + steps in `1.4-plan.md`
  § A6. Gate: the author says go (and settles the constraint forms; integer no).

## Sources

- [ ] **Widget nodes Tier 2 (`v2.0/16`), post-1.4:** Air Quality/Pollen preset of Weather, Ticking Now timer.

## Obsidian + TaskNotes (author 2026-09-07: THE adoption bet — correct, great, useful)

The bundle `v2.0/24-obsidian-vault.md` is promoted to the flagship track; its § Defaults are the
build rules and § Sequencing the order (A′ → A → B → D → C → F → I → J → E). Every item ships
verified in the desktop app against the demo vault. Landed ledger: the bundle's § What stands today.

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

## DTE — decision provenance (`docs/dte.md`, dte:B8)

Every rule and settled decision is a node (2026-09-15). DTE-tool findings live in the DTE repo's
FEEDBACK file.
- [ ] **Author ratifies the tree** — only A1 is ratified. `python tools/dte.py validate` prints the
  unratified list; `ratify <ID>... --by`, and the same change adds the ID to `OWNER_RATIFIED` in
  `rules.test.ts` (dte:C7 authorRuled).
- [ ] **Apply the WHY-comment→citation practice** (dte:C57 commentMinimalism): migrate rationale
  comments into the node's `## Why`, leave a `dte:<ID> name` citation.
- [ ] **Citation coverage is mixed** — bare test-suite citations in node Consequences (21 across 20
  rules at the 2026-08-09 count) are reading-verified only; quoting the describe/it names buys the
  `rules.test.ts` check. oneMetricImpl and oneThingPerMetric cite a module, not a suite.
- [ ] **Optional:** `python tools/dte.py hook` (pre-commit validate) — not installed (touches the
  commit flow); `validate` is not in CI either.

## Canvas annotation

- [ ] **Drawn cables: nothing tows one.** A drawn arrow annotating a node stays put when that node
  moves, Tidy runs, or a group expands. An optional per-END anchor to a node id would fix it and is
  the natural v2; deliberately out of v1 (they take no part in layout).


## Formatting & units

- [ ] **Older long tooltips / descriptions** (Decision Matrix, Sensitivity, Allocator, Record
  layout, Chart values, Slider bounds, 200-plus-character catalog entries) are the copy class the
  2026-09-12b cut fixed for the new nodes; a separate sweep. Author call pending: now or release tail.

- [ ] **LATER (author, 2026-09-04): fold the Format Controller into the Display** — format and
  unit set at sources and displays, flowing downstream only; the docking subsystem and the
  upstream walk go. Analysis + scope in `1.4-plan.md` Track I. Gate: the author's go after the
  downstream-flow work has been lived with, plus the source-node control design.

## Family-name polish (NAME-3 revised 2026-09-13 — card shows the class-derived family name)

A few families still read awkwardly as `nodeTypeName` output. Fix = rename the class
(no override map, NAME-3), verifying seeds + the generator (type = class name):
- [ ] `IFErrorNode` → "If Error"; `MatDetNode` → a real family name (covers MDETERM /
  MINVERSE / TRACE / NORM / MATRIXRANK — "Matrix"?); `MRoundNode` → a name for the
  MROUND / CEILING / FLOOR family. Author picks the two names.
- [ ] "URL Encode" / "E-Series" can't come from a class rename: `nodeTypeName` only
  splits camelCase (lower→upper), so `URLEncode` and `ESeries` don't gain the space/hyphen.
  Either teach `nodeTypeName` acronym/hyphen handling (a derivation tweak, author to okay)
  or accept "Url Encode" / "ESeries".
