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

- [ ] **Ratify the 1.4 cut** — walk `1.4-plan.md` (the IN / PULLABLE / AUTHOR columns; the
  consolidated author-call list is its last-but-one section) and `2.0-plan.md`; promoted
  items land here as lines.
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The `rules.md` ARR pass** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules (`1.4-plan.md` D3).
- [ ] **Review with the author — the scheduling slice of Track H** (`1.4-plan.md` § Scheduling
  slice, 2026-09-04b): H4 Rota (shift fill-in, round-robin / fewest-hours-first), H5 Spread over
  dates (phasing), H6 Schedule (CPM forward/backward pass), H7 Common free time, plus "hours
  balancing is the Allocator" as a seed. GATE: nothing starts until the author picks; the first
  pass's Hungarian matching + Erlang staffing sit in `deferrals.md`.

## Composites

- [ ] **LATER — Optimize run mode on composites (1.4 A6; author 2026-09-04c: in, not now).** Excel
  Solver's shape as a sixth composite run mode beside Goal Seek; spec + steps in `1.4-plan.md`
  § A6. Gate: the author says go (and settles the constraint forms; integer no).

## Tables

- [ ] **Shared column picker (1.4 B4, author 2026-09-04c).** Sort, Get Column and Join name a
  column as free text today; one picker component lists the columns the incoming frame will
  carry, fed by the static shape (`frameShapeResolver.ts` walks forward from literal sources, so
  it lists before data flows), free-text fallback when the shape is unknown. One component,
  three first customers; picker pure over `FrameShape`; existing suites green. Out: card-side
  format/unit on Computed Column (the popup column row is the one home).
- [ ] **Chip + case compose (1.4 B2.2 follow-up).** The Chip style (LANDED B2.2) shares the
  text-family style dropdown with letter-case, so it's exclusive with UPPER/lower/Proper this
  tranche. If wanted, let a chip also carry a case — a separate `chip` toggle beside the case
  dropdown rather than a fifth dropdown value (`chip` is already its own annotation flag).
  Record color-by and conditional formatting still inherit the one chip mechanism; enum column
  TYPE stays 2.0 (author).

## Sources

- [ ] **Widget nodes Tier 1 (1.4 C1, author 2026-09-04c).** The bundle in `v2.0/16-widget-nodes.md`:
  Weather + Geocode (Open-Meteo), Currency/FX (Frankfurter), Holidays (Nager.Date), Time Zone
  Convert + World Clock (pure `Intl`), QR Code (pure). Each on the Data Feed build (provider file
  + node + component + fixture tests + seed). Defaults taken from the plan unless the author
  overrules: FX in; the three keyless providers as built-in dependencies; the fetching four
  beside the Connections nodes, the pure two in Timesavers; a "Garden Dashboard" seed. Order:
  Geocode + Weather, Holidays, TZ/QR, FX last. Node-design rules in `node-coverage.md`;
  descriptions never explain wiring.

## Finance

- [ ] **Payment breakdown: ONE card (1.4 D2, author 2026-09-04c: in).** IPMT/PPMT (one payment's
  interest / principal share) + CUMIPMT/CUMPRINC (the total over a range of payments) merge:
  op = interest | principal, arg = single period | period range (the `per` socket becomes a
  start/end pair). Same spec-table mechanism as the 09-04c finance cards (`finance.ts` § Spec-table
  op cards, `makeSpecOpComponent`); goldens unchanged; `financeInvariants` + parity + nodeOps /
  formulaNodeCoverage / seeds / catalogRegistry / uiCopy; old saves → Placeholder.

## Display

- [ ] **Expand pop-up on every Display frame / table / list, like the charts** (author,
  2026-09-04b). An expanded Display renders the frame inline with no way into the table
  pop-up, whose per-column format + unit row is real editing surface — today it is reachable
  only by collapsing the Display first and clicking the chip. Give frames, matrices and lists
  the same corner expand affordance every chart gets (`ChartExpandButton` on the sized/full
  figure, pinned by `chartPopupCoverage.test.ts`), opening the same `TablePopup` the chip opens
  (pinned to the Display, `formatNodeId` semantics unchanged). Add the same coverage guard so a
  Display value kind can't ship without a pop-out.

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

## Composites

- [ ] **Docked FCs inside a drill-in don't recenter** (2026-09-04c, from the E2 audit) —
  `FlowCompositeOverlay`'s arrange factory passes `repositionDockedTo: () => {}` and the
  component/keyboard callers hit the MAIN `repositionDocked` slot, so a Format Controller docked
  in a composite doesn't follow its host on resize / format change / Tidy. Component reflow, not a
  chrome verb (out of E2's scope). Fix by giving the drill-in a real reposition through the seam.
