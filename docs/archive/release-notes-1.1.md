# Release-notes bar (reusable rule)

The 1.1 feature-highlight list (headliner slides + release-notes body + full changelog)
lived here; it's dropped now that 1.1 shipped — git history has it. What's kept is the
reusable **bar** for what earns a spot in release notes / What's-New, which
`docs/release-notes-features.md` points at for every future release.

## The bar (author 2026-07-08)
A **sell** is a shiny thing a user will go discover and play with, or something that
would inspire a download / link click on social media — what makes someone want this
alongside or over Excel. **What's New is not a changelog; GitHub is.**

## Slide vs body distinction
- **`[slide]` — the What's-New deck.** Only genuine sells by the bar above; a shiny,
  playable, download-inspiring feature.
- **Release-notes body.** Real sells that aren't slide-worthy on their own (analysis/data
  features, quality-of-life) — a benefit line each, not a changelog entry.
- **Under the hood / GitHub changelog.** Non-sells that shipped (document properties,
  type-colored chips, charts following the palette, composite-editor/main-canvas parity,
  engine parity work) — mentioned, never headlined.

Each entry is a *benefit*, not a changelog line.
