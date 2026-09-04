# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.3 shipped** (v1.3.0 on `main`; `develop` is
level with it). **The 1.4 cut is PROPOSED, not ratified:** `1.4-plan.md` scores every
deferred idea and carries the per-item plans; nothing there is scheduled until the author
promotes it — a promoted item becomes a line here and its plan section is the spec. The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale: `decisions.md`.

## Dependency updates (walking them one at a time; TypeScript 7 landed 2026-08-11a)

Current state (2026-08-26): the walkable set is on latest in-range (`react` 19.2.8,
`vitest` 4.1.11, `vite` 8, etc. — git has the walk); the rete RENDER packages and
`styled-components` were removed outright by the React Flow cutover (rete core
2.0.6 + rete-engine + elkjs 0.12 + `@xyflow/react` remain). Remaining major:
`@anthropic-ai/sdk` 0.120 (skipped). The `.npmrc` `legacy-peer-deps` workaround is
REMOVED — the old elkjs-vs-rete-auto-arrange peer conflict left with the plugin
(clean `npm install` dry-run verified).

## Release planning (author-run)

- [ ] **Ratify the 1.4 cut** — walk `1.4-plan.md` (the IN / PULLABLE / AUTHOR columns; the
  consolidated author-call list is its last-but-one section) and `2.0-plan.md`; promoted
  items land here as lines.
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The `rules.md` ARR pass** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules (`1.4-plan.md` D3).

## Records & Frame Input

- [ ] **Form-layout hide toggle.** Frame Input → Add Form Layout: the layout box wants a small
  ✕ in its top-right corner that hides AND disables the entered form layout — WITHOUT deleting
  it (the layout text is kept, just inert until re-enabled).

## Engine & types

- [ ] **Frame shapes: declarative per-node, retire the central resolver.** Today
  `frameShapeResolver.ts` is one `instanceof` chain that knows each frame producer's output
  columns; only ~17 of ~34+ producers are covered, so the rest degrade to `trueany` (INDEX/unit
  flow/conduit trace/display lose the column types). **Decision:** each frame-producing node
  declares its own output shape — a `frameShape(inputShapes) => Shape | null` hook (the producer
  sibling of `passthrough()`): shape-preserving verbs forward the input shape, transformers print
  their own, data-dependent producers (KMeans/PCA/Logistic/Data Feed/HTML-XML import) return null.
  The graph walk stays but goes node-agnostic (resolve inputs → call the node's hook); the
  `instanceof` chain is deleted as it empties. Migrate the existing ~17 rules onto their nodes and
  add the missing computable ones (DropBlankRows/FillBlanks/ReplaceValues forward; AddColumn/
  ComputedColumn/BindColumns/MergeColumns/Headers/Allocator add typed columns; BuildFrame/
  FrameFromLists/Reconcile/Describe/CorrMatrix/Window compute). **Interim:** the DecisionMatrix +
  Note-frame rules added to the resolver 2026-09-04 are scaffolding to migrate here.

## Seeds

- [ ] **Seed-layout sweep for whole-canvas Tidy.** Full-canvas Tidy (baked into every seed via
  `tune-seeds`) scatters free-floating Notes. Go through the seed library adding **groups**
  (liberally: wrap intermediary clusters and an input beside its consumer) and, sparingly, a
  **note-standoff** — ONLY to pin an explanatory Note that is not otherwise wired to the node/group
  it explains (a Note whose frontmatter exports feed the graph is already tied in; data nodes never
  standoff to their consumers). Author's ruling 2026-09-04: the first decision-matrix pass (7
  standoffs, input→consumer ones included) overused them; that seed is being re-cut to the rule and
  becomes the exemplar. Re-tune after each seed.

## Layout

- [ ] **Flipped-node Tidy places it up-and-left; want down-and-left.** The predecessor
  hack (reversed ELK edge) leaves the flipped node's vertical order to ELK crossing-min,
  which stacks it above its neighbor. Needs a within-layer ordering lever (position
  choice / model order) to bias it below. Cosmetic; the leftward part is correct. Candidate
  lever (untried, 2026-09-04): `elk.layered.considerModelOrder.strategy=NODES_AND_EDGES` (+
  `crossingMinimization.forceNodeModelOrder`) with the flipped node emitted AFTER its neighbor
  in the ELK children order — global, so it also re-breaks every other layer's ties; verify
  with `scripts/layout-probe.mjs` before keeping.
