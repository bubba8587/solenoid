# Solenoid — Release Plan (path to the next tagged release)

The forward-looking queue is `backlog.md`; this file is the *release* view — what's
ready, what gates a tag, and the decisions only the author can make. Reconcile it
against code the same way as the backlog (delete/flip lines as they land).

## 1. Where we are

- **`v1.0.0` tagged 2026-07-01** — desktop (Tauri) + native Polars engine + the full
  relational verb spine + HTML-in-canvas renderer.
- **A large body is BUILT + green but UNTAGGED since 1.0.** Verified against code
  2026-07-06 (see `archive/build-plan.md` audit). Grouped:
  - **FC v1.1-α** — the function model + A2 redesign + movement audit.
  - **The 2026-07-05 autonomous build plan** — Tiers A–F essentially complete
    (locale/persist, a11y, library-folder opener, minimap 3-way; Rust oracle key +
    Infinity sentinel, AND/OR filter, native CSV dates, engine hygiene; the full
    recharts set incl. Treemap/Sankey/Histogram/KPI/Bullet/date-range; XLOOKUP merge;
    Input Switcher; goal-seek run mode; custom palette editor; Document Properties;
    Finance/FRED + API-key store).
  - **First-class composite drill-in** (2026-07-06) — the app frame stays around the
    subgraph via the `activeGraph.ts` seam; editable input-marker seeds; arm-and-run
    heavy modes with the Solve button + stale dot.
  - **Command palette overhaul**, type-coloured chips, green boundary markers, Mermaid
    node, Report/Presenter, Cube, trust & data-quality nodes — all in.
- **v2.0 bundle set** (`v2.0/`): built 01–07, 09, 11–15. OPEN bundles below.

**tsc + full vitest (2279) green; `cargo test` (32 parity) green; 27 seeds load
(`seeds.test.ts`).** The tree is release-shaped *right now* minus the hygiene pass.

## 2. The cut line — AUTHOR DECISION

The shippable body since 1.0 is large and coherent. Two shapes:

- **Option A (recommended) — cut the built body now, hold the flagships.** Tag what's
  built + green (a big, clean release), and reserve the two genuinely-major,
  author-present features — **FC A4 units-by-dimensionality** and the **Excel `.xlsx`
  transpiler** — for the following cycle. Clean cadence; doesn't hold a huge amount of
  shippable, tested work hostage to multi-week flagships.
- **Option B — hold this release for the flagships.** Fold A4 units (and/or the
  transpiler) into this tag. Weeks of author-present work before it can ship.

**Version number** (independent of A/B): nothing since 1.0 breaks the save format
(the `v` field + forward-guard are intact; pre-alpha means no back-compat is owed
anyway), but the feature surface is a major step. Call it **`1.1.0`** if Option A,
**`2.0.0`** if the flagships land in it. Recommendation: **Option A as `1.1.0` now**,
`2.0.0` reserved for the units flagship.

## 3. Scope for the next release (assuming Option A)

### Release blockers — NONE known
No open regressions or half-shipped features are on `main`'s path; the drill-in
subsystems that are main-only are *folded/hidden*, not broken (backlog "First-class
composite drill-in"). If the eyeball pass (§5) surfaces a regression, it becomes a
blocker.

### Finish-if-time (near-done, low-risk, optional for the cut)
- **Gauge collapsed preview** (last of the per-node collapse set; investigate — its 3
  input sockets must stay reachable).
- **F-2 remainder** — per-slot doc palette overrides + document-level FC defaults.
- **D-2 simulation inner display** — series renders inside the drill-in, not just the
  outer card.
- **Solver parameters** (goal-seek max-iter/tolerance/bounds) — small, high polish for
  the just-shipped run modes.

### Design-gated / author-present — NEXT cycle (the `2.0` differentiators)
- **FC A4 units-by-dimensionality** (`v2.0/05`, the flagship) — foundation landed
  (tagged cells, `dimension.ts`); build together.
- **D2 — reroute the real top toolbar / mobile bar to the active subgraph** — finishes
  the first-class drill-in; wants live eyeballing.
- **D4 — conditional formatting** — needs its own design pass (must clear Excel by a lot).
- **Excel `.xlsx` transpiler** (`v2.0/08`) — deliberately sequenced late.

### Deferred / OUT of this release (tracked, not blocking)
- E-1 Obsidian vault trio · D-3 aliasing/hidden-port UI · D-4 pack variant reconcile ·
  Monte Carlo run mode (gates `v2.0/10` sensitivity + `v2.0/12` uncertain values) ·
  cable collision avoidance · grid system · the header/body border seam (UNSOLVED) ·
  the drill-in's remaining main-only subsystems (Group/Isolate/navigator/lasso/history).

## 4. Release checklist (definition of done)

Ordered; each must be green before the tag.

1. **`tsc` clean + full `vitest` green + `cargo test` green** (32 Rust parity tests).
2. **Every seed loads** — `seeds.test.ts` green; run the **seed-cleanup pass** (the
   author-decreed last-minute polish: each of the 27 seeds loads clean and demos its
   feature; don't over-polish).
3. **Author eyeball pass** — consolidate the "author eyeball" notes from the dev-notes
   digests into one list and walk it on the dev server (the author's verification path).
4. **README bar** — `docs/README.md` still states *what it is* + the non-obvious
   differentiators, no feature inventory (per the standing rule).
5. **Version bump — THREE files in lockstep:** `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` (all at `1.0.0` today).
6. **Path-stripped desktop build** — `npm run release:desktop` (`scripts/release-build.ps1`)
   strips the build-machine username from the binary. Verify no real-name leak
   (`[[feedback-keep-real-name-private]]`).
7. **Merge `develop` → `main`** (main is production, author-gated) and **tag `vX.Y.Z`** on
   main. The `windows-portable.yml` workflow auto-publishes the GitHub Release + portable
   `.exe` on the tag.
8. Post-tag: smoke-test the published portable exe launches + loads a doc.

## 5. Author decisions needed (blocking §2–§3)

1. **Option A vs B** (cut now vs hold for flagships) → sets the version (`1.1.0` vs `2.0.0`).
2. **Which finish-if-time items are IN** the cut (Gauge / F-2 remainder / D-2 / solver params).
3. **Green-light the seed-cleanup + eyeball pass** as the final gate (author-run).

## 6. Sequencing to the tag (Option A)

- **Now → cut:** (optional) knock out the chosen finish-if-time items — all small, all in
  `backlog.md` with footprints; nothing shares a hot file, so parallel-safe.
- **Then:** hygiene pass §4.1–§4.4 → version bump §4.5 → author eyeball §4.3 sign-off.
- **Cut:** release build → merge → tag → verify.
- **After the tag (author-present, next cycle):** A4 units flagship → D2 toolbar reroute
  → D4 conditional formatting → transpiler. Each is its own arc.
