# Solenoid 1.3 — feature highlights (selling list)

Curated, high-value features that will sell 1.3 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as features land; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.
The bar for what earns a spot: `archive/release-notes-1.1.md` (a sell is a shiny thing
a user will go discover and play with, or something that would inspire a download —
What's New is not a changelog; GitHub is). The 1.2 list shipped with v1.2.0
(2026-07-22) and lives in git history.

Covers everything on `develop` since the v1.2.0 tag.

## Headliners — the slide deck

- **[slide] Query.** A Power Query-style transform node: drop a Query, drill in,
  chain the table verbs, and Refresh on demand — upstream changes only mark it
  stale, never silently recompute (D22: a pre-seeded manual-mode Composite).

## Release-notes body

- Tablet support: correct viewport on touch-desktop browsers, fullscreen on the
  zoom pill, stable pinch-zoom on mobile-class GPUs.

## Known issues (for the GitHub release body — finalize at cut time)

- (carry forward any still true from 1.2: drill-in Navigator/lasso/group tools,
  header/body hairline seam, browser Data Feed CORS limits, no cable collision
  avoidance, Android status-bar tint.)
