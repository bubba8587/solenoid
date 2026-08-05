# Deferrals — the parked / author-gated set (1.3 review list)

Everything the author has marked deferred, parked, author-present, or
only-if-triggered, gathered in ONE place. The backlog carries a single item —
**Deferral review** — that points here; nothing in this file is scheduled work
until that review promotes it. Ruled-out-forever ideas stay in
`out-of-scope.md`; the 2.0 flagships stay in `2.0-plan.md` (this list doesn't
duplicate them, just names them for the review).

## Needs an author decision before any build

- **Everyday widget nodes (v2.0 bundle 16)** — Weather / Geocode / FX / Holidays /
  TZ Convert / QR. Tier 1 is autonomous-friendly and could be 1.3, but 4 gate
  calls come first: `v2.0/16-widget-nodes.md`.

- **Timesaver date idioms needing a config widget or a judgment call** — Fiscal
  Quarter (start month), Age (DATEDIF "MD" nuance), Nth Weekday. The zero-config
  idioms (Quarter, Days in Month) already shipped in `packs/timesavers.ts`.

- **Expression `/` doesn't mint a pure ratio** — the Divide NODE mints `5:1` on a
  same-dimension cancel; Expression strips UnitCells at its boundary, so `a/b`
  yields a bare number. Decide: leave (Expression is deliberately type-agnostic —
  likely fine) or make Expression unit-aware someday.
- **Error UX on restriction violation** — typed error out the socket vs the node
  flagging the offending input locally. Pending a call.
- **Traveling-cable flow pulse → maybe the app's cables** (author likes the landing
  page's marching-dash rendering, `LandingScenes.tsx` `.sol-cable__flow`).
  Touches the never-degrade-cables rule and DESIGN.md's no-decoration stance —
  it would make the pulse MEANING, not decoration.
- **Feature/value copy doc** for landing/marketing — author will initiate; ranked
  candidate copy lines per feature, author ranks value.
- **INDEX — marked for later (2026-07-01, `cube-node-scope.md`)**: output socket
  should express Cube (today singular `any`); Excel range forms (`row=0`/`col=0`
  whole row/col, the reference form) — Solenoid INDEX is cell-only.
- **`∞` glyph for Infinity display** — spot-check `formatScalar`; author eyeball
  (`value-semantics.md`).

## Author-present build sessions (2.0 flagships — see `2.0-plan.md`)

- **D2 proper — composite toolbar reroute** (top toolbar / mobile bar drive the
  active subgraph). Wants live eyeballing.
- **D4 — conditional formatting for tables** — own design pass; must clear Excel's
  version by a lot; Display-node-only; must not step on FC format/units territory.
- **Excel `.xlsx` transpiler** (`v2.0/08`) — deliberately sequenced late.
- **v2.0/10 decision sensitivity** — buildable (its Monte Carlo hook shipped);
  needs re-triage / an author pick.
- **v2.0/12 uncertain values + money mode** — sequenced dead last; each needs an
  author representation call first.

## Author-present polish

- **FC A4 tails**: per-element mixed-unit trig (a list mixing deg/rad cells should
  interpret EACH cell in its own unit — `resolveTrigModes` still reads one
  socket-level unit); Cube popup FC controls (frames/matrices/lists have the
  per-column format+unit row in `TablePopup` via `fcControls.tsx`; cubes wait on
  nothing now that `CubeColumn` is typed).
- **Optically center the last asymmetric icons** — canvas-lock toggle (reads low) +
  the cable-flourish sparkle; author's eye needed. Ink-centroid method: archived
  dev-notes (2026-06-20).
- **Hoist the chrome envelope into `--chrome-top`/`--chrome-bottom` vars**
  (`layout-chrome.md`) — kills the hand-keyed offset sync map; cross-cutting, do it
  author-present, not as a drive-by.

## Parked bugs (explicitly parked by the author — records in `dev-notes.md`)

- **Note-family selection ring ~0.5px off on right/bottom** — integer-rounding of
  stored dims already ruled out; prime suspect is content-driven sub-pixel card
  size. Record in dev-notes "OPEN PROBLEM". Parked by author.
  (The header/body border seam, formerly parked here too, was SOLVED 2026-08-05
  by the one-paint SVG `CardFrame` — see the dev-notes digest.)

## Only if the trigger returns

- **Figure rasterize-at-rest (recharts + KaTeX)** — the last real DOM perf lever;
  SvgPicker precedent (raster at rest, live on hover; KaTeX re-rasters on zoom).
  Quality gate: pixel-crisp at any zoom, hover indistinguishable. Only when a
  real workload demands.
- **Native Polars mirrors for the eager cleanup verbs** (fillBlanks /
  replaceValues / sliceRows are trivially lazy; today they materialize like
  Split Column). Only if a real workload demands.
- **#23 persistent compute cache** · **#35 MCP port** — verdict pending a fresh
  author call (`v2.0/README.md`).
- **XLOOKUP `rawInputs` bypass retirement** — with typed frame→cube the bypass is
  unneeded; the frame + cube lookup paths could collapse to one.
  Behavior-touching refactor of a covered node; only if it pulls weight.
- **MMULT dimension algebra** — only if a dimensioned-linear-algebra use case ever
  appears; documented-strip is the deliberate stance (D20).
- **Provenance Tier 2 — on-demand "why is this?" walk** — backward-derivation
  trace for any value (Tier 1, error origin + fly-to-source, shipped in
  `errorValue.ts`). Idea salvaged from the archived provenance bundle.
- **Inside-solve stale dot is uniform** — after an INSIDE Solve the dot reads green
  though the held result is seed-based; distinguishing needs a drill-state signal
  in the compute layer (couples `data()` to `compositeEditorStore`). Left simple
  on purpose; revisit only if it reads as misleading.
- **Pack variant-switch reconciles the socket set** — a variant dropdown would
  add/remove sockets like Cast/read-as do. (The existing custom nodes all keep
  fixed sockets across their dropdowns, deliberately — nothing waits on this.)
- **Obsidian follow-ups (if wanted)**: auto-reload an imported note on file
  change; write config for `![[Note]]` transclusion vs inlining an embedded
  note's body.
- **Cube-aware Unnest (peel ONE level)** — the inverse of cube-aware Nest Join;
  needs an `any`/cube output (a peeled depth-2 cube is a depth-1 cube), so a
  socket-shape change, not just an engine tweak (`cube-node-scope.md`).
- **Group-by-into-nesting / a top-edge "grid" Build Cube** — considered-and-dropped
  ideas the cube doc keeps on the table; add only on demand.

## Parked features (revisit only if the trigger returns)

- **UI-scale toggle (Default / Larger)** — subsumes all per-panel resize asks;
  don't build per-panel resize.
- **Cable collision avoidance** — spec: `archive/cable-routing.md` §2.
- **Grid system** — spec: `grid-system.md`.
- **WebGPU/wgpu renderer + LOD swap** — superseded by HTML-in-Canvas as the
  zoom-at-scale lever; reopen only if `drawElementImage` never reaches stable or
  a native-GPU need appears. Records: `archive/renderer-plan.md`,
  `archive/performance-hardening.md`.
- **`content-visibility: auto` on node roots — ruled out** while socket positions
  are measured from live DOM geometry (off-screen subtrees don't compute
  descendant layout → cable endpoints jump at the viewport edge). With
  SVG-picker-rasterize + collapsed-figure-unmount shipped, the DOM-weight lever
  set is exhausted — the GPU renderer is the remaining path at scale.
