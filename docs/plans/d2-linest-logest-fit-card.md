# D2 — LINEST + LOGEST → one Fit card (linear | exponential op)

Work in your own git worktree (`git worktree add ../solenoid-<agent> -b <agent>/<plan> develop`), commit there, then fast-forward/rebase onto develop and merge — never push.

**Backlog line:** `backlog.md` "Node-combining parked" → "Related: LINEST + LOGEST differ only in model → model selector."
**Scope (Lead call, settled):** ONE `LinestNode` (label `LINEST`) with a linear|exponential `op`
(kind:"operation", selectorNamedOp). **NO socket swap** — one output trio for both ops:
linear = slope / intercept / r²; exponential = LOGEST's `m` / `b` (y = b·mˣ) / r² of the fit
on the LOG scale (Excel LOGEST stats=TRUE). Socket LABELS retitle with the op (Slope→m,
Intercept→b); keys `slope`/`intercept`/`r2` stay so cables survive the switch. `LogestNode`
is deleted. LINEST and LOGEST formulas stay callable (registered independently in
`excelFunctions.ts`). Precedent: Gauge+Bullet `fc0ecd4a`; D1 is the sibling plan (same
files — do NOT run both in one worktree at once; rebase after the other lands).

Read first: `CLAUDE.md` (Node combining), `docs/rules.md` §selectorNamedOp §uniqueNameMap,
`docs/value-semantics.md` "Reading an input".

## Anchors (verified 2026-08-25 — grep the symbol if drifted)

| What | Where |
|---|---|
| `LinestNode` (outputs `slope`/`intercept`/`r2`, `linearFitR2`) | `src/graph/nodes/stats.ts:947`–981 |
| `LogestNode` (`expFit` → `[m, b]` list, `listOut`) | `src/graph/nodes/stats.ts:985`–1010 |
| Kernels `linearFitR2` / `expFit` (`expFit` = `linearFit` over `log(y)`, all y > 0 else null) | `src/graph/nodes/mathUtils.ts:228` / `:249` |
| Components | `src/graph/components/LinestNode.tsx` (`NodeShell` + `InlineOutputRows` three rows), `LogestNode.tsx` (`makeNodeComponent`) |
| Op-toggle precedent inside a hand-written component | `src/graph/components/GaugeNode.tsx:20–33` (`useState(data.op)`, `SegToggle`, `setOp`, `area.update`, `processGraph`) |
| Component exports | `src/graph/components/index.ts:223` (Linest), `:224` (Logest) |
| Registry | `src/graph/nodeRegistry.ts:33/110` imports, `:330` `[LinestNode…]`, `:331` `[LogestNode…]` |
| Catalog leaves | `src/graph/nodeCatalog.ts:604` (linest), `:607` (logest); imports `:65` |
| Kind table | `src/graph/nodes/kind.ts` — grep `LinestNode`/`LogestNode`; keep Linest's kind, drop Logest |
| nodeExcel MAP | `src/graph/nodeExcel.ts:225`–230 `"linest"` (INTERCEPT/LINEST/RSQ/SLOPE rows), `:246` `"logest"` |
| Op declarations | `src/graph/nodeOps.ts:138` `NODE_OPS`; `fromMeta` `:97`; `OpEntryDecl` `:93` |
| Tests | `src/graph/rangeRouting.test.ts:3, 135–153` (LINEST trio, LOGEST `[m,b]` + y ≤ 0 → `[]`) |
| Seeds | none reference either class (grep `"type": "LogestNode"` → 0); still run `seeds.test.ts` |
| Coverage doc | `docs/node-coverage.md` (grep `LOGEST`) |

## Steps (one tsc-green commit; shared files nodeCatalog/nodeRegistry/nodeExcel/nodeOps/components-index/kind — `git status` first)

1. **`mathUtils.ts`.** Add `expFitR2(xs, ys): { m; b; r2 } | null` — same guard as `expFit` (any y ≤ 0 → null), then `linearFitR2(xs, log(ys))` and `exp` the slope/intercept; `r2` is the log-scale r² as-is. Leave `expFit` in place (the GROWTH/LOGEST registrations + D1 use it).
2. **`stats.ts` — rebuild `LinestNode`.**
   - `export const FIT_OP_META = { linear: { label: "Linear", fx: "LINEST" }, exponential: { label: "Exponential", fx: "LOGEST" } } as const; export type FitOp = keyof typeof FIT_OP_META;` — `fx` DECLARED (Excel spellings, uniqueNameMap).
   - Field `op: FitOp = "linear"`; ctor `init?: { label?; op? }`; label stays `"LINEST"`.
   - Outputs unchanged in KEY and TYPE (`numOut` ×3). `setOp(next)`: set `op`, retitle `this.outputs.slope.label` = op linear ? "Slope" : "m", `intercept` → "Intercept" | "b", `r2` → "R²" | "R² (log)". No input change → no `keysDropped`, no `dropInputCables`.
   - `data()`: `op === "exponential"` → `expFitR2`, mapping `m→slope`, `b→intercept`; else `linearFitR2`. A null fit → three nulls (today's LINEST behaviour; LOGEST's old quiet `[]` becomes nulls on the node — the FORMULA `LOGEST` keeps `[]`, pinned at `rangeRouting.test.ts:152`).
   - `socketDocs.ys`: extend with "Exponential: every Y must be > 0."
   - Delete `LogestNode` (`:985`–1010).
3. **Component.** `LinestNode.tsx`: add `const [op, setOp] = useState<FitOp>(data.op)` + `<SegToggle arg value={op} options={FIT_OP_OPTIONS} onChange={pick} />` above `InlineInputs` (export `FIT_OP_OPTIONS` from stats.ts next to the meta, like `GAUGE_STYLE_OPTIONS`); `pick` = `data.setOp(next); setOp(next); await getActiveArea()?.update("node", data.id); await processGraph();`. The `rows` labels read from `data.outputs[key].label` so they retitle with the op. Delete `LogestNode.tsx`; drop `index.ts:224`.
4. **Registry / kind / catalog.** Remove `LogestNode`/`LogestComponent` (`nodeRegistry.ts:33/110/331`, `nodeCatalog.ts:65`, `kind.ts`). Delete the `logest` leaf (`:607`); rewrite `linest` (`:604`): description "Fit a line (LINEST: slope, intercept, R²) or a growth curve y = b·mˣ (LOGEST: m, b, R² on the log scale) through known data. Three outputs, wired individually. Supersedes SLOPE, INTERCEPT, RSQ.", `parity: false`, keywords `"linest logest slope intercept rsq regression fit linear exponential growth curve least squares"`.
5. **`nodeOps.ts`.** `{ type: "linest", ctor: LinestNode, kind: "operation", ops: fromMeta(FIT_OP_META), create: (op) => new LinestNode({ op: op as never }) }`.
6. **`nodeExcel.ts`.** Move the `:246` LOGEST row into the `"linest"` array (note: "Exponential op — m, b, R² as three sockets; Excel returns a coefficient array"); delete `"logest"`.
7. **Tests.** `rangeRouting.test.ts:147–153`: `new LinestNode({ op: "exponential" }).data(…)` → `slope`≈2, `intercept`≈1 vs `ev("LOGEST(y,x)")[0..1]`; y ≤ 0 → three nulls on the node, `[]` on the formula. Add one `mathUtils` pin for `expFitR2` (exact exponential → r2 = 1). Run `nodeOps.test.ts`, `catalogSearch.test.ts`, `formulaNodeCoverage.test.ts`, `seeds.test.ts`, `sourceInvariants.test.ts`, then full `npx vitest run`.
8. **Docs.** `docs/node-coverage.md` LOGEST row → folded into LINEST. One digest line in `docs/dev-notes.md`; delete the backlog sentence; delete this plan; commit by pathspec.

## Done when
`tsc` clean, full vitest green, `grep -r LogestNode src` → 0; Add-menu search "logest" lands on the LINEST card's Exponential op; switching the toggle keeps downstream cables on all three outputs and retitles the rows. Author eyeballs at http://localhost:1420: toggle, retitled rows, wired outputs surviving a switch.
