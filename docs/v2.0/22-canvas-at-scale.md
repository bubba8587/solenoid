# Bundle 22 — Canvas at scale: headless card metrics, virtualization, worker painting

**Source:** the 2026-08-27 deferrals (headless card metrics via Pretext; HIC from a worker),
the parked high-memory bug (2026-08-26/30), figure rasterize-at-rest, the table-popup
virtualization question. **Verdict:** IN for 2.0 as one arc. **Score:** Solid · Core · High ·
Wide. **Written:** 2026-09-01, plan-only.

## The shared precondition

Every layout consumer sizes cards from MOUNTED elements — Tidy, FC docking, standoffs, lasso
rects, the minimap fill, the HIC snapshot pipeline (`renderer-performance.md`). That is what
blocks React Flow's `onlyRenderVisibleElements` (the memory lever: off-screen cards
unmount), fit-before-paint, and HIC painting labels itself. The first tier landed 2026-08-27:
`Surface.measured` (RF's post-layout measure) fronts `measuredBox`, so mounted cards no
longer force reflows. The arc is: **make a card's size computable without mounting it**, then
cash that in three times.

## Step 0 — Measure first (1.4 F5)

A heap snapshot on the getting-started seed vs a blank document: retained node clones,
HIC pyramids, popup caches, per-doc tab growth. The finding decides whether virtualization is
the lever or a leak is. No code before the numbers.

## Step 1 — Headless card metrics

**What.** `NodeCard`'s fixed row geometry as arithmetic (header cap, socket rows at
socketBox12 pitch, section dividers, value boxes) + Pretext (pure-JS text layout, zero DOM
reads) for the wrapped value/text boxes → `cardMetrics(node): {w, h, sockets: [{key, x, y}]}`
for an UNMOUNTED node. Charts, tables, images, Notes and Mermaid have intrinsic or manual
sizes (`observerOwnsSize`, rules) — the metric returns the persisted/declared size for them.
**Where it plugs in.** `measuredBox` gains a third tier (RF measured → DOM → headless);
socket positions for cable endpoints of unmounted cards come from the metric.
**Tests.** A probe (`scripts/`) diffing the headless metric against the live DOM measure for
every catalog leaf in the seeds — drift is a test failure, the same discipline as
`frameShape`'s "mirror the real output or fail."
**Blast radius.** Wide by consumer count, but each consumer already goes through
`measuredBox` — the change is inside one function plus a new module.

## Step 2 — Virtualization

Turn on `onlyRenderVisibleElements`; every DOM reader (HIC snapshot, docked-FC placement,
standoff `offsetWidth`, lasso rects, cable endpoints) falls back to Step 1's metric for
unmounted cards. Groups (RF sub-flows) need parents mounted when a child is visible — RF
handles it; verify. Fit-before-paint follows (load lands on the framed camera instead of
jumping). Perf probe: the load/undo timings in subsystem-invariants § Graph load stay green.

## Step 3 — HIC painted from a worker

The held gesture layer (`HtmlCanvasLayer.tsx`) paints from a worker via
`transferControlToOffscreen`, keeping the main thread free during gestures. A contained
HtmlCanvasLayer change — **not a third render path** (decisions reactFlowView,
htmlInCanvasRenderer): the DOM stays the permanent default, HIC the gesture enhancement.
With Step 1, HIC can paint labels itself for cards that were never mounted.

## Step 4 — Figure rasterize-at-rest (only if a workload demands)

Recharts + KaTeX raster at rest, live on hover (the SvgPicker precedent; KaTeX re-rasters on
zoom). Quality gate: pixel-crisp at any zoom, hover indistinguishable. The last DOM lever.

## Adjacent, not in the arc

- **Table/cube popup virtualization for wide EDITABLE frames** — author: "don't really care."
  Read-only cells already render as plain text. The Path A (window the `<tr>`s in the
  existing `<table>`) vs Path B (div grid on `react-window`, which cannot wrap a `<table>`)
  analysis stands; reopen on a real ask.
- **`content-visibility: auto` on node roots** — ruled out while socket positions read live
  geometry; Step 1 would lift that objection, so re-evaluate after it (cheaper than Step 2 if
  it works).
- **The choppy zoom band** — author-parked; reopens only on their say-so, at T1/T2.

## Exit criteria

A 1,000-card document opens framed, pans and zooms at the same frame budget as a 100-card
one, holds a memory footprint that scales with the VISIBLE set, and every layout verb (Tidy,
dock, standoff, lasso, minimap, fly-to) gives the same answer for an unmounted card as for a
mounted one (the probe pins it).
