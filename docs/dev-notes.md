# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-17 — Obsidian round-trip; author present)

On `develop`, nothing pushed.
- **DTE citations are wikilinks** ([[C81]] wikilinkCitations, created this session): every `dte:ID` token in code,
  tests and docs is `[[ID]]`, node link fields are quoted wikilinks, and node prose links its in-tree IDs, so the
  repo opened as an Obsidian vault shows the tree's lineage and backlinks. The vendored `tools/dte.py` reads both
  forms and writes per the new `links` key in `dte.cfg`; the patch passes DTE's own 74 tests untouched and is
  logged in DTE's FEEDBACK.md beside a note on how DTE sits against ADR/MADR, RFC 2119 and the spec-kit tools.
- **Frontmatter reads any YAML, writes Obsidian's block style.** The author found that editing any property in
  Obsidian rewrote the Spanish course note's inline `- {topic: …, tags: [...]}` rows into block style, after which
  the cube read as a one-item string list and Write Properties refused the key. The hand-rolled subset parser is
  gone: `noteFrontmatter.ts` reads through the `yaml` package (quoted scalars stay text, plain ISO dates become
  serials, a list of maps is a frame, a row holding a list a cube, a non-row nested map surfaces as a blank
  string key). `frontmatterPatch.ts`, the graph stub and every demo-vault note spell rows and lists in block
  style, the writer's "nested block" refusal is deleted, and the Kitchen remodel round trip now covers tags and
  milestones byte-for-byte. Author's ruling: the inline form was only ever a parser limitation, block style
  app-wide is fine.
- **Vault file watcher removed** (author: "working in Obsidian should not interrupt Solenoid; we have the refresh
  buttons"). `vaultWatch.ts`, `useVaultWatch`, the `fs:allow-watch`/`unwatch` capability and the test are gone;
  the refresh buttons and the minutes cadence are the only re-reads.
- **Report preview with a wired template and no records** showed the empty state: the show-or-empty check read
  the idle draft body instead of the preview source (`ReportOverlay.tsx`).
- **Import Obsidian Note** card: the header label and the file-name line above the body both went; the note's own
  markdown heading is the title. The card reloads on Refresh all connections (the store notifies; it read its
  file outside the engine). In dev the demo vault reads live from disk through `/__demo-vault` and Vite no longer
  watches the folder (an Obsidian save reloaded the whole app).
- **Cube popup + chips:** a return from a drilled level lands on (and flashes) the cell it came from; list chips read
  `4× List` everywhere (author: object emphasis over `4 items`, which stays only on the header badge); a list level
  lies across ONE ROW by default (a list is a CSV row) with the Row | Column switch; nested chips tint by element
  family; a list chip's hover shows its first items; Display tokens spell containers like the chips.
- **Knap inside frontmatter** (author ask): a quoted tag's socket carries the rendered value; an unquoted tag is
  `#SYNTAX!` with the author's wording. No `today` built-in and no unquoted pre-parse: both would be the parallel
  template grammar the `{{daily}}` removal ruled out (`node-coverage.md` § Note).
- **Chrome sweep:** Open in Obsidian is disabled (not hidden) on the web build, every vault; container shapes read
  `3×2 Frame` / `3×2×1 Cube` / `3×4 Table` on the Note field row and the flow preview (which had the axes swapped
  and no cube form); text glyphs serving as icons became Lucide SVGs through `components/Icons.tsx` (context
  menus, Add-menu chevron, Present, standoff Remove, carets, Surface rotate pad, Reference parity ⚠). Left as
  text: data marks (menu ✓, ✓/✗ logical style, KPI ▲▼▬, Alert ●, legend ◂), math notation, the Promo emoji.
  Open for the author: the `↩ wired` badge (16 inline sites) as one `WiredTag` component with an icon.
- **Family names** (author's rule: a `{ }` card hosting distinct computations is plural; modes of one artifact
  stay singular; Excel names untouched): Distribution → **Distributions**, Set → **Sets**, whole identity (class,
  type `distributions` / `list-sets`, component file, seeds, tests). **Chart → Chart (Recharts)** (author: the
  node is Recharts-specific; the parenthesised label passed every catalog/formula check). Kept singular after
  the sweep: Chart, Sparkline, Record, Proportion, Comparison, Type Check, Fill, Smooth, Regex; Head was flagged
  as naming one op of a row-slicing family and left alone.
- **Obsidian rendering on note surfaces** (`noteMarkdown.ts`, its own Marked instance so help prose is untouched;
  Note, Import, Report preview, embeds, webpage export): `[[wikilinks]]` (alias / heading / embed forms) as
  note-coloured links, `#tags` as chips (opaque sunken fill under a note-coloured hairline; the note bg is a wash
  of the same hue so a wash chip vanished), `==marks==`, `> [!kind]` callouts (tinted box, kind icon, accent
  title, danger kinds in error ink; no stripe), `$math$` / `$$math$$` via the lazy KaTeX chunk (loaded only on
  meeting a formula; `useKatexReady` re-renders the site), `%% comments %%` and `^block-ids` hidden outside
  fences. Ink at `--mix-ink`. Skipped by the author: footnotes (`marked-footnote` exists), embeds, Mermaid.
  Tests `noteMarkdown.test.ts`.

### SESSION DIGEST (2026-09-16c — the deck, ruled; author present)

On `develop`, nothing pushed.
- **What's New is eight slides in the author's own copy** (`HelpDialogs.tsx`); the drawn-cables slide is cut
  and the author ruled the tool too minor for chrome or a key: **no toolbar button, no D hotkey**; Insert →
  Draw a cable (and the palette) is the one way in (`subsystem-invariants.md` § Reach). Nothing else from the
  since-v1.3 log earns a slide (author).
- **Long-copy sweep** (author delegated, unchecked): the 76 UI prose strings over 200 chars (mean 89) compressed to
  under 200; library citations restored where the cut untagged a Reference chip (`functionReferenceLibs.test.ts`
  caught it). The scan: string-editor's `scanSource` over `src/**` minus help/landing, prose literals only.
- Left for 1.4 beyond the release process and ratification: the `NEW COPY` placeholder prose on the
  Download / Examples / Packs pages goes live with the merge (Vercel serves `main`); the older-long-tooltip
  sweep landed the same day (below).

### SESSION DIGEST (2026-09-16b — the walk, cut short; author present)

On `develop`, nothing pushed. The author ordered one item per turn for every walk (memory).

- **C80 ratified** by the author (`OWNER_RATIFIED` = A1, C80).
- **Demo vault is a fallback, not an override** (author): Settings ▸ Obsidian lists the vault folder first, "Use demo
  vault" second (on by default; the author's help text). A configured vault or TaskNotes URL always wins; the demo
  is used only with nothing configured and the switch on; off + nothing = "set the folder". TaskNotes' canned
  replies follow the same switch. **D1 folded into D62** (now `demoVaultResolution`, under C1 + C2). The author
  rejected two rewrites of D62's prose ("gobbledygook", "horrible writer") and ended the session unratified; the
  node's wording is the author's to fix. Do not re-present agent prose for it.
- **Cables reach 2px into their sockets** (`SOCKET_OVERLAP` / `intoSocket`, `cablePaths.ts`): RF anchors an edge
  at the handle's outer edge on a half-pixel, and the abutting anti-aliased stroke and glyph read as a 1px gap
  (worst on square sockets). Applied to the drawn edge, the drag line and the GPU geometry; pills and lanes exempt
  (the author saw no seam there). `subsystem-invariants.md` § surface contract.
- Chrome: the Filter Aa toggle takes `--node-accent` (one `MatchCaseButton` for Filter + Frame filter); header
  label letter-spacing 0.08 → 0.05em; connection-card selects wear the app chevron; Vault Folder has one refresh
  (status row rescans folders too) and labelled Filter / Date in name fields.
- DTE tool: `show` crashes under cp1252 on `→` (logged in the DTE repo's FEEDBACK #4); use `PYTHONIOENCODING=utf-8`.
- **Open (owner):** the walk — D62 (author's wording), D42, E11, the deck (nine slides, none ruled), the B ring;
  everything else in the 2026-09-16 digest below still stands.

### SESSION DIGEST (2026-09-16 — the 1.4 release tail; solo, author delegated)

All on `develop`, merged to `main` at 1.4.0, nothing pushed; the tag is the author's.
The author closed the eyeball gates ("all eyeball stuff is done") and ruled the DTE items
off the release, then ordered "ingest DTE rules and follow them": every change below cites
its node, the two nodes acted under got their one contest (D42 perInputUnitBlind, E11
controlDrivenRetype: keep), and the new rule landed as a node before its code (C6).

- **Input Switch pending ghosts are drawn** ([[E11]]): `PendingCableLayer` (a ViewportPortal
  layer beside the drawn cables) draws each `cablePendingStore` entry dashed in the Option A
  stroke from RF's measured handle bounds; no edge exists to carry it.
- **Tidy reserves a plain card's MEASURED box**: the ELK proxy read `node.width/height` for an
  ordinary card (`tidyArrange.ts`), so a stale constructor height or a collapsed card
  mis-spaced. History checked: the 2026-07-16 measuredBox unification simply never reached that
  branch. Regression in `tidyArrangeGroups.test.ts` (fails without the fix).
- **Triangle Solver is unit-aware** ([[D42]]): an angle-dimensioned cell converts base radians
  to degrees whatever its display unit; a side takes its display magnitude as the strip did.
  `geometry.test.ts`.
- **TaskNotes chip** reports `cols` beside `rows` on every provider (`reportOk`), so `6×0` is gone.
- **blankArgIsExcelBlank — [[C80]] (NEW, under B5).** `BLANK_ARG_TYPES` + `excelBlanks` in
  `excelFormula.ts` map a blank slot to 0 / FALSE / "" per declared parameter at the dispatch
  boundary; TEXTJOIN keeps the empties on a blank `ignore_empty`; `xMatchModeArg` /
  `xSearchModeArg` default only on `undefined`. MATCH / VLOOKUP / HLOOKUP are blocked spellings,
  so no row; XLOOKUP's blank `if_not_found` left as missing. `blankArgIsExcelBlank.test.ts`.
- **Release tail:** `release-notes-features.md` reset to the 1.4 list (nine `[slide]`
  headliners: the vault as a table, TaskNotes, Knap reports, Schedule + Gantt, everyday sources,
  planners, categorical columns, socket peek, drawn cables); the What's New deck rewritten,
  `WHATS_NEW_VERSION` 1.4; version 1.4.0 in package.json / tauri.conf.json / Cargo.toml (+ locks);
  `develop` merged to `main`. `archive/1.4-plan.md` stays live until the author tags (its sections are
  still the spec the deferrals point at); it archives with the tag.
- **Verified, then deleted from the backlog:** the "display unit lost on a computed result" line
  (the 09-14 digest traced the only sighting to the scene-ownership gap; the unit display suites
  are green on the main path).
- **Buttons are Title Case, no `+` glyph** (author; DESIGN.md § Buttons): Add LAMBDA, Form Layout, Add
  Condition / Criterion / Plot / Step / Input, Add Row / Column / Record, New Blank Document, Copy Details,
  Run Sensitivity. Tooltips stay sentence case.
- **Seed library cut 40 → 35** (author: "your instinct is right on all of them"). Deleted: Remodel (Gantt),
  Project (two frames), Earned Value (folded into Product launch with a Holidays node and a cost per task),
  Balance a team's hours (the Allocator card is the lesson), Tasks: list and tracked time + Which task next?
  (merged as `tasks-from-tasknotes`: Vault Folder list, TaskNotes rollup, Decision Matrix over the open
  tasks), Write it back to Obsidian (folded into `vault-as-a-table`: read, filter, write back). The scratch
  sheet carries `hidden: true` (in `SEEDS` by id, out of the menus). NEW `whats-new` (Start here, order 5):
  one group per 1.4 slide, tuned.
- **[[D62]] demoVaultResolution (NEW, under C1 + C2; absorbs D1):** the one resolution order: forced demo (marketing pages), else the configured vault or URL, else the bundled demo while `useDemoVault` allows (on by default, the web app's path), else "set the folder". The author's ruling: the folder setting first, the demo switch second and a fallback, never an override.
  The canned TaskNotes replies parse synchronously in `data()`, so a seed computes on its first pass. Every
  Obsidian seed lost its "(snapshot)" Frame/Cube Input and wires the live reader only. The demo tasks gained
  the five kitchen-remodel tasks (a chain with a diamond) so the kitchen seed schedules them.
- **Second cut, 35 → 26** (author: "more aggressive"; Sudoku stays). Absorbed as ONE lean group each: Units by
  dimension → Unit flow (K, the column-locks-to-its-header case; its algebra group was already F),
  Trust & data quality → Errors, null & logic (the Expect check only), LAMBDA helpers → Computed columns
  (BYROW + MAP), Pivot tables → Table verbs (share-of-grand + subtotals), Daily notes → Your vault as a
  table. Trip split + Debt payoff → `planners`. Live market data deleted (keyed, CORS-blocked, never tuned).
  Mail merge deleted (Report showcase already carries a merge group). `pivot-tables.json` and
  `mail-merge.json` moved to `tests/fixtures/` so `pivotSeed.test.ts` / `mailMergeSeed.test.ts` keep
  pinning the eight cross-tabs and the Knap merge.
- **Tuner gotcha:** `tune-seeds.mjs` with several ids dies after the first patch ("Execution context was
  destroyed"): the JSON write triggers Vite's full reload under the open page. One id per run.
- **Power features seed reviewed, unchanged** (author: "don't like any of that"). Its five clusters are
  current; a proposal to add six clusters (peek + hints, draw + flip, isolate/pin/where-used, group
  lock, the switch ghost, a shortcuts note) was rejected outright. Do not re-propose.
- **`main` is behind `develop` again** (the button sweep and the two seed cuts landed after the merge).
  Re-merge before the tag.
- **Open (owner):** the What's New slide walk (paused after slide 1 was presented); ratify the tree (validate
  lists C80 + D62 new, D42 + E11 contested); Track G's ratification; the family-name picks;
  `out-of-scope.md`.

