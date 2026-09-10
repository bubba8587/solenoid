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
- [ ] **Author's desktop eyeball** of the flagship cards against `demo-vault/` (Settings ▸ Obsidian
  → the repo's demo-vault): Vault Folder (be's ten-step checklist in the 09-07 digest), Write
  Properties Preview/Run on a copy, TaskNotes with the plugin's API on, Write to Obsidian block mode
  + `{{daily}}`, Write Properties' `writeBase` view, the Cube Input editor's three drill targets.
- [ ] **Knap follow-ups** (bodies are templates since 2026-09-10): tag highlighting in the
  Report source pane; a Filters cheat-sheet reachable from the overlay (the `knap` package
  exports `standardFilterMetadata` with examples); `{{ chart }}` could mint a `=chart` ref span
  instead of reading as null.

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
