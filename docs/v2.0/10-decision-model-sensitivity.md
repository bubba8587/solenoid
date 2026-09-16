# Bundle 10 — Decision models & scoring, made honest

**Source:** scope-features #17. **Verdict:** IN — minor, sequence LATE. **Was gated on**
the composite Monte Carlo run-mode hook; that SHIPPED 2026-07-12 (`monteCarlo.ts`,
composite `montecarlo` run mode), so this is now BUILDABLE — needs re-triage / an author
pick, not a gate.

## Grounding — the exact existing nodes

**Decision Matrix node** — `src/graph/nodes/frame.ts` (find by class name — line refs rot), class
`DecisionMatrixNode`, registers as `"DecisionMatrix"`. Fields: `normalize`, `detail:
"summary"|"breakdown"`. Sockets: input `frame` (`frameIn("Scores")`), input `weights`
(`frameIn("Weights")`, a `Criterion · Weight · Norm` frame keyed by criterion name), output
`frame` (`frameOut("Ranking")`). `data()` resolves the weights frame against the detected
criteria via `resolveDecisionWeights` (unwired or omitted criterion → 1, default normalize)
then calls `decisionMatrix(f, weights, normalize, detail==="breakdown", normOverrides)`
(verbs in `frameVerbs.ts`; mechanics in `node-coverage.md` § Decision support).

**Existing Sensitivity node — confirms it's Decision-Matrix-specific, not a generic
sweep:** `DecisionSensitivityNode` (`nodes/frame.ts`), registers as
`"DecisionSensitivity"`, label `"Sensitivity"`. Inputs: `scores` (`frameIn`),
`scenarios` (`frameIn`, the weights frame widened: rows = criteria, one number column per
scenario). Output: `cube` via `decisionSensitivity(scores, scenarios, this.normalize)`.
Component: `DecisionSensitivityComponent` in `src/graph/components/FrameNodes.tsx`. **This node
already IS a form of "run the ranking under different weight scenarios" — the "wiggle
the weights" feature is extending this node's UX (or wiring it to bundle 09's Monte
Carlo mode for continuous perturbation rather than discrete named scenarios), not
building a parameter-sweep mechanism from scratch.**

## Build

Two possible build shapes — pick based on how bundle 09's Monte Carlo driver shapes up:
1. **Minimal:** a UI affordance on `DecisionSensitivityNode` that auto-generates
   perturbed weight scenarios (±10% per criterion) instead of requiring the user to
   hand-author the `scenarios` frame — reusing the existing `decisionSensitivity` verb
   unchanged.
2. **Fuller (Monte Carlo has landed):** wire `DecisionMatrixNode`'s weights through
   the composite Monte Carlo run mode directly, sampling weight perturbations and re-running
   `decisionMatrix` many times to show ranking-outcome robustness as a distribution, not
   just discrete named scenarios.

Pair with bundle 04's provenance ("here's exactly why vendor B won") once available —
not a hard dependency.

## Exit criteria

`DecisionSensitivityNode` (or a Monte-Carlo-driven wiring of `DecisionMatrixNode`) can
answer "does the ranking survive if I wiggle the weights?" without the user hand-writing
every weight scenario.
