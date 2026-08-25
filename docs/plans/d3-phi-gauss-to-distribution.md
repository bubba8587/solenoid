# D3 — PHI / GAUSS move from Math Function to Distribution

**Work in your own git worktree** (`git worktree add ../solenoid-<agent> -b <agent>/d3-phi-gauss develop`),
commit there, then rebase onto `develop` and merge — never push.

Backlog line: "Node-combining parked ▸ PHI / GAUSS → Distribution forms". Lead's design calls
are settled (dev-notes digest "NOT STARTED / prepped at wrap-up", item 3) — do not re-derive.

**What stands.** PHI(x) = φ(x) (standard-normal density) and GAUSS(z) = Φ(z) − ½ are two ops of
`MathFnNode` in group "Probability" (`src/graph/nodes/scalar.ts:174` type union, `:211-212`
`MATH_FN_OP_META`, `:348-349` compute switch). They are standard-normal FORMS and already
live under Distributions ▸ Normal in the menu's own words (`nodeCatalog.ts:354` comment) —
so they move into `DIST_SPECS` as two single-input ops and leave MathFn. One card, no sibling.

**Read first:** `CLAUDE.md` (Node combining; the `fx ?? despace(label)` rule), `docs/decisions.md`
oneDistributionNode, `docs/rules.md` onePrunePath, `docs/code-comments.md`.

**Precedent:** the Distribution merge (oneDistributionNode) — every distribution is a row of
`DIST_SPECS` (`src/graph/nodes/distributionOps.ts:96`); the node builds its sockets from the
spec (`distribution.ts:14` `inputKeysFor` = first key per form + `spec.params`), prunes cables
BEFORE `removeInput` on an op switch (`distribution.ts:67-80`, onePrunePath), and the op list
for the Add menu / search is DERIVED from the table (`nodeOps.ts:110` `DIST_OPS`: `fx` =
`excel.split(" / ")[0]`, keywords = the whole `excel` string). A `params: []` spec (the
`normal-s` row at `distributionOps.ts:108`) is the exact template: one x socket, nothing else.

## Steps

1. **Specs.** `distributionOps.ts`
   - `DistKey` (`:45`): add `| "phi" | "gauss"`.
   - `DistForm` (`:28`) + `DIST_FORM_META` (`:33`): add ONE form `half` — `{ label: "Φ − ½",
     description: "Area under the standard normal curve from 0 to x" }`. GAUSS is not a CDF
     and must not be labelled one; PHI reuses the existing `pdf` form exactly.
   - Two rows after `normal-s` (`:108`), `group: "Continuous"`, `params: []`, `xKey: "x"`,
     `xLabel: "X"`, `xDefault: 0`:
     - `phi`: `label: "φ (standard normal density)"`, `excel: "PHI"`, `forms: ["pdf"]`,
       `compute: (_f, v) => exp(-v * v / 2) / sqrt(2 * PI)`.
     - `gauss`: `label: "Gauss (Φ − ½)"`, `excel: "GAUSS"`, `forms: ["half"]`,
       `compute: (_f, v) => stdNormCDF(v) - 0.5` (the file's own Φ — do NOT port scalar.ts's
       `erf` polynomial; 6d4ae819 moved Φ to double precision here for exactly this reason).
     No `sample` form on either (they are forms, not distributions; `sampleQuantile` `:334`
     is never reached without it). `formAfterSwitch` (`:319`) needs no change: leaving either
     row lands on the target's default form via the final fallthrough.
   - `fx` for both derives to `"PHI"` / `"GAUSS"` through `DIST_OPS` — verify by reading
     `nodeOps.ts:110-114`; write nothing there.
2. **Delete from MathFn.** `scalar.ts`: remove `"phi" | "gauss"` from `MathFnOp` (`:174`), the
   two `MATH_FN_OP_META` rows (`:211-212`), the two `case`s (`:348-349`). If "Probability" is
   now an empty group, `MathFnNode.tsx:10` groups from the meta so nothing else references it —
   grep `Probability` in `src/graph` to confirm and delete any leftover. Keep `erf` (still used
   by `erf`/`erfc` ops).
3. **Catalog.** `nodeCatalog.ts:763-764`: delete the two `mathLeaf` rows (and the now-empty
   parent if it holds nothing else — read `:755-770`); `:354` comment: delete it (the menu now
   simply IS that). The Distribution leaf (`:760`) description lists the distributions — leave
   it; add `phi gauss` to its `keywords`.
4. **nodeExcel.** `nodeExcel.ts`: delete `"math-gauss"` (`:297`) and `"math-phi"` (`:307`);
   add to the `"distribution"` block (`:146`, alphabetical among NORM.*):
   `{ excel: "GAUSS", syntax: "=GAUSS(z)", parity: true }` and
   `{ excel: "PHI", syntax: "=PHI(x)", parity: true }`. This is what keeps
   `formulaNodeCoverage.test.ts` green (coverage = leaf labels + `excel` rows).
5. **Formulas.** PHI / GAUSS are Formula.js fallthroughs (no `registerInternal`; signatures at
   `formulaSignatures.ts:459-460`) — untouched, still callable. Do NOT add a `registerInternal`.
6. **Tests.**
   - `nodeOps.test.ts:293` asserts every Distribution `fx` is DOTTED (`/^[A-Z.]+\.[A-Z.]+$/`).
     PHI/GAUSS are legitimately bare; loosen to `/^[A-Z.]+$/` AND add the assertion the dotted
     rule was really guarding: no op's `fx` equals `despace(label).toUpperCase()` of any
     `math-*` catalog leaf (the op-Gamma vs GAMMA(x) trap). `nodeOps.test.ts:307` (a search row
     per distribution) covers the new rows for free.
   - `scalar.test.ts:89` PHI pin: move to `distributions.test.ts` as
     `DIST_SPECS.phi.compute("pdf", 0, [])` ≈ 1/√(2π); add `DIST_SPECS.gauss.compute("half",
     1.96, [])` ≈ 0.475 and `gauss(0) = 0`; add a formula↔node agreement pin
     (`evaluate("=GAUSS(1.96)")` vs the spec) in `distributions.test.ts`.
   - `seeds.test.ts`: no seed references `math-phi` / `math-gauss` (grepped 2026-08-25) — run
     it anyway; an old save with those types loads as Placeholder, no alias.
   - Run: `nodeOps.test.ts formulaNodeCoverage.test.ts catalogSearch.test.ts
     distributions.test.ts distributionInvariants.test.ts scalar.test.ts seeds.test.ts
     uiCopy.test.ts` after each step; full `npx vitest run` + `npx tsc --noEmit` before the
     final commit.
7. **Docs.** `docs/node-coverage.md`: grep `PHI` / `GAUSS` / `Probability`; move the mention
   under Distribution. One digest line in `docs/dev-notes.md`; delete the backlog bullet
   ("PHI / GAUSS → Distribution forms"); delete this file; strike row 17 in `plans/README.md`.

## Done when

- `MathFnOp` has no `phi`/`gauss`; `DIST_SPECS.phi` / `.gauss` exist; Add-menu search "phi",
  "gauss", "PHI", "GAUSS" each land on the Distribution card with that op preselected.
- `=PHI(0)` and `=GAUSS(1.96)` evaluate as before; the node and formula agree (pinned).
- `tsc` + full vitest green; one commit (or one per step, each green), tree clean.
- Author eyeballs at http://localhost:1420: Add ▸ Distributions ▸ Distribution → pick "Gauss
  (Φ − ½)": ONE input socket X, form dropdown shows the single "Φ − ½" entry; switching to
  Normal restores Mean / Stdev with the cable on X kept.
