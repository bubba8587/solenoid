# Solenoid 2.0 — plan set (live remainder)

The bundle set authored 2026-07-03 from the completed feature walk (verdicts
inline in `../archive/scope-features.md` + `../archive/future-directions.md`).
**Most of the original bundles are BUILT**; their plan docs are deleted or archived (git history
has the text — the shipped mechanics live in `subsystem-invariants.md` and the
per-subsystem specs). Residual open items from built bundles live in
`../backlog.md` / `../deferrals.md`.

## Live bundles

**05 — Units by dimensionality (FC A4)** SHIPPED 2026-07-12/13 and archived to
`../archive/units-format-controller.md` (live truth: `formatModel.ts`,
subsystem-invariants "Unit flow", `decisions.md` unitGranularity).

| Bundle | What | Status / gate |
|---|---|---|
| [08](08-excel-transpiler.md) | The Excel `.xlsx` → graph transpiler | Not started; deliberately sequenced late |
| [10](10-decision-model-sensitivity.md) | Decision Matrix sensitivity ("wiggle the weights") | Buildable — the composite Monte Carlo run-mode hook it waited on shipped 2026-07-12; needs re-triage / an author pick, not gated |
| [12](12-value-model-extensions.md) | Uncertain values (#21) + money mode (#43) | As-Of half SHIPPED; the rest VERY LATE, each needs an author representation call |
| [16](16-widget-nodes.md) | **Everyday widget nodes** (Weather/Geocode/FX/Holidays/TZ/QR — the throwaway-workbook layer) | Scoped 2026-07-20; **proposed for 1.4** (`../1.4-plan.md` C1); 4 author calls listed in the doc (FX cap reversal, provider policy) |
| [20](20-pages.md) | **Pages** — tabs are pages in ONE document; one editor/engine, pages as view scopes, cross-page cables as portal stubs | Author-ruled 2026-08-30; planned 2026-09-01 (`../2.0-plan.md` Arc 1) |
| [21](21-collaboration.md) | **Collaboration** — accounts, cloud saves, multiplayer editing, staged 0→3; trust on open | Author order 2026-09-01 — the first ruling on this ground (`../out-of-scope.md` test 3/§3/§11 were unratified inference, now rewritten to the order); `../2.0-plan.md` Arc 2 |
| [22](22-canvas-at-scale.md) | **Canvas at scale** — headless card metrics → virtualization → HIC from a worker; the high-memory bug's home | Planned 2026-09-01; waits on the 1.4 heap-snapshot finding (`../2.0-plan.md` Arc 5) |
| [23](23-conditional-formatting.md) | **Conditional formatting** — design-pass prep: a rule is a graph value; display annotations, never units | Author-gated design pass (`../2.0-plan.md` Arc 4) |
| 17 | **Matrix formulas** — the Tier 4 / noFramesInFormulas decision packet (shape branding + broadcast table) | DECIDED 2026-07-28 as matricesInFormulas and BUILT; archived to `../archive/17-matrix-formulas.md` (live truth: matricesInFormulas, `broadcastRules.test.ts`, `expressionMatrix.test.ts`) |
| 18 | **Backend parity corpus** — one wire-format fixture set run by both vitest and cargo, replacing the hand-mirrored verb-test pairs | SHIPPED 2026-07-29 as oneVerbCorpus, archived to `../archive/18-parity-corpus.md` (live truth: `fixtures/frame-verbs/`, `frameVerbCorpus.test.ts`, `corpus_cases` in engine/tests.rs) |
| 19 | **The computed-column surface** — per-column Data / Formula / λ sources over one shared row-eval core | RATIFIED 2026-07-29, fully landed by 2026-07-31 (C4 closed); archived to `../archive/19-computed-column-surface.md` (live truth: tableRefSemantics/noPerCellFormulas, `computedColumnCore.ts`, `nodes/computedColumn.test.ts`; residual UX tail in `../deferrals.md`) |

## Verdict pending — placed 2026-09-01 (`../2.0-plan.md` § Verdict pending → placed)

**#23** persistent compute cache — HOLD; 1.4's pin store (`../1.4-plan.md` A1) is designed as
its seam. **#35** MCP port — HOLD; the CLI still covers it, and bundle 21's multiplayer model
makes an agent just another client of the live document.

## Ruled OUT — no revisit needed

Named dimensions (#20), model linter (#29), synthetic data (#26), data slots
(#27), formula lens (#28), PDF/OCR intake (#33), guided tutorials (#36), history
scrubber (#42), shared-definitions library (#53), structured templates (#55),
commission vertical (#56), paste-anywhere (#57a), the Round-9 trust-machinery
cluster (#58–63), embeddable-engine identity (#18),
data-drafts, golden tests — and, ruled 2026-07-05: **#2** publish-as-form,
**#6** snapshots+diff, **#11** transform-by-example, **#46** sealed models,
**Bet 5**, list-of-frames ("this is Cube"), Go-To-Special chrome. **#48/#54**
resolved as the ultra-minimal library-folder opener (backlog). Per-item
reasoning: the archived walk docs.

**Reversed out of this list:** the NL/AI layer (#7, #19) — author, 2026-07-31
(`decisions.md` aiInScope; marketing stays minimal). Working queue: the backlog's
"AI command palette" item.

## Cross-cutting reminders (apply to every bundle)

- **Read `DESIGN.md` before any pixel** — no accent stripes, Quiet Accent Rule,
  no faux-3D.
- **Prefer a node over a new panel/lens/global-UI layer** when node-shaped. New
  HUD panels are bespoke siblings in `HudStack.tsx` registered via
  `registerChrome()` — there is no generic panel API.
- **No Captain-Obvious UI strings.**
- **Pre-alpha, break freely** — no migration shims.
- **`tsc` + `vitest` green always; the author eyeballs UI on the dev server.**
