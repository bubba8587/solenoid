# Solenoid 2.0 — plan set (live remainder)

The bundle set authored 2026-07-03 from the completed feature walk (verdicts
inline in `../archive/scope-features.md` + `../archive/future-directions.md`).
**Most bundles are BUILT**; their plan docs are deleted (git history has the
text — the shipped mechanics live in code comments, `subsystem-invariants.md`,
and CLAUDE.md). Residual open items from built bundles live in `../backlog.md`.

## Live bundles

**05 — Units by dimensionality (FC A4)** SHIPPED 2026-07-12/13 and archived to
`../archive/units-format-controller.md` (live truth: `formatModel.ts`,
subsystem-invariants "Unit flow", `decisions.md` D20).

| Bundle | What | Status / gate |
|---|---|---|
| [08](08-excel-transpiler.md) | The Excel `.xlsx` → graph transpiler | Not started; deliberately sequenced late |
| [10](10-decision-model-sensitivity.md) | Decision Matrix sensitivity ("wiggle the weights") | Buildable — the composite Monte Carlo run-mode hook it waited on shipped 2026-07-12; needs re-triage / an author pick, not gated |
| [12](12-value-model-extensions.md) | Uncertain values (#21) + money mode (#43) | As-Of half SHIPPED; the rest VERY LATE, each needs an author representation call |
| [16](16-widget-nodes.md) | **Everyday widget nodes** (Weather/Geocode/FX/Holidays/TZ/QR — the throwaway-workbook layer) | Scoped 2026-07-20; Tier 1 autonomous-friendly (could be 1.3); 4 author calls listed in the doc (FX cap reversal, provider policy) |
| [17](17-matrix-formulas.md) | **Matrix formulas** — the Tier 4 / D2 decision packet (shape branding + broadcast table) | Prep COMPLETE 2026-07-28 (VAL-15 rebrand cleared the recorded blocker); decision AUTHOR-GATED; no open sub-decisions — the PAD rule was already settled by P3 + D15 |
| [18](18-parity-corpus.md) | **Backend parity corpus** — one wire-format fixture set run by both vitest and cargo, replacing the hand-mirrored verb-test pairs | DESIGNED 2026-07-28, decision-complete; build queued (backlog) — migrates verb-by-verb, promotes as FX-12 |

## Verdict pending — needs a fresh author call before any bundle doc

(Resolved down 2026-07-05.) Remaining: **#23** persistent compute cache (sketch
exists in archived scope-features) · **#35** MCP port (only if the CLI can't
cover live-shared-GUI).

## Ruled OUT — no revisit needed

Named dimensions (#20), model linter (#29), synthetic data (#26), data slots
(#27), formula lens (#28), PDF/OCR intake (#33), guided tutorials (#36), history
scrubber (#42), shared-definitions library (#53), structured templates (#55),
commission vertical (#56), paste-anywhere (#57a), the Round-9 trust-machinery
cluster (#58–63), embeddable-engine identity (#18), the NL/AI layer (#7, #19),
data-drafts, golden tests — and, ruled 2026-07-05: **#2** publish-as-form,
**#6** snapshots+diff, **#11** transform-by-example, **#46** sealed models,
**Bet 5**, list-of-frames ("this is Cube"), Go-To-Special chrome. **#48/#54**
resolved as the ultra-minimal library-folder opener (backlog). Per-item
reasoning: the archived walk docs.

## Cross-cutting reminders (apply to every bundle)

- **Read `DESIGN.md` before any pixel** — no accent stripes, Quiet Accent Rule,
  no faux-3D.
- **Prefer a node over a new panel/lens/global-UI layer** when node-shaped. New
  HUD panels are bespoke siblings in `HudStack.tsx` registered via
  `registerChrome()` — there is no generic panel API.
- **No Captain-Obvious UI strings.**
- **Pre-alpha, break freely** — no migration shims.
- **`tsc` + `vitest` green always; the author eyeballs UI on the dev server.**
