# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-16 — the 1.4 release tail; solo, author delegated)

All on `develop`, merged to `main` at 1.4.0, nothing pushed; the tag is the author's.
The author closed the eyeball gates ("all eyeball stuff is done") and ruled the DTE items
off the release, then ordered "ingest DTE rules and follow them": every change below cites
its node, the two nodes acted under got their one contest (D42 perInputUnitBlind, E11
controlDrivenRetype: keep), and the new rule landed as a node before its code (C6).

- **Input Switch pending ghosts are drawn** (dte:E11): `PendingCableLayer` (a ViewportPortal
  layer beside the drawn cables) draws each `cablePendingStore` entry dashed in the Option A
  stroke from RF's measured handle bounds; no edge exists to carry it.
- **Tidy reserves a plain card's MEASURED box**: the ELK proxy read `node.width/height` for an
  ordinary card (`tidyArrange.ts`), so a stale constructor height or a collapsed card
  mis-spaced. History checked: the 2026-07-16 measuredBox unification simply never reached that
  branch. Regression in `tidyArrangeGroups.test.ts` (fails without the fix).
- **Triangle Solver is unit-aware** (dte:D42): an angle-dimensioned cell converts base radians
  to degrees whatever its display unit; a side takes its display magnitude as the strip did.
  `geometry.test.ts`.
- **TaskNotes chip** reports `cols` beside `rows` on every provider (`reportOk`), so `6×0` is gone.
- **blankArgIsExcelBlank — dte:C80 (NEW, under B5).** `BLANK_ARG_TYPES` + `excelBlanks` in
  `excelFormula.ts` map a blank slot to 0 / FALSE / "" per declared parameter at the dispatch
  boundary; TEXTJOIN keeps the empties on a blank `ignore_empty`; `xMatchModeArg` /
  `xSearchModeArg` default only on `undefined`. MATCH / VLOOKUP / HLOOKUP are blocked spellings,
  so no row; XLOOKUP's blank `if_not_found` left as missing. `blankArgIsExcelBlank.test.ts`.
- **Release tail:** `release-notes-features.md` reset to the 1.4 list (nine `[slide]`
  headliners: the vault as a table, TaskNotes, Knap reports, Schedule + Gantt, everyday sources,
  planners, categorical columns, socket peek, drawn cables); the What's New deck rewritten,
  `WHATS_NEW_VERSION` 1.4; version 1.4.0 in package.json / tauri.conf.json / Cargo.toml (+ locks);
  `develop` merged to `main`. `1.4-plan.md` stays live until the author tags (its sections are
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
- **dte:D62 noSetupMeansDemo (NEW, under C1):** a blank `obsidianVault` resolves to the demo vault and a
  blank `taskNotesUrl` to the canned TaskNotes replies (now parsed synchronously in `data()`, so a seed
  computes on its first pass). Every Obsidian seed lost its "(snapshot)" Frame/Cube Input and wires the
  live reader only. The demo tasks gained the five kitchen-remodel tasks (a chain with a diamond) so the
  kitchen seed schedules them. The `useDemoVault` setting is now the override beside a real vault.
- **Tuner gotcha:** `tune-seeds.mjs` with several ids dies after the first patch ("Execution context was
  destroyed"): the JSON write triggers Vite's full reload under the open page. One id per run.
- **Open (owner):** the What's New slide walk (paused for the seed cleanup); ratify the tree (validate
  lists C80 + D62 new, D42 + E11 contested); Track G's ratification; the family-name picks;
  `out-of-scope.md`.

