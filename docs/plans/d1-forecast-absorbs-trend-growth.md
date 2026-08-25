# D1 — Forecast absorbs TREND + GROWTH (one prediction card)

Work in your own git worktree (`git worktree add ../solenoid-<agent> -b <agent>/<plan> develop`), commit there, then fast-forward/rebase onto develop and merge — never push.

**Backlog line:** `backlog.md` "Node-combining parked" → "TREND ⊂ FORECAST.LINEAR".
**Scope (Lead call, settled):** ONE `ForecastNode` with a linear|exponential `op`
(kind:"operation", selectorNamedOp) and a COMBO `x` (scalar in → scalar out, list in →
list out, mirroring INTERPOLATE's `new_xs`). `TrendNode` is deleted. The three formula
names FORECAST.LINEAR / TREND / GROWTH stay callable — they are registered independently
in `excelFunctions.ts` (`registerInternal`, node-agnostic); only `nodeExcel.ts` reroutes.
Precedents: Gauge+Bullet `fc0ecd4a` (op selector + onePrunePath), Sort+SortBy `a9199ac8`
(absorb + delete + nodeExcel aliases). `git show --stat` both before starting.

Read first: `CLAUDE.md` (Node combining bullets), `docs/rules.md` §selectorNamedOp,
§onePrunePath, §uniqueNameMap, `docs/value-semantics.md` "Reading an input".

## Anchors (verified 2026-08-25 — grep the symbol if drifted)

| What | Where |
|---|---|
| `ForecastNode` | `src/graph/nodes/stats.ts:357` (`x` numIn, `ys`/`xs` listIn, `result` numOut; `data()` 379) |
| `TrendNode` (`mode`, `expFit` branch, unwired `new_xs` → known xs) | `src/graph/nodes/stats.ts:776`–826 |
| Fitting kernels `linearFit` / `expFit` | `src/graph/nodes/mathUtils.ts:208` / `:249` |
| Combo-x precedent (`numListIn("X")`, `readInput` → scalar-or-array, `numListOut`) | `InterpolateNode._rebuildSockets` `stats.ts:889`–892, `dataList` `:899`–927 |
| Components | `src/graph/components/ForecastNode.tsx` (`makeNodeComponent`), `TrendNode.tsx` (`makeToggleNodeComponent` over `mode`) |
| Component exports | `src/graph/components/index.ts:102` (Forecast), `:221` (Trend) |
| Registry | `src/graph/nodeRegistry.ts:30/33` (class imports), `:106/110` (component imports), `:314` `[ForecastNode…]`, `:324` `[TrendNode…]` |
| Catalog leaves | `src/graph/nodeCatalog.ts:605` (forecast), `:612` (trend); class imports `:61/:65` |
| Kind table | `src/graph/nodes/kind.ts:32` (ForecastNode import), `:119` (math-kind list; TrendNode is NOT listed — check what kind it resolves to today and keep Forecast's) |
| nodeExcel MAP | `src/graph/nodeExcel.ts:185` `"forecast"`, `:505` `"trend"`, `:557` GROWTH gap row ("no node yet") |
| Op declarations | `src/graph/nodeOps.ts:138` `NODE_OPS` (`fromMeta` `:97`, `OpEntryDecl` `:93`) |
| Tests touching Trend | `src/graph/rangeRouting.test.ts:3,116–133`, `src/graph/nodes/listExtras.test.ts:141–149`, `src/graph/nodes/stats.test.ts:176`, `src/graph/formulaTier1.test.ts:167`, `src/graph/formulaNodeCoverage.test.ts:41` (`GROWTH: "TREND node (exponential mode)"`) |
| Seeds | none reference `TrendNode`/`ForecastNode` (grep `"type": "TrendNode"` → 0); still run `seeds.test.ts` |
| Coverage doc | `docs/node-coverage.md` (grep `TREND`) |

## Steps (one tsc-green commit; touching shared files nodeCatalog/nodeRegistry/nodeExcel/nodeOps/components-index/kind — check `git status` first, coordinate on the board if peer-dirty)

1. **`stats.ts` — rebuild `ForecastNode`.**
   - `export const FORECAST_OP_META = { linear: { label: "Linear", fx: "FORECAST.LINEAR" }, exponential: { label: "Exponential", fx: "GROWTH" } } as const;` + `export type ForecastOp = keyof typeof FORECAST_OP_META`. `fx` is DECLARED (Excel spellings; despacing "Linear" would not yield the name — uniqueNameMap).
   - Field `op: ForecastOp = "linear"`; ctor `init?: { label?; op? }`. Label stays `"FORECAST.LINEAR"`.
   - `x`: `numIn("X")` → `numListIn("X")`; `result`: `numOut` → `numListOut("Result")`. NO socket swap on op change (same shape both ops) → no `keysDropped`/`dropInputCables` needed; a plain `setOp`.
   - `data()`: copy `InterpolateNode.dataList`'s query handling — `readInput(inputs.x, this.literals.x)`; SolError → propagate; array → per-element (null stays null in place, empty → `[]`); scalar → scalar; `cachedResult` typed `number | (number|null)[] | SolError | null`. Fit once: `op === "exponential"` → `expFit` (null fit → the quiet empty/null, matching the LOGEST/TREND convention already pinned in rangeRouting) else `linearFit` (null fit → `#DIV/0!` "Known Xs have zero variance" — keep, it's pinned by `stats.test.ts:176`). Keep `socketDocs.ys`; add `x: "One X or a list of them; the result takes the same shape. Unwired: …"` only if the wired-blank row (value-semantics) needs stating — otherwise omit.
   - Delete `TrendNode` entirely (776–826). Remove `expFit` from the import only if no other user remains (`grep expFit stats.ts`).
2. **Component.** `ForecastNode.tsx` → `makeToggleNodeComponent<ForecastNode, ForecastOp>({ read: n => n.op, write: (n, o) => { n.op = o; }, options: [{ value:"linear", label:"linear", title:"Straight-line fit (Excel FORECAST.LINEAR / TREND)" }, { value:"exponential", label:"exp", title:"Growth-curve fit y = b·mˣ (Excel GROWTH)" }] }, n => n.cachedResult)` — the exact shape `TrendNode.tsx` has today, bound to `op` (sourceInvariants "every non-arg op picker binds `op`"). Delete `TrendNode.tsx`; drop `index.ts:221`.
3. **Registry / kind / catalog.** Remove `TrendNode`/`TrendComponent` from `nodeRegistry.ts:33/110/324`, `nodeCatalog.ts:65`. Delete the `trend` leaf (`nodeCatalog.ts:612`); rewrite the `forecast` leaf (`:605`): label `FORECAST.LINEAR`, description in §7 voice covering both ops ("Predict Y for one X or a list of them from known data — a straight line (FORECAST.LINEAR / TREND) or a growth curve y = b·mˣ (GROWTH)."), `parity: false`, keywords `"forecast trend growth predict linear exponential regression fit extrapolate"`. `kind.ts`: nothing to add (ForecastNode already listed at `:119`); confirm `TrendNode` isn't imported there.
4. **`nodeOps.ts`.** Add `{ type: "forecast", ctor: ForecastNode, kind: "operation", ops: fromMeta(FORECAST_OP_META), create: (op) => new ForecastNode({ op: op as never }) }` — Add-menu search then finds "FORECAST.LINEAR · Linear" and "· Exponential" with the Excel fx names (catalogSearch pin: every op leaf findable by the card name).
5. **`nodeExcel.ts`.** `"forecast"` (`:185`) becomes three rows: FORECAST.LINEAR (parity true, note "x may be a list"), TREND (parity false, carry the existing note from `:505`), GROWTH (parity false, note "Exponential op"). Delete `"trend"` (`:505`) and the GROWTH gap row (`:557`).
6. **Tests.**
   - `rangeRouting.test.ts`: replace `new TrendNode()` with `new ForecastNode()` (`x` list, unwired → NOT a default any more: TREND's "omitted new_xs = known xs" is a FORMULA behaviour; on the node, `x` blank → null per the wired-blank table. Pin that: `data({ ys, xs })` → `null`; `data({ x: [[5,6]], ys, xs })` → `[11, 13]`; exponential op → `[32]` at x=5). Keep the formula assertions unchanged.
   - `listExtras.test.ts:143–145`: `new ForecastNode({ op: "exponential" }).data({ x: [[4]], … })` → `[16]`.
   - `formulaNodeCoverage.test.ts:41`: `GROWTH: "Forecast node (exponential op)"`, add `TREND: "Forecast node (list X)"` if TREND is now node-mapped through nodeExcel rather than a bare gap (run the test; it tells you).
   - `stats.test.ts:176` / `formulaTier1.test.ts:167`: `x: [3]` still works (scalar path) — verify green, no edit expected.
   - Run `nodeOps.test.ts`, `catalogSearch.test.ts`, `seeds.test.ts`, `sourceInvariants.test.ts`, `parity`/`catalog` suites, then the full `npx vitest run`.
7. **Docs.** `docs/node-coverage.md`: TREND row → folded into Forecast. One digest line in `docs/dev-notes.md`; delete the backlog line; delete this plan; commit by pathspec.

## Done when
`npx tsc --noEmit` clean; full vitest green; Add-menu search "trend" and "growth" both land on Forecast; a Forecast card shows the linear/exp toggle, accepts a scalar OR list X and mirrors its shape; `TrendNode`/`TrendComponent` gone from the repo (`grep -r TrendNode src` → 0). Author eyeballs at http://localhost:1420: toggle on the card, scalar X hero value vs list X chip.
