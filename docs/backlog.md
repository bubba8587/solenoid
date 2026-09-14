# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.3 shipped** (v1.3.0 on `main`; `develop` is
level with it). **The 1.4 cut is PROPOSED, not ratified:** `1.4-plan.md` scores every
deferred idea and carries the per-item plans; nothing there is scheduled until the author
promotes it — a promoted item becomes a line here and its plan section is the spec. The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale: `decisions.md`.

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

- [ ] **Finish ratifying the 1.4 cut** — the author walked `1.4-plan.md` one item per turn on
  2026-09-04c and 2026-09-06 (Tracks A–H ruled; every ruling is in the table's Call column and
  the Track H headings). NEXT: G (release tail); then `2.0-plan.md`.
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The `rules.md` ARR pass** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules (`1.4-plan.md` D3).

## Composites

- [ ] **LATER — Optimize run mode on composites (1.4 A6; author 2026-09-04c: in, not now).** Excel
  Solver's shape as a sixth composite run mode beside Goal Seek; spec + steps in `1.4-plan.md`
  § A6. Gate: the author says go (and settles the constraint forms; integer no).

## Sources

- [ ] **Widget nodes Tier 2 (`v2.0/16`):** Air Quality/Pollen preset of Weather, Ticking Now timer.

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
- [ ] **Knap eyeball pass** (author): the overlay's highlighted source pane incl. the wired-Template
  read-only pane (alignment, scroll, mobile), the page stepper + the Page-name field beside it, the
  Filters popover, a wired template Note changing its tags, Write to Obsidian writing a batch on
  desktop. Plus the 09-11 rebuild: the **standard-node Report card** (Template/Records rows, the
  Document-chip hero, collapse to a pill), the **docked header** (stacked title, tiny Draft/Preview
  toggle in the button row, 26px controls), a **template note** showing its tags literal (not empty),
  and the **Personal Finance** letter's inline `{% if %}` verdicts flipping as a slider moves. The
  dev-notes 09-10 "holes at close" + the 09-11 digest are the checklist.
- [ ] **File the Knap upstream PRs** (`knap-upstream.md`): the typed-value bug first (its three
  repros), then whitespace control, filters in comparisons, the `sort` validator; the API
  asks as issues. Retire the noted workarounds as each lands.
- [ ] **Author's desktop eyeball** of the flagship cards against `demo-vault/` (Settings ▸ Obsidian
  → the repo's demo-vault): Vault Folder (be's ten-step checklist in the 09-07 digest), Write
  Properties Preview/Run on a copy, TaskNotes with the plugin's API on, Write to Obsidian block mode
  + `{{daily}}`, Write Properties' `writeBase` view, the Cube Input editor's three drill targets,
  and the two new Obsidian seeds (`write-back-to-obsidian`, `daily-habits`) with the live Vault
  Folder swapped in for the snapshot.

## Gantt + Schedule (BUILT 2026-09-12 — `v2.0/25-gantt.md` § 9 is the ledger; follow-ups)

- [ ] **Author's eyeball** (desktop, the four seeds; `node scripts/gantt-shots.mjs` writes every Gantt seed's canvas / Display / popup PNGs in both themes to `.dev/shots/gantt/`): the Schedule card's two toggles + Diagnostics
  row; the Gantt card's chip; the figure in a Display, the popup (columns, splitter, Copy SVG),
  a Report overlay + webpage export + Write to Obsidian raster; light theme; the Product launch
  seed's pinned Board review and the deadline pennant; Local File on a `.xml` (a Project export)
  and a Smartsheet CSV.
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

- [ ] **Rebuild the landing + Obsidian pages for the React Flow surface** (`src/graph/landing/`) —
  the scene diagrams are hand-built DOM/SVG replicas of rete-era node chrome; regenerate them to
  match React Flow nodes. Copy was leaned out 2026-09-14 (voice pass, DESIGN §7); the visuals want
  the real rebuild.

## Cables

- [ ] **Mode-change ghost cable — render layer (the last piece).** Option B's LOGIC landed for the
  Input Switch: the One↔Many retype's dropped cables are remembered in `cablePendingStore` and
  re-materialised on the flip back (same key, else same label) — `cablePendingReconnect.ts`,
  wired into `CableSwitchNode`'s `setMode`, cleared on node-remove/load, `cablePendingReconnect.test.ts`.
  REMAINING: the visual — a world-space layer (the `DrawnCableLayer` pattern, in the ViewportPortal)
  that draws each pending ghost dashed from the source `out` socket to the target input socket, in
  the Option A ghost style. Until it lands the reconnect works but is invisible while in the wrong
  mode. (Option A = `cableGhostStore`, live-connection ghosts; archive/dev-notes-history.md 2026-09-08d.)

## Canvas annotation

- [ ] **Drawn cables: nothing tows one.** A drawn arrow annotating a node stays put when that node
  moves, Tidy runs, or a group expands. An optional per-END anchor to a node id would fix it and is
  the natural v2; deliberately out of v1 (they take no part in layout).

## Layout / Tidy

- [ ] **Main-app Tidy reserves DECLARED, not measured, height for a plain node.** `elkTidyLayout`
  reads `node.width/height` for an ordinary card (`tidyArrange.ts` ~473 `return n`); only groups,
  standoff clusters and docked-FC hosts get a `measuredBox`. So a stale constructor height (the
  FrameInput 220→280 case, 2026-09-14) or a collapsed card (reserves the expanded height) mis-spaces
  and can overlap. Scenes already lay out on measured sizes (`SceneStage`). Fix = size a plain node's
  ELK proxy from `measuredBox`, declared height as the unpainted fallback. **COMPARE FIRST:** likely
  was measured once and changed to declared on purpose — find the commit + reason (perf? fixed-point?
  paint timing) before re-introducing. Read subsystem-invariants § Tidy; run the tidy fixed-point tests.

## Formatting & units

- [ ] **Display unit lost on a computed result — shows base SI (regression).** A divide that
  should read `60 km/hr` displays `16.667 m/s`: the magnitude is right (base-SI stored value) but
  the carried/derived display unit isn't applied, so a compound-unit result renders in raw SI.
  Surfaced on the landing units scene (300 km ÷ 5 hr); recently introduced. The SCENE reading was
  traced to the `getOwningEditor` scene-ownership gap and fixed 2026-09-14 (`activeGraph.ts` owned-graph
  registry) — VERIFY a MAIN-app computed result still loses its unit before treating this as live; if
  the main app is clean, delete this. Else fix the display-unit carry.
- [ ] **Triangle Solver's angle inputs are bare degrees** (a rad-tagged trig output wired in
  reads as degrees); a per-input unit read would close it.
- [ ] **blankArgIsExcelBlank — RULED 2026-09-13, not started.** A blank formula argument slot
  (`null` from the parser) is Excel's blank (0 / FALSE / ""); an omitted one (`undefined`) is the
  default. One typed table `{FN: {argIndex: number|logical|text}}` wrapping the fn `fxLookup`
  returns (`excelFunctions.ts` ~220); the `registerInternal` overrides bypass it and are audited
  separately: TEXTJOIN (~969) treats a blank `ignore_empty` as TRUE → must give `a,,b`; ROUND/MOD
  already read a blank as 0 (keep); XLOOKUP/XMATCH `xMatchModeArg`/`xSearchModeArg` (~1261) carry the
  "blank = omitted" SEQUENCE convention to remove (match_mode blank→0 = exact, no behavior change;
  search_mode blank is likely #VALUE! in Excel, verify against the Microsoft reference before
  adding). formulajs candidates to verify empirically: VLOOKUP/HLOOKUP range_lookup (logical),
  MATCH match_type (number). Table-driven parity test, a `rules.md` MUST, a decisions line; remaining
  divergences → `formulajs-divergences.md` + catalog parity:false.
- [ ] **Older long tooltips / descriptions** (Decision Matrix, Sensitivity, Allocator, Record
  layout, Chart values, Slider bounds, 200-plus-character catalog entries) are the copy class the
  2026-09-12b cut fixed for the new nodes; a separate sweep. Author call pending: now or release tail.

- [ ] **LATER (author, 2026-09-04): fold the Format Controller into the Display** — format and
  unit set at sources and displays, flowing downstream only; the docking subsystem and the
  upstream walk go. Analysis + scope in `1.4-plan.md` Track I. Gate: the author's go after the
  downstream-flow work has been lived with, plus the source-node control design.

## Seeds

- [ ] **Seed-layout sweep — the author eyeballs the 20 re-cut seeds** (2026-09-04b, two agent
  batches under the groups-over-standoffs rule in `subsystem-invariants.md` § Standoffs; per-seed
  outcomes in the dev-notes digest). Open calls: power-features kept its `in-sb ↔ grp-mon` data
  standoff because a Note narrates that very bar ("cut it and rewrite the Note?"); famous-math's
  loose expression chain was wrapped beside two pre-existing groups rather than merged. Not swept:
  sudoku-solver, composite-workbench, zz-scratch-new-nodes (not teaching galleries),
  personal-finance and live-market-data (held from tuning, see the 09-03 digest).

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
