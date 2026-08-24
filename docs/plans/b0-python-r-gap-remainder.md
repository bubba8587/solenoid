# B0 — python-r-gap remainder (four independent sub-items)

Each sub-item is its own commit and follows the Tier 1/2 discipline: rete-free KERNEL
(+ its `.test.ts` with locally computed references), a NODE, a FORMULA registration
where the output is rank ≤ 2, a `nodeCatalog.ts` entry, the card added to the scratch
seed, `npm run run-graph src/graph/seedGraphs/zz-scratch-new-nodes.json` verified.

**Read first.** `docs/python-r-gap.md` (the item lines named below), `DESIGN.md` §7
Voice & copy (before writing a description), `scripts/new-node.mjs` header, the
Decompose precedent end to end: kernel `src/graph/nodes/forecastOps.ts:131-138`, node
`src/graph/nodes/stats.ts:1186-1225`, meta row `src/graph/excelFunctions.ts:640`,
`registerInternal("DECOMPOSE", …)` `:1635`, signature `src/graph/formulaSignatures.ts:240`,
catalog `src/graph/nodeCatalog.ts:618`.

**Registration checklist (from `scripts/new-node.mjs:126-172`):** node class in the
domain file → `nodes/kind.ts` `nodeKindOf` (skip for `math`) → `components/index.ts`
barrel → `nodeRegistry.ts` `NODE_COMPONENTS` row (see `:188`) → `nodeCatalog.ts` entry
(`{ type, label, description, create, parity: false, keywords }`, example `:529`) →
formula (`excelFunctions.ts` meta + `registerInternal`, `formulaSignatures.ts`) →
scratch seed entry `{ id, type: "<ClassName>", x, y, literals?, stringLiterals? }` +
connections through a Display. Catalog descriptions: prose + the numpy/pandas/R names,
no "No Excel equivalent", no affordance narration.

**Backlog line to delete when all four land:** `docs/backlog.md` B0. Update
`docs/python-r-gap.md:27` and each item's "open" marker as they land.

---

## B0.1 `str_wrap` — Wrap Text (`docs/python-r-gap.md:34`)

- Kernel: `export function wrapText(t: string, width: number): string[]` in
  `src/graph/nodes/textOps.ts` next to `padText`/`truncateText` (`:276-308`). Greedy
  word wrap on whitespace; a single word longer than `width` is emitted on its own line
  unbroken (R `str_wrap` behavior); `width < 1` → `#NUM!`-style SolError from the node,
  the kernel just clamps to 1. Empty text → `[]`.
- Tests `textOps.test.ts` (create if absent, same header shape as
  `src/graph/nodes/signalOps.test.ts:1-11`): 5 cases incl. the long-word case and
  references from `stringr::str_wrap` computed by hand.
- Node `WrapTextNode` in `src/graph/nodes/text.ts` shaped like `PadTextNode`
  (`:188-218`): string in, `numIn("Width")` with `literals: { width: 40 }`, output
  `strListOut` (check the exact list-output helper used by other text→list nodes, e.g.
  Split). NOT a Text Transform op (its output is a list — `text.ts:130-139`).
- Formula `WRAPTEXT(text, width)` → string list; `rank: 1` meta.
- Catalog keywords: `wrap wraptext str_wrap textwrap lines width fold`.

## B0.2 Histogram 2-D (`docs/python-r-gap.md:66-67`)

- Kernel: `export function histogram2d(xs, ys, kx, ky): { counts: number[][]; xEdges: number[]; yEdges: number[] } | null`
  in `src/graph/nodes/visual.ts` beside `histogramBins` (`:177-193`); mirror its
  clamps (1..100 bins), finite filter, and the min===max single-spike rule per axis;
  pair xs/ys by index, skip a pair when either is non-finite. Reference: numpy
  `histogram2d` (row i = x-bin, col j = y-bin; last edge inclusive).
- Tests in `src/graph/nodes/visual.test.ts` (or the file that tests `histogramBins`;
  grep for it): 4 cases incl. an inclusive-max point and an all-null input.
- Node `Histogram2DNode`: inputs `numlist` X, `numlist` Y, `numIn` X bins (10), `numIn` Y
  bins (10); output a bordered grid matrix (first row = x bin lower edges, first col =
  y bin lower edges — the shape `parseBorderedGrid` at `visual.ts:547` reads) so it
  feeds `HeatmapCellNode` (`visual.ts:522-542`) directly. Mirror the "Bins is a SHAPE"
  literal handling from `HistogramNode` `:195-233`.
- Formula `HISTOGRAM2D(xs, ys, kx, ky)` → matrix (`matrixArgs` not needed; declare
  `listArgs` for xs/ys, `rank: 2`).
- Scratch seed: wire X/Y from two existing list sources → Histogram2D → Heatmap Cell.

## B0.3 ODE integrate — RK4 (`docs/python-r-gap.md:56-57`)

- Kernel `src/graph/nodes/odeOps.ts`: `export function rk4(f: (t: number, y: number) => number | null, y0: number, t0: number, t1: number, steps: number): { t: number[]; y: number[] } | SolError-ish null`.
  Fixed-step classic RK4; `steps` clamped 1..100000; a non-finite `f` result aborts
  with `null` (the node turns it into `#NUM!`). Tests `odeOps.test.ts`: dy/dt = y →
  e^t within 1e-6 at t=1 with 100 steps; dy/dt = −2y; dy/dt = t (exact t²/2); an
  unstable case returning null.
- Expression compilation: `compilePositional(expr, ["t", "y"])` from
  `src/graph/excelFormula.ts:911-940` (one-line wrapper precedent
  `src/graph/nodes/tableLambda.ts:29` `compileLambda`). The result of a call may be a
  SolError or non-number → treat as null.
- Node `OdeIntegrateNode` (domain file: `src/graph/nodes/stats.ts` or wherever
  Decompose lives — same file): a text expression field (copy the expression-input
  pattern from `ExpressionNode` `src/graph/nodes/expression.ts:84-157` but WITHOUT the
  per-variable socket growth: `t` and `y` are fixed names), `numIn` y0, t0, t1, steps
  (default 100); outputs `numListOut("t")` and `numListOut("y")`. Errors: bad expression
  → `#NAME?`/parse error as the Expression node does; blow-up → `#NUM!`.
- Formula `ODE(expr_text, y0, t0, t1, steps)` → y list (text expression as a string
  arg; check `formulaSignatures.ts` for another text-expression-taking function first —
  if none exists, register the node only and say so in the digest).
- Component: expression field commits on Enter/blur (`useDraftCommit`,
  `src/graph/components/inlineInput.tsx`); never `processGraph` on keystroke.
- Catalog keywords: `ode integrate rk4 solve_ivp deSolve differential euler runge kutta`.

## B0.4 STL decomposition (`docs/python-r-gap.md:48`)

- Kernel in `forecastOps.ts`: `export function stlDecompose(y, period, opts?: { seasonalFrac?, trendFrac?, robustIterations? }): Decomposition | null`
  reusing `lowess` (`src/graph/nodes/signalOps.ts:89`) for the trend and seasonal
  smoothing passes: cycle-subseries loess (one loess per phase), low-pass filter,
  trend loess, 2 outer robustness iterations by default. Reference values: run R
  `stl(nottem, s.window="periodic")`-style checks by hand-computing a small periodic
  series (period 4, 16 points) where seasonal must be exactly periodic and residual
  ≈ 0 for a pure trend+season input. Tests in a new `forecastOps.test.ts` (there is
  none today; `seasonalDecompose` is covered in `pythonRGap.test.ts`).
- Node: add an op selector to the existing Decompose card (`stats.ts:1186-1225`):
  `model` gains `stl` alongside `additive`/`multiplicative` (multiplicative STL = log →
  additive STL → exp). Same three outputs; no socket swap needed.
- Formula: `DECOMPOSE` gains the third model string; update the signature row at
  `formulaSignatures.ts:240` and the meta if arity text changes.
- Catalog description: add "STL (loess)" + keyword `stl`.

## Done when (per sub-item)

- Kernel tests green, `tsc` clean, catalog validator quiet in dev, `run-graph` on the
  scratch seed shows the new card's outputs; one digest line; `python-r-gap.md` marker
  flipped. After B0.4: delete the B0 backlog line and this file.
