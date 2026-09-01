# Solenoid 1.4 — feature highlights (selling list)

Curated, high-value features that will sell 1.4 — the source material for the release
notes (the author writes the final copy) and the **What's New** slides. Living doc:
keep it current as features land; each entry is a *benefit*, not a changelog line.
Order = rough selling priority. Mark `[slide]` on the ones worth a What's-New slide.
The bar for what earns a spot: `archive/release-notes-1.1.md` (a sell is a shiny thing
a user will go discover and play with, or something that would inspire a download —
What's New is not a changelog; GitHub is). There is no install base yet (author
2026-08-28): novelty *versus the last release* counts for nothing — only the bar above
makes something a slide. **The 1.3 list shipped with v1.3.0 and lives in git history**
(`git show v1.3.0:docs/release-notes-features.md`); this file covers everything on
`develop` since that tag.

The candidate headliners, per `1.4-plan.md` (fill in as they LAND, not before): the
what-if verbs (pin / mute / peek / hover cone), the Optimize run mode, the Record views
and categorical columns, the everyday widget nodes (Garden Dashboard seed), the AI
palette (flag back on — the 1.3 slide text is in git history with the 1.3 list).

## Headliners — the slide deck

(none landed yet)

## Release-notes body

(none landed yet)

## Under the hood — seed list for the GitHub changelog

(none landed yet)

## Known issues (for the GitHub release body)

Carried from 1.3 until fixed — re-verify at the cut:
- Browser Data Feed CORS limits (desktop unaffected).
- No cable collision avoidance (obstacle router deferred behind an LGPL gate — `1.4-plan.md` F1).
- Android status-bar tint.
- High memory on big documents (author-filed; pre-dates the React Flow port — `1.4-plan.md` F5).
