# Solenoid 2.0 — plan set (live remainder)

The "nothing left to question" bundle set authored 2026-07-03 from the completed
feature walk (verdicts inline in `../archive/scope-features.md` +
`../archive/future-directions.md`). **Most bundles are BUILT and their docs
archived** (`../archive/v2.0/` — 01 addressable model, 02 shape-checking,
03 compile/fuse, 04 provenance, 06 execution substrate, 07 headless/write/live,
09 composite container, 11 trust & quality, 13 report & presentation, 14 canvas
polish, 15 domain verticals). Residual open items from built bundles live in
`../backlog.md` (composite run modes, conditional formatting = D4, etc.).

## Live bundles

| Bundle | What | Status / gate |
|---|---|---|
| [05](05-units-format-controller.md) | **Units by dimensionality** (FC A4, the flagship) | Rewritten 2026-07-05 to the units-only remainder; foundation (`dimension.ts`, `#UNIT!`, format model) landed; tagged-cells decision made — buildable |
| [08](08-excel-transpiler.md) | The Excel `.xlsx` → graph transpiler | Not started; deliberately sequenced late |
| [10](10-decision-model-sensitivity.md) | Decision Matrix sensitivity ("wiggle the weights") | Blocked on the composite Monte Carlo run-mode hook (backlog) |
| [12](12-value-model-extensions.md) | Uncertain values (#21) + money mode (#43) | As-Of half SHIPPED; the rest VERY LATE, each needs an author representation call |

## Verdict pending — needs a fresh author call before any bundle doc

**#2** publish-as-form/API · **#6** snapshots+diff · **#11** transform-by-example ·
**#23** persistent compute cache (sketch exists in archived scope-features) ·
**#35** MCP port (only if the CLI can't cover live-shared-GUI) · **#46** sealed
models (reframe as integrity checksum if revisited) · **#48/#54** library layer /
model index (VERY deferred — the OS folder is the answer for now) · **Bet 5**
second web engine / desktop-DB source.

## Ruled OUT — no revisit needed

Named dimensions (#20), model linter (#29), synthetic data (#26), data slots
(#27), formula lens (#28), PDF/OCR intake (#33), guided tutorials (#36), history
scrubber (#42), shared-definitions library (#53), structured templates (#55),
commission vertical (#56), paste-anywhere (#57a), the Round-9 trust-machinery
cluster (#58–63), embeddable-engine identity (#18), the NL/AI layer (#7, #19),
data-drafts, golden tests. Per-item reasoning: the archived walk docs.

## Cross-cutting reminders (apply to every bundle)

- **Read `DESIGN.md` before any pixel** — no accent stripes, Quiet Accent Rule,
  no faux-3D.
- **Prefer a node over a new panel/lens/global-UI layer** when node-shaped. New
  HUD panels are bespoke siblings in `HudStack.tsx` registered via
  `registerChrome()` — there is no generic panel API.
- **No Captain-Obvious UI strings.**
- **Pre-alpha, break freely** — no migration shims.
- **`tsc` + `vitest` green always; the author eyeballs UI on the dev server.**
