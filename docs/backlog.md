# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.3 shipped** (v1.3.0 on `main`; `develop` is
level with it). **The 1.4 cut is PROPOSED, not ratified:** `1.4-plan.md` scores every
deferred idea and carries the per-item plans; nothing there is scheduled until the author
promotes it — a promoted item becomes a line here and its plan section is the spec. The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale: `decisions.md`.

## Dependency updates (walking them one at a time; TypeScript 7 landed 2026-08-11a)

Current state (2026-09-04): the walkable set is on latest in-range (`react` 19.2.8,
`vite` 8, `@xyflow/react` 12.11.6, the Tauri plugins, etc. — git has the walk), and
`@anthropic-ai/sdk` is on 0.123 (the palette's `beta.messages` surface, error classes
and client options were untouched across those majors). Remaining major: `vitest` 5
(4.1.11 stands). The rete RENDER packages and `styled-components` were removed outright
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

## Tables

- [ ] **Chip + case compose (1.4 B2.2 follow-up).** The Chip style (LANDED B2.2) shares the
  text-family style dropdown with letter-case, so it's exclusive with UPPER/lower/Proper this
  tranche. If wanted, let a chip also carry a case — a separate `chip` toggle beside the case
  dropdown rather than a fifth dropdown value (`chip` is already its own annotation flag).
  Record color-by and conditional formatting still inherit the one chip mechanism; enum column
  TYPE stays 2.0 (author).

## Sources

- [ ] **Widget nodes Tier 1 — follow-ups (1.4 C1).** All six shipped (Geocode, Weather,
  Holidays, Time Zone Convert, World Clock, Currency/FX, QR Code) + the Garden Dashboard seed.
  Left for the author to rule on (Lead is surfacing): FX time-series/Chart frame (Frankfurter has
  it, dropped for v1); Time Zone Convert From/To as curated zone pickers vs the current wireable
  text fields; TZ Convert result defaulting to a datetime format on the card. Tier 2 (`v2.0/16`):
  Air Quality/Pollen preset of Weather, Ticking Now timer.

## Finance

- [ ] **Payment breakdown: ONE card (1.4 D2, author 2026-09-04c: in; designed, not started).**
  `PaymentBreakdownNode`, one `op` = ipmt | ppmt | cumipmt | cumprinc; two toggles SET it — Share
  (Interest | Principal) flips within the pair, Span (One period | Range) flips the pair AND drives
  the reshape; payment timing stays an arg toggle. Keys: single = [rate, per, nper, pv, fv];
  range = [rate, nper, pv, start, end]; shared sockets keep cables via `keysDroppedBySwitch` +
  `reshapeInputs` (`finance.ts` § Spec-table op cards), component hand-rolled like
  AccruedInterest. Math copied VERBATIM from `IpmtPpmtNode.data()` / `CumPmtNode.data()` (goldens
  byte-identical); nodeExcel merges the four names under one key; the two catalog pairs
  (`ipmtPpmtLeaf` / `cumPmtLeaf`) become one "Payment Breakdown" leaf; retired names "IpmtPpmt" /
  "CumPmt" → Placeholder (registry test). Suites: financeInvariants, parity, nodeOps,
  formulaNodeCoverage, seeds, catalogRegistry, uiCopy.

## Obsidian + TaskNotes (author 2026-09-07: THE adoption bet — correct, great, useful)

The bundle `v2.0/24-obsidian-vault.md` is promoted to the flagship track; its § Defaults are the
build rules and § Sequencing the order (A′ → A → B → D → C → F → I → J → E). Every item ships
verified in the desktop app against the demo vault. Landed ledger: the bundle's § What stands today.

- [ ] **AddColumn over a cube** (fe): Add Column is frame-only; Computed Column already takes a cube.
- [ ] **TaskNotes read vs a plain vault query** (author, review): the TaskNotes read node overlaps
  Vault Folder for the common case — title/status/priority/due/tags are just frontmatter. The HTTP
  API earns its keep only for recurrence expansion, `timeEntries` totals, user-remapped field names,
  and write-back-with-webhooks. Consider whether the read node stays, or folds into a `tags contains
  task` recipe over Vault Folder. (dev-notes 2026-09-11.)
- [ ] **Daily-notes targeting** (author, keep — the removed `{{daily}}` successor): a way to write
  today's daily note in its configured folder + format, wireable (a source node emitting the
  daily-note path from `.obsidian/daily-notes.json`, not inline template syntax). Not necessarily a
  node — still shaping. (dev-notes 2026-09-11.)
- [ ] **Knap for dynamic write paths / content** (author, parked): use Knap to template a Write to
  Obsidian `path` or the written body from wired values — the successor to the removed `{{date}}`
  grammar, now that `path` is a plain wireable string.
- [ ] **Frame-only verbs over a cube** (fe): Window / GROUPBY / Chart's frame input still refuse a
  live `cube`, so charting or smoothing a Vault Folder needs a cube→frame step (A′ extended, or a
  Cube → Frame node). Today the `daily-habits` seed runs its Window on a snapshot for this reason.
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
- [ ] **Knap help page** (`src/graph/help/`, DESIGN § 7): the syntax, the bare-tag rule, the
  Template/Records inputs, the `{{ "{" }}{ x }}` escape, the upstream gotchas a user will hit.
- [ ] **Batch cap surfaced**: `MAX_PAGES` truncates silently; the overlay stepper and the sink
  status should say "500 of N".
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

- [ ] **Author's eyeball** (desktop, the three seeds): the Schedule card's two toggles + Diagnostics
  row; the Gantt card's chip; the figure in a Display, the popup (columns, splitter, Copy SVG),
  a Report overlay + webpage export + Write to Obsidian raster; light theme; the Product launch
  seed's pinned Board review and the deadline pennant; Local File on a `.xml` (a Project export)
  and a Smartsheet CSV.
- [ ] **Project-exported goldens** (author): export MSPDI from a Project trial / 2024 for the two
  seeds' plans and drop them in `fixtures/schedule/` as `project-*.mspdi.xml`; the parity test
  picks them up; name any disagreement in `divergences.json`. Until then the corpus is authored.
- [ ] **Minutes-mode cells show times**: a date column formats date-only, so a 13:00 start reads
  as its day; the FC's datetime format is the workaround. Consider stamping a datetime format
  on Start / Finish when precision is Minutes.
- [ ] **Still adjacent** (§ 12): resource leveling (ruled out by the plan); the
  by-row portfolio mode (needs composite by-row iteration over a cube); XER's `clndr_data`.

## Canvas chrome (queued by the author 2026-09-07, "not top priority")

- [ ] **Collapsed stadium pill hover preview** — a collapsed node's input pill shows a hover
  preview listing EVERY cable item (name + value), not just the first. Author's extension to
  consider with it: a special Conduit → bundled cable → Cube node (the bundle's lanes land as one
  cube). Design first (DESIGN.md, `subsystem-invariants.md` § Conduit faces); stage after the
  Obsidian track.

## Cables

- [ ] **Mode-change ghost cable — socket-REMOVING swaps (approved by author, do later).** Option A
  landed: Group Cost Settle retypes its `in` socket in place on a mode flip, so the cable survives
  and `cableGhostStore.mark`/`commit` ghosts it until it's valid again (dev-notes 2026-09-08). Option
  B is the harder case — a swap that fully REMOVES a socket (Workdays days↔end, Record op sockets)
  drops the cable outright, so there's no real connection left to ghost. It needs a separate
  "pending-reconnect" ghost that isn't a real `rete` connection, with its own render layer, that
  re-materializes the cable once a compatible socket returns. Design note: target the fix on the
  **Input Switch (`CableSwitchNode`)** specifically — the node whose output type actually drives the
  detach — rather than teaching every downstream mode-swapping node to ghost.

## Canvas annotation

- [ ] **Drawn cables: nothing tows one.** A drawn arrow annotating a node stays put when that node
  moves, Tidy runs, or a group expands. An optional per-END anchor to a node id would fix it and is
  the natural v2; deliberately out of v1 (they take no part in layout).

## Formatting & units

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
