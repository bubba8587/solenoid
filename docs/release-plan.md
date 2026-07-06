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

## 2. The cut — DECIDED (author 2026-07-06)

**Cut the built body as `1.1.0`.** Reserve `2.0.0` for the genuinely-major, author-present
flagships — **FC A4 units-by-dimensionality** and the **Excel `.xlsx` transpiler**. Nothing
since 1.0 breaks the save format, so this is a feature-scale call, not a compatibility one.

**1.1 is NOT just "tag what's built" — it gets three committed additions (author 2026-07-06):**

1. **Finance / market-data connections — fleshed out in a big way** (§3). NOTE: the
   audit mis-read this as shipped. Reality: `DataFeedNode` (fetch/cache/refresh/key-state)
   + `dataProviders.ts` + `apiKeyStore.ts` (Settings key store) exist and are tested, but
   the node was **never registered / catalogued / given a component** — it's unreachable.
2. **A massive pass on all 27 seeds** — the eyeball + selling vehicle for 1.1.
3. **A "What's New" overlay** — a short slide series, shown once, re-openable from the menu bar.

Plus a maintained **curated high-value feature list** that sells 1.1 — see
`release-notes-features.md`. (The author personally writes the final release notes;
that file is the source material + the What's-New slide content.)

## 3. Scope for 1.1

### Committed — the 1.1 build (author 2026-07-06)
- **Finance / market-data connections (big):** register + catalogue + build the
  `DataFeedNode` component so it's usable; expand it into a genuine feature (§3a).
- **Seed overhaul:** a pass on all 27 seeds — each loads clean, demos a real 1.1 story,
  no dead/embarrassing ones; `seeds.test.ts` stays green (§3b).
- **What's New overlay:** shown once (localStorage flag), re-openable from the menu bar (§3c).
- **Curated feature list** kept current in `release-notes-features.md`.

### Finish-if-time (near-done, low-risk — pull in if the cut has room)
- **Gauge collapsed preview** (last of the per-node collapse set; 3 input sockets must stay reachable).
- **F-2 remainder** — per-slot doc palette overrides + document-level FC defaults.
- **D-2 simulation inner display** — series renders inside the drill-in.
- **Goal-seek solver parameters** — max-iter/tolerance/bounds (polish on the new run modes).

### Explicitly RESERVED for 2.0 (author-present flagships)
- **FC A4 units-by-dimensionality** (`v2.0/05`) — foundation landed; build together.
- **Excel `.xlsx` transpiler** (`v2.0/08`).
- **D2 toolbar reroute** (finishes the first-class drill-in) · **D4 conditional formatting**.

### Deferred / OUT (tracked, not blocking)
- E-1 Obsidian trio · D-3 aliasing UI · D-4 pack variant reconcile · Monte Carlo (gates
  `v2.0/10` + `v2.0/12`) · cable collision avoidance · grid system · the border seam
  (UNSOLVED) · the drill-in's remaining main-only subsystems (Group/Isolate/nav/lasso/history).

### Release blockers — NONE known
No open regressions on `main`'s path; the drill-in's main-only subsystems are *folded/hidden*,
not broken. A regression from the eyeball pass (§5) would become one.

## 3a. Finance flesh-out — scope (research-backed 2026-07-06)
CONSTRAINED to Excel scope (tabular series / stock history) — NOT a Bloomberg terminal
(no real-time quotes, intraday, options, fundamentals). Author's ask: "properly embed a
FRED graph AND get its data series." The insight from the research: those are the SAME
object in Solenoid — fetch the series as a typed date/value frame and wire it into our
**Chart node** (native, themed). No opaque iframe; you get the data + the graph + the
ability to compute on it. Two KEYLESS routes exist, so the feature works out of the box:
- **FRED keyless** — `fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES` returns the series
  CSV with NO key. Make this the DEFAULT FRED path (the current `dataProviders.ts` uses the
  keyed `api.stlouisfed.org` API — keep it as the "advanced" option for frequency/units/range).
- **Stocks keyless** — Stooq `stooq.com/q/d/l/?s=SYMBOL&i=d` → daily OHLCV CSV, no key
  (Excel `STOCKHISTORY` scope). Alpha Vantage stays the keyed backup.

The build:
1. **Make it real** — `DataFeedComponent`, `nodeRegistry` row, `rete-nodes` export, catalog
   leaf; provider dropdown + series/ticker field + status + "add key" link (only when a keyed
   provider is chosen) + the `refreshMinutes` timer (reuse the WebSource/connection pattern).
2. **FRED keyless default** + a small set of **common-series quick-picks** (series ids are
   cryptic — UNRATE, CPIAUCSL, GDP, FEDFUNDS, DGS10, MORTGAGE30US, SP500…) alongside the free field.
3. **Chart-ready typed output** — date column typed as date, value(s) numeric — so it drops
   straight into a Chart. Stooq path outputs date + OHLCV.
4. **Demo seed** — a FRED series (e.g. unemployment or CPI) → Chart, loads keyless; a Stooq
   ticker → Chart. Doubles as a 1.1 showcase.

Scope kept small deliberately: 3 providers (FRED, Stooq, Alpha Vantage), plain ticker field +
FRED quick-picks (no full symbol-search picker), no crypto/FX unless asked. Sources:
FRED download docs + API; Stooq CSV.

## 3b. Seed overhaul — approach
Inventory the 27 seeds; for each: loads clean? tells a real 1.1 story? uses current nodes (no
deprecated shapes)? Then: fix/retire the weak ones, add/refresh to showcase the headline 1.1
features (drill-in composites, run modes, Finance, recharts, Report/Presenter). Keep
`seeds.test.ts` green throughout. This is the author's eyeball vehicle — do it near the cut.

## 3c. What's New overlay — design
A lightweight slide deck (reuse the Presenter/overlay chrome, NOT a node): 4–8 slides, each a
title + one line + a small image/gif or a mini live demo. `localStorage` "seen version" flag
shows it once per release; a **Help → What's New** menu item re-opens it any time. Slide content
comes from `release-notes-features.md` (author-editable). No Captain-Obvious copy; DESIGN.md.

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
