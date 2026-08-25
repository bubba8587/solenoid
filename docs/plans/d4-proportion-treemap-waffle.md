# D4 — Proportion: Treemap + Waffle → one chart card

Work in your own git worktree (`git worktree add ../solenoid-<agent> -b <agent>/d4-proportion develop`),
commit there, then rebase onto develop and merge — never push.

**Goal.** One "Proportion" figure node with a Treemap | Waffle `op` selector (Gauge-style
SegToggle bound to `op`, `kind: "operation"`). Both are already frame(label, value) →
chart-payload figures on the same chart-card surface, so unlike Gauge+Bullet there is NO
pass-through contract change: both stay chart nodes. Sankey stays its own node in the
Proportion category. Old "Treemap"/"Waffle" saves load as Placeholders (no alias).

**Precedent.** `git show fc0ecd4a` (Gauge absorbs Bullet) — same file set, same shape of change.

**Read first.** CLAUDE.md (node-combining rules), `docs/code-comments.md`, `src/graph/nodes/visual.ts:334-420`
(GaugeNode: `op`, `setOp`, `keysDropped`), `src/graph/components/GaugeNode.tsx` (the picker + prune).

## Pointers (verified 2026-08-25)

| What | Where |
|---|---|
| TreemapNode | `src/graph/nodes/visual.ts:521-556` (frame→`TreemapPayload`, op `"treemap"`, `cachedPayload`) |
| WaffleNode | `src/graph/nodes/visual.ts:951-988` (op `"waffle"`, `cachedChart`; values fall back to `cols[0]` when 1-col) |
| Payload types | `src/graph/chartValue.ts:30` `TreemapPayload`, `:95` `WafflePayload`; unions `:150-152`, op union `:156-157` |
| Renderer branch | `src/graph/components/chartView.tsx:127-128` (treemap), `:143-144` (waffle) |
| Views | `chartRender.tsx:422` `TreemapView` (lazy via `chartView.tsx:23,62`), `chartCanvasViews.tsx:585` `WaffleView` |
| Components | `components/TreemapNode.tsx` (bespoke card), `components/FigureNodes.tsx:71` `WaffleComponent` (generic `makeFigureComponent`) |
| Component index | `components/index.ts:278` (Treemap), `:283` (Waffle) |
| Registry | `nodeRegistry.ts:9-10` imports, `:84-85`, `:188`, `:195` |
| Catalog | `nodeCatalog.ts:4-5` imports; Proportion category `:262-266` (treemap `:264`, waffle `:266`); Chart Builder blurb `:247` |
| nodeOps | `nodeOps.ts:144-148` (Gauge row — the model: `kind:"operation"`, NO op rows) |
| kind.ts | `:49` import; `:81-82` display; `:253` heavy=10 (Treemap), `:284` figure=true (Treemap) |
| Chart Builder targets | `nodes/chartOptions.ts:133-134` `ChartTargetId`, `:148` treemap STAT_KEYS, `:154` waffle TITLE_ONLY |
| Seeds | `seedGraphs/chart-showcase.json:155-156` (`"type": "TreemapNode"`); no Waffle seed |
| Tests | `nodes/visual.test.ts:352-361` (Waffle), `nodes/kind.test.ts:42` (TreemapNode in the figure list) |
| Docs | `docs/node-coverage.md:45` (the "Proportion CATEGORY (Treemap / Sankey / Waffle)" and "Twelve figures … Treemap, … Waffle" mentions) |

## Steps

1. **Payload.** In `chartValue.ts` replace both interfaces with
   `ProportionPayload { kind: "proportion"; layout: "treemap" | "waffle"; names: string[]; values: number[] }`;
   update the `ChartPayload` union and the op union (`"treemap" | "waffle"` → `"proportion"`).
2. **Node.** In `visual.ts` rename `TreemapNode` → `ProportionNode` (`super("Proportion")`, label
   "Proportion"), add `export type ProportionLayout = "treemap" | "waffle"`, `PROPORTION_LAYOUT_OPTIONS`
   (SegToggle options, mirror `GAUGE_STYLE_OPTIONS:335`), field `op: ProportionLayout = "treemap"`,
   ctor `init?: { label?: string; op?: ProportionLayout }`, `setOp(next)`. Sockets are IDENTICAL for both
   layouts (`frame`, `options`) → no socket swap, no `keysDropped`/`dropInputCables` needed. `data()`:
   values = `colAsNumbers(cols[1] ?? cols[0])` (Waffle's 1-col fallback is a superset; keep it for both),
   emit `{ op: "proportion", payload: { kind: "proportion", layout: this.op, names, values } }`, title falls
   back to `"Proportion"`. Keep ONE cache field — `cachedChart: ChartValue | null` (the generic figure
   component reads that). Delete `WaffleNode`. Keep the frameHints (use Treemap's).
3. **Renderer.** `chartView.tsx:127-144`: one branch
   `if (value.op === "proportion" && value.payload?.kind === "proportion") return layout === "treemap" ? <TreemapView …/> : <WaffleView …/>`
   (WaffleView takes the payload — its prop type becomes `ProportionPayload`; `chartCanvasViews.tsx:331`
   `drawWaffle` likewise). `chartOptions.ts`: replace the `treemap`/`waffle` target ids with one
   `proportion: { label: "Proportion", keys: STAT_KEYS }` (treemap read fontsize; a superset is inert for waffle
   per the existing "inert option" rule); fix the `visual.test.ts:165` `target: "waffle"` builder test.
4. **Component.** Delete `components/TreemapNode.tsx`. In `FigureNodes.tsx` replace `WaffleComponent` with
   `ProportionComponent`: it must add the SegToggle above `InlineInputs`, so extend `makeFigureComponent`
   with an optional `controls?: (data) => ReactNode` slot (the Gauge pattern: `useState(data.op)`,
   `data.setOp(next)`, `area.update("node", id)`, `processGraph()`; no prune — sockets don't change).
   Figure height 170; `hasData` = `p?.kind === "proportion" && p.values.some(v => v > 0)`.
5. **Registration.** `index.ts`, `nodeRegistry.ts`, `nodeCatalog.ts` (ONE leaf: `type: "proportion"`,
   label "Proportion", description covering both layouts in §7 voice, keywords must include `treemap tree map
   rectangles waffle squares dot matrix proportion share percentage pictogram`), `nodeOps.ts` (a Gauge-style
   row `{ type: "proportion", ctor: ProportionNode, kind: "operation" }` — no op rows; the layout names ride the
   leaf keywords), `kind.ts` (all four mentions → `ProportionNode`). `op` persists via `INIT_FIELD_ORDER`
   already (`copyPaste.ts:73`).
6. **Seeds + tests + docs.** `chart-showcase.json:156` → `"type": "ProportionNode"` (keep `"init"`; treemap is
   the default op). Retarget `visual.test.ts:352` to ProportionNode and add: default layout treemap; `{op:"waffle"}`
   emits `layout:"waffle"`; `setOp` round-trips through `extractInit` (mirror `:89-92`). `kind.test.ts:42`.
   Chart Builder blurb `nodeCatalog.ts:247` and `docs/node-coverage.md:45` mentions → Proportion.
7. `npx tsc --noEmit`; `npx vitest run src/graph/nodes/visual.test.ts src/graph/nodes/kind.test.ts src/graph/nodeOps.test.ts src/graph/formulaNodeCoverage.test.ts src/graph/seeds.test.ts src/graph/catalogSearch.test.ts src/graph/nodes/wiredNull.test.ts`;
   then the full suite. One commit (paths only).

## Done when

- One `ProportionNode`; `TreemapNode`, `WaffleNode`, `TreemapNode.tsx` gone; no `"treemap"`/`"waffle"` chart op
  or payload kind anywhere (`grep -rn '"treemap"\|"waffle"' src` hits only the layout literal + keywords).
- Report embed, popup and card all render both layouts through the one `chartView.tsx` branch.
- Full suite green; digest line in `docs/dev-notes.md`; backlog "Node-combining parked" untouched (this item
  lived only on the coordination board); delete this plan; README row struck.
- Author eyeball at localhost:1420: `chart-showcase` seed's Spending card shows the treemap; flip the toggle →
  waffle; Chart Builder's dropdown lists Proportion once.
