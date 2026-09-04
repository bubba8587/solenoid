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

## Formatting & units

- [ ] **NEXT — a frame's per-column FORMAT flows downstream like its unit** (author,
  2026-09-04: Allocator seed → Headroom's column set to Decimal → Display: neither the card frame
  nor the popup shows it). Cause: `FrameColumn.unit` rides the VALUE, but per-column formats
  live in `frameFormatStore` keyed by the authoring node, and a downstream frame renderer reads
  its OWN node's entries. Design: add `format?: FormatAnnotation` to `FrameColumn` beside
  `unit`; the `data()` output pipe (`coerceInputs.ts`'s nodecreated wrapper) stamps it from the
  producing node's `frameFormatStore` picks so it travels through every frame verb the way the
  unit does (verbs that spread columns keep it; check `pivot`/`groupBy`/`unpivot` derived
  columns); `FrameDisplay.fmtCell` and the TablePopup grid use `column.format` as the default,
  a local per-column pick overriding (formatFlowsDownstream, override by the nearer setter).
  Tests: a Frame Input column format survives Sort → Columns → Display; a local override wins;
  persistence unchanged (the store is already per node).
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
