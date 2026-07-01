# Performance Optimization Research

> Compiled 2026-06-18. A research/handoff doc for improving interaction performance in
> Solenoid (React + Rete v2 node editor). Combines external research with a code-grounded
> map of the actual per-frame hotpaths. Intended to be handed to a fresh session as a
> starting point — nothing here has been implemented on this branch yet; it is analysis
> and a prioritized plan.

## TL;DR — what to read if you only read one section

The pain is **interaction jank** (pan, zoom, group drag, lasso/box-select), **not
computation**. Cost scales roughly linearly with element count: a small fully-on-screen
graph is already slightly janky (~92% smooth), large graphs much worse (~60%). That curve
means **per-element, per-frame work with a too-high constant** — fix the constant and both
small and large graphs improve. Two costs run every frame, both O(N):

1. **Paint** — nothing is GPU-composited during these gestures, so every node/cable
   re-rasterizes every frame. The **9999×9999px cable SVG** is the keystone blocking
   layer promotion.
2. **Per-frame JavaScript** — the gesture handlers do O(N) DOM reads / re-renders per
   pointermove (worst: lasso).

**Do this first** (see "Two 5-minute experiments"): kill node box-shadows and gate the
hover hit-test during pan, to localize paint-bound vs JS-bound before building anything.

### Already tried (per user — do NOT re-propose as new)
- Clamping mouse polling rate — minor gain.
- Making the minimap render fewer things — minor gain.
- Messing with the background dots — did **not** help.
- **Queued but not yet done:** making nodes more pure-CSS objects when selected, stripping
  some React from them. (Adjacent to React.memo on node shells, but distinct.)

### Scope correction from the user
- The slowdown is in **zoom, pan, group drag, lasso select** — interaction, not compute.
- **Culling/virtualization is explicitly NOT the desired fix** — slowdowns appear even on
  small graphs entirely on-screen at a reasonable zoom. (Virtualization is still listed
  below for completeness/scale, but deprioritized.)
- Scale **does** make it worse (don't discount it) — it's a linear per-element cost, not a
  fixed overhead. Small≈92%, large≈60%.

---

## 0. Diagnose before changing (this matters)

Earlier experiments "didn't help" — the signature of optimizing something that wasn't the
bottleneck. Get real signal first:

- **React DevTools Profiler** → "Record why each component rendered." Shows whether cost is
  in `ConnectionComponent`, node shells, or minimap, and how many re-renders per gesture.
- **Chrome Performance panel** during a pan and during a field-edit. Long **Recalculate
  Style / Layout** bars = DOM/CSS/forced-reflow cost; long yellow **Scripting** bars =
  path math / handler JS. Watch specifically for **"Forced reflow"** warnings (interleaved
  DOM read/write → layout thrashing).

### Two 5-minute experiments to localize paint vs JS

1. **Kill node box-shadows.** Comment out `box-shadow` on `.solenoid-node`
   (`src/graph/components/nodeCard.css:15`), the group header shadow
   (`GroupNode.css:24`), and the conduit `drop-shadow` (`conduit.css:42`). Pan/zoom a
   medium graph. Box-shadow is the most expensive always-on paint property; with no
   compositor layer it repaints on every node every frame.
   - Smoother → **paint-bound** → go to §2 (compositing).
   - No change → **JS-bound** → go to §3 (handlers).
2. **Gate the hover hit-test during pan.** The socket-hover handler
   (`Canvas.tsx:644-671`) calls `document.elementsFromPoint()` on every pointermove and is
   **not gated during pan** (only gated for cable-drag via `cableDragStore`).
   `elementsFromPoint` forces a synchronous layout read every frame and bumps
   `socketHighlightStore` → connection re-renders. A `.solenoid-canvas--panning` flag
   already exists (it pauses flow beads, `canvas.css:75`) — reuse it to early-return this
   handler during pan. Almost certainly a free win regardless of the experiment outcome.

---

## 1. Code-grounded map of the per-frame frame-path

What actually runs per pointermove/wheel frame during each gesture (file:line refs). Cost
column notes how it scales.

| Gesture | Per-frame work | Scales with |
|---|---|---|
| **PAN** | `elementsFromPoint` ×2 (hover + cable-drag handlers), `socketHighlightStore` updates → socket/connection re-renders. Area holder transforms via CSS (cheap) but **not GPU-promoted** → all nodes/cables repaint. | N (sockets) + paint O(N+C) |
| **ZOOM** | `getBoundingClientRect()` ×1 per wheel notch (`CappedZoom`, `Canvas.tsx:107-125`). Transient `will-change: transform` for 160ms (desktop only). Cables appear to re-render on every `zoomed` event **even though cable geometry is in canvas space and does not change on zoom** (verify — likely wasted work). | C (cables) + paint O(N+C) |
| **GROUP DRAG** | O(M) `area.translate()` per member per frame — **each is async** (awaits a guard pipe). Cables recompute paths (endpoints moved, O(C)). Standoff solver `settleStandoffNetwork` runs **per `nodetranslated`** if standoffs exist (`Canvas.tsx:2218`), worst-case O(network²). Membership reconciliation only on drop (good). | M (members) + C + standoff net |
| **LASSO** | **Worst offender.** Per pointermove (`Canvas.tsx:806-882`): `getBoundingClientRect()` on **every node** (O(N) forced reflow); `getTotalLength()` + `getPointAtLength()` on **every cable** ~len/64 times (O(C×samples) SVG reads); `unselectAll` then reselect → re-render; `cableSelectionStore.replaceAll` → all cable re-renders. | N + C×samples |

### Layer promotion / paint setup (the keystone)

> **CORRECTION (2026-06-18, from reading the actual code rationale).** The
> "almost certainly … 100MP SVG memory" guess below was WRONG. The real,
> in-code documented reason pan isn't promoted (`Canvas.tsx` ~2025-2046) is that
> **the holder surface (whole-graph extent) is larger than the GPU max texture,
> so a promoted layer TILES and re-rasterizes tiles as a pan-translate reveals
> them → visible flicker of heavy content (recharts/cards).** It's a
> *tested-and-rejected* change, and explicitly a **mobile** constraint
> (`onZoomActivity` already promotes on DESKTOP for zoom via an `IS_MOBILE`
> gate). Consequence: **bounding the cable SVG does NOT unblock pan promotion** —
> the blocker is holder *size*, not the cable box. A full-graph `<canvas>` cable
> layer hits the *same* max-texture wall for promotion; its win is cheaper
> *un-layered* repaint (one canvas vs N SVG elements), not enabling compositing.
> The cable-SVG box was still worth bounding (done — hygiene, smaller
> invalidation rects, unblocks any future *per-element* compositing), just not
> for the reason originally stated.

- **Cable SVG is 9999×9999px** (`ConnectionComponent.tsx`), `position:absolute`,
  `pointer-events:none`, **no GPU promotion**. *(DONE: now bounded per-cable to its
  content bbox via `viewBox` — see the correction above for what that does and
  doesn't buy.)*
- Area holder is **deliberately NOT GPU-promoted for pan** (`Canvas.tsx` ~2025-2046,
  documented decision) — see the correction above for the *real* reason (holder >
  GPU max texture → tiling flicker, mobile). Zoom gets a transient `will-change`
  on desktop only.
- No `will-change`/`translateZ`/`contain`/`content-visibility` on nodes, groups, or the
  main area. Only the OutlinePanel uses `translateZ(0)` + `contain: paint`
  (`OutlinePanel.css:173-174`). Canvas has `isolation: isolate` (stacking context, not a
  compositor layer).

### Per-element paint cost (repaints every frame when not composited)
- Per-node: `box-shadow` on every card (`nodeCard.css:15`), selection ring `::after`,
  group-membership corner `::before` (clip-path), header color-mix tint.
- Per-group: header `box-shadow` (`GroupNode.css:24`), dashed border, selection overlay.
- Per-cable: SVG paths; ribbon trunks/fans recomputed if endpoints move; flow-bead paths.
- Conduit selected: `filter: drop-shadow(...)` (`conduit.css:42`).
- → Paint cost is **O(N + M + C)** with a high constant (shadows/filters are pricey).

### ConnectionComponent re-render fan-out
- `ConnectionComponent.tsx` subscribes to **~13 external stores** (shape, angle,
  selection, value, flow, ghost, socket-hover, group-collapse, connection-version, conduit
  layout, ribbon-hover, isolate, + local hover). Any bump → full re-render → `getCablePath`
  (the `routeWalk`/spline solve) re-runs in the render body, **no `useMemo`**. Most of those
  stores change *appearance*, not *geometry*, yet still trigger the expensive path solve.
- Net effect: hover/selection bumps re-render **all** connections.

### Compute (NOT the current bottleneck, but noted)
- `processGraph()` (`process.ts:309-358`) does `engine.reset()` (full-graph cache clear),
  fetches **every** node, then `area.update("node", id)` on **every** node — not just
  changed ones. Pull-based `DataflowEngine`. This is an edit-latency cost, not a
  pan/zoom/drag cost, so it's lower priority for the current complaint — but it's the
  obvious win if edit responsiveness ever becomes the issue.
- No virtualization: all nodes render regardless of viewport.

---

## 2. Fixes — PAINT side (the root cause of "everything feels heavy")

The 9999×9999 cable SVG is the keystone: it blocks GPU promotion of the holder, so pan/zoom
repaint everything every frame instead of moving a cached texture.

1. **Bound / replace the giant cable SVG so the holder can be GPU-promoted.** Options, in
   rough order of effort:
   - Bound the SVG to the actual content bbox (smallest change).
   - Split cables into per-connection small SVGs, or chunked/tiled SVG layers.
   - Move all cables to a single `<canvas>` layer (the standard ceiling-remover for
     many-connection editors; SVG hits a paint ceiling, canvas doesn't). Big rewrite of
     `ConnectionComponent` — only if profiling says cables dominate.
   - Once the SVG isn't a memory bomb, GPU-promote the holder for pan too → pan/zoom become
     **O(1) compositor transforms** instead of O(N) repaint. Helps small graphs as well.
2. **`contain: layout paint` on node cards** (and groups) so one node can't invalidate
   siblings' layout/paint.
3. **Cut per-element paint cost**: cheaper or pre-rasterized shadows; promote node cards to
   their own layers (`will-change`/`contain: paint` per card) so shadows rasterize once and
   just composite. (`filter: drop-shadow` is **not** cheaper than `box-shadow` — don't swap
   to that.) Confirm magnitude via the box-shadow experiment in §0.
4. **`content-visibility: auto` + `contain-intrinsic-size`** on node roots — browser-level
   skip of off-screen layout/paint. (This is a paint optimization, *not* the unmount-based
   virtualization the user vetoed; it helps even when everything is technically on-screen by
   bounding invalidation. Lower priority given the on-screen complaint, but cheap to try.)

---

## 3. Fixes — JAVASCRIPT side (per-frame handler cost)

### Lasso (worst offender)
- **Cache node rects once at lasso start** — nodes don't move during a lasso, so read all
  `getBoundingClientRect()` up front, then pure math per frame. Removes the O(N) forced
  reflow per frame.
- **rAF-coalesce `applyLasso`** so N pointermoves/frame → 1 pass.
- **Defer precise cable hit-testing to drop**; during drag, broad-phase against the cached
  node rects only. Kills the O(C×samples) `getTotalLength`/`getPointAtLength` SVG reads from
  the hot path.
- **Diff the selection** instead of unselect-all-then-reselect every frame.

### Group drag
- **DOM-mutate member `view.element.style.transform` directly during drag**, commit via
  `area.translate` on drop. Skips M async guard-pipe round-trips per frame. (CLAUDE.md flags
  direct transform mutation as fragile-but-valid; safe here because membership/position
  reconcile on drop.)
- **Defer the standoff solver to drop** (or rAF-throttle), instead of every
  `nodetranslated`.
- Cables touching moved nodes genuinely must recompute (endpoints moved) — memoization (§4)
  ensures only the moving ones do, and that appearance-only store bumps don't pile on.

### Pan
- **Gate the hover `elementsFromPoint` handler off during pan** (reuse
  `.solenoid-canvas--panning`). Main JS win for pan; after that pan is just the transform +
  paint (handled by §2).

### Zoom
- **Verify whether `zoomed` re-renders `ConnectionComponent`.** Cable path `d` is in canvas
  space and does not change on zoom (zoom is a transform). If cables recompute on zoom, it's
  pure waste — decouple cables from the zoom event and zoom becomes free on the JS side.

### Cross-cutting (helps every gesture)
- **rAF-coalesce all pointer-driven store writes** so multiple events per frame cause ≤1
  re-render.
- **Replace per-move `elementsFromPoint` hit-testing** with Rete's known socket positions /
  a cheap distance check or quadtree — `elementsFromPoint` forces style+layout every call.

---

## 4. Fixes — RE-RENDER fan-out (ConnectionComponent + node shells)

1. **Memoize cable path math, split geometry from visual-state.** `useMemo` the `pathD`
   (and ribbon slot/fan math) keyed only on geometric inputs (endpoint coords, shape, angle
   hints). Selection/hover/flow bumps then skip the expensive `routeWalk`/spline solve.
   Better: outer `<PathGeometry>` (memoized `<path d>`) + thin inner overlay that only swaps
   `stroke`/CSS class for hover/selected/flow. **Hover becomes a class toggle, not a path
   recompute.**
2. **Stop the all-connections re-render on hover/selection.** Narrow subscriptions so a
   cable re-renders only when *its own* hover/selection changes (per-id selector, or read
   the flag inside the memoized inner component). React DevTools confirms the fan-out.
3. **`React.memo` the node shells** (`NodeShell`/`PortSockets`/`ValueDisplay`) with a
   comparator on real inputs (`selected`, `width/height`, `label`, `cachedResult`). React
   Flow's official guidance: all custom node/edge components must be memoized or they
   re-render constantly. (Adjacent to the user's queued "CSS-ify selected nodes" idea, but
   independent.)

---

## 5. Compute-side (lower priority — not the current complaint)

Only relevant if edit latency, not gesture jank, becomes the problem:
- **Incremental recompute** instead of full `engine.reset()` + update-every-node: only
  re-render nodes whose `cachedResult` changed; ideally recompute only the affected
  downstream subgraph.
- **`startTransition`** for the post-edit recompute so typing/dragging stays responsive.

---

## 6. Scale-only techniques (user deprioritized; here for completeness)

Useful at thousands of nodes but **not** the fix for on-screen small-graph jank:
- **Viewport culling / `onlyRenderVisibleElements`-style virtualization** — user explicitly
  does not want this as the solution.
- **Semantic zoom / Level-of-Detail (LOD):** below ~0.5 zoom, swap node components for
  content-free rectangles of the same size. Rete ships LOD and LOD-GPU examples.
- **Canvas minimap** (already partially addressed by the user).
- **Rete "copy to a plugin-light editor"** for bulk transforms where intermediates aren't
  rendered — not an interactive hot path here.

---

## 7. Recommended order of attack

1. **Diagnose** (§0): React Profiler + Chrome Performance; run the two 5-minute experiments
   (box-shadow off; gate hover during pan) to localize paint-bound vs JS-bound.
2. **Free JS wins**: gate hover during pan; lasso rect-caching + rAF + diffed selection.
3. **Re-render fan-out** (§4): memoize cable path + split geometry/visual-state; this is the
   biggest bang-for-buck for hover/selection/drag and is self-contained.
4. **Group drag**: direct-transform members + deferred standoff; verify/decouple
   zoom→cable.
5. **Structural paint fix** (§2): bound/replace the 9999px cable SVG → GPU-promote the
   holder for pan/zoom. Highest leverage for pan+zoom, larger effort.
6. **Compute** (§5) only if edit latency surfaces.

Best bets for the linear "92%/60%" curve: §4.1+§4.2 (kill the all-connections recompute on
appearance changes), the lasso rect-caching, and the SVG/compositing fix.

---

## Tauri target reality (deployment ≠ the dev browser)

The shipping target is a **Tauri v2 desktop app**, so the renderer is *not* the
Chrome you test in, and *not* a uniform Chromium across platforms. Tauri (via
WRY) wraps the **OS webview**:

- **Windows → WebView2** (Chromium/Edge). Modern, fast, GPU-composited. Primary
  dev/target platform today.
- **macOS → WKWebView** (WebKit). Different paint/compositing engine.
- **Linux → WebKitGTK** (WebKit). The weakest of the three; historically poor at
  large SVG and many-element DOM.

> The CLAUDE.md note "Tauri ships Chromium" is only true on Windows. On
> macOS/Linux it's WebKit.

What this changes for the plan:

- **§2 (canvas cable layer) is worth *more* than the dev-browser numbers imply if
  macOS/Linux are real targets.** SVG hits a paint ceiling hardest on WebKit
  (WebKitGTK especially), so the single-`<canvas>` cable layer becomes the clear
  long-term answer there, not just "if profiling says cables dominate." If the
  app ships **Windows-only**, WebView2 is Chromium and the SVG ceiling is higher
  — bound-the-SVG + GPU-promote (the cheaper §2 options) may suffice.
- **Profile in the actual Tauri build, not just `vite dev` in Chrome.** A win or
  regression on WebView2/WebKit can differ from desktop Chrome. The dev-server
  loop is fine for correctness; validate *perf* in the packaged app per target OS.
- **WebView2 GPU flags are a Tauri-only lever (Windows).** Chromium already
  GPU-composites by default, so flags won't promote a layer the renderer judges
  too expensive (e.g. the 9999² SVG) — they are *not* a substitute for the §2
  structural fix — but `additionalBrowserArgs` on the window can force
  rasterization / ignore the GPU blocklist on flaky drivers if profiling shows a
  blocked layer. An in-build experiment to validate, not a guaranteed win. (No
  browser equivalent.)
- **Compute could move to Rust** over Tauri IPC (the `processGraph` dataflow), but
  compute is *not* the current bottleneck (§5) — file this only if edit latency
  becomes the complaint, and weigh the IPC serialization cost.
- **We don't need the web build to be 100% smooth.** Tune for the target webview;
  the browser version is a dev convenience, not the product.

## Sources (external research)

- [Rete.js — Performance best practices](https://retejs.org/docs/best-practices/performance/)
- [Rete.js — Performance / LOD example](https://retejs.org/examples/performance/)
- [React Flow — Performance](https://reactflow.dev/learn/advanced-use/performance)
- [Architecting for Massive Scale in React Flow (VisualFlow)](https://www.visualflow.dev/blogs/scale-studio-pro)
- [React Flow / xyFlow Optimization (DEV)](https://dev.to/usman_abdur_rehman/react-flowxyflow-optimization-45ik)
- [SVG vs Canvas performance (LogRocket)](https://blog.logrocket.com/svg-vs-canvas/)
- [SVG vs Canvas performance ceiling (Hacker News)](https://news.ycombinator.com/item?id=15024190)


---

# (merged) Perf testing notes

# Perf testing notes (TEMP — delete when done)

## ⏸ RESUME HERE (paused mid-investigation)

Honest scorecard of what's landed so far:
- **Minimap memo (`b35b40f`) — CONFIRMED win.** Minimap was re-rendering all ~140
  node rects every pan/zoom frame. Measured: pan 57→125-169fps, zoom 25→~100fps,
  user confirmed "not green." Real and verified.
- **Group-drag rAF coalesce (`ba22cee`) — PARTIAL.** 34-50→119-174fps, worst frame
  1200→250ms, but user still feels residual choppiness (one drag dipped to 39fps).
- **Lasso rAF coalesce (committed with this note) — UNCONFIRMED.** User read was
  "maybe a bit better" → "definitely improved"; never hard-measured. Sound in
  theory (caps the per-pointermove cable getPointAtLength storm to once/frame).

**The fundamental cause is still UNFIXED.** Everything above is a *frequency cap*
(rAF) on one call site at a time. The shared root cause across group-drag,
lasso, and multi-select is structural:

> Selecting OR moving a node triggers a full React re-render of that node (rete's
> `selectableNodes` calls `area.update("node", id)`; group move calls
> `area.translate` per member). Each node's socket placement runs
> `useRowSocketTop` — a `useLayoutEffect` that reads `offsetTop/offsetHeight`
> (`NodeSocket.tsx:34`) — plus `NodeCard`'s `--out-socket-top` read and
> `nodeKit`'s header-height read. So every node re-render FORCES A LAYOUT REFLOW.
> Any gesture touching N nodes = N forced reflows, and the hot paths fire it at
> mouse-poll rate. That's why single-node is 165fps but many-node is 30-50fps.

### Next session — go after the structural fix (in priority order)
1. **Make selection CSS-only, not a React re-render.** Selecting a node should
   toggle a class on `view.element` (or a data-attr) and be styled in CSS — NOT
   go through `area.update`, which re-renders the whole node subtree and triggers
   the reflow-y layout effects. This is the big one: it makes lasso / group /
   shift-select all cheap at once. Risk: every node component reads `data.selected`
   in render today; need to confirm nothing else depends on the re-render.
2. **Stop the socket `useLayoutEffect` from reading layout on EVERY render.** It
   only needs to re-measure when geometry could have changed (header wrap, content
   row count), not on a selection/value re-render. Gate it, or measure via a
   ResizeObserver instead of reading offsetTop each commit.
3. **Group-drag residual:** the group's INTERNAL cables (both endpoints are
   members) don't change shape during a rigid move — skip re-routing them mid-drag
   (re-route once on drop). Or move the group subtree by a temporary DOM transform.
4. (Lower) **Cable hit-test in `applyLasso`** samples every cable with
   `getPointAtLength` (slow). If lasso still drags on a cable-dense graph, cache
   each cable's sampled points and only re-sample when its endpoints move.

### Measurement tools in place
- `window.__solenoidPerf = true` → logs pan/zoom/drag gesture fps + dropped frames
  (Canvas.tsx fpsProbe) and the processGraph compute/render split (process.ts).
- `npx vitest run src/graph/perfScaling.test.ts --reporter=verbose` → headless
  compute scaling (compute is NOT the bottleneck: ~3ms whole-graph, 0.021ms/node).

---

Investigating Personal Finance seed performance. The bottleneck is almost
certainly the **compute + React re-render path**, not paint/culling (too few
visual objects for paint to matter). [NB: paint/render turned out to matter a
LOT — see the pan/zoom + minimap findings below.]

## What the code does on every recompute

`processGraph()` runs on every input change and unconditionally:

1. **Compute** — `engine.reset()` then fetch EVERY node (all ~140). No
   dirty-tracking: nudging one slider recomputes the whole graph, not just the
   changed subtree. Engine is fully async (2-hop cancellable promise per node).
2. **Render** — `cableValueStore.bump()` re-renders ALL ~135 connections (each
   recomputes its path via the `getCablePath` walk-router), then
   `area.update(node)` re-renders ALL 140 node React roots (sequentially awaited).

The slider calls `processGraph()` **unthrottled** on every `onChange` (every drag
pixel). Playback has a `busy` guard; manual dragging does not.

### Ranked suspects
1. Whole-graph re-render every tick (`area.update` all nodes + `bump` re-renders
   + re-routes all cables). O(total nodes + cables) regardless of what changed.
2. Whole-graph recompute every tick (engine fetches all nodes; no incremental).
3. Unthrottled `processGraph` on slider drag (× drag frequency; overlapping calls
   also trigger `engine.reset()` cancellation churn).
4. `getCablePath` per cable per bump (re-routed even when endpoints didn't move).

## How to test (desktop)

### 1. Built-in probe (do this first)
DevTools → Console:
```
window.__solenoidPerf = true
```
Drag a slider ~3s. Each recompute logs:
```
[perf] processGraph #42  nodes=140 conns=135  compute=3.1ms  render=18.7ms  total=21.8ms
```
Report: compute vs render (which is bigger), total (>16ms = dropped frame), and
how fast `#` climbs while dragging (calls/sec). `window.__solenoidPerf = false`
to stop. (Implemented in `src/graph/process.ts`, gated on the global flag.)

### 2. Chrome Performance trace
Performance tab → record → drag slider ~3s → stop.
- Summary mostly **Scripting (yellow)** vs **Painting (green)**? Expect yellow →
  confirms not-paint.
- Bottom-up call tree: self-time in `area.update`, React `commitWork`/`reconcile`,
  `getCablePath`, `fetch`. Flag Long Tasks (>50ms, red).

### 3. React DevTools Profiler
Enable "Highlight updates when components render," drag a slider. If EVERY node +
cable flashes each tick → suspect #1 confirmed. Ranked chart shows costliest
components.

### 4. Ablation (localize fast — temporary edits)
- Comment out the `area.update` render loop in `processGraph` → if drag smooths,
  rendering dominates.
- Comment out `cableValueStore.bump()` → isolates cable re-render/re-route cost.
- Delete half the seed's nodes → if smoothness scales with TOTAL node count (not
  the slider's subtree), confirms whole-graph recompute/render.

### 5. Scaling test
Duplicate graph to 2x/4x nodes; watch probe `total`. Grows with total nodes →
need incremental recompute/render + slider throttle.

## Likely fixes, mapped to findings
- Render dominates → rAF-throttle `processGraph` during continuous input; scope
  re-renders / `area.update` to only the changed subtree.
- Compute dominates → dirty-subtree recompute (fetch only changed node's
  descendants) instead of reset + fetch-all.
- `getCablePath` hot → memoize cable paths keyed on endpoint positions (skip
  re-route when neither endpoint moved).

## Measurements taken

### Compute phase is NOT the bottleneck (headless, repeatable)
`src/graph/perfScaling.test.ts` — `npx vitest run src/graph/perfScaling.test.ts
--reporter=verbose`. Builds the Personal Finance graph at 1x/2x/4x node count
(disconnected copies, WebSources pre-seeded from the local CSVs) and times
`engine.reset() + fetch every node` — exactly the compute half of processGraph.

```
scale  nodes  conns   min   median  mean   p95    max   ms/node
1x      140    135   2.60   2.96   2.98   3.71   3.71   0.021
2x      280    270   5.11   5.91   6.11   8.03   8.48   0.021
4x      560    540  10.80  12.03  11.91  12.91  13.06   0.021
```

Recomputing the WHOLE 140-node graph from scratch is ~3ms and scales perfectly
linearly (0.021ms/node); even 560 nodes stays under one 16ms frame. So suspect
**#2 (whole-graph recompute)** is cheap at this scale — dirty-subtree recompute
would buy almost nothing today. The cost is in the **render half** (suspects #1
and #4), which this harness deliberately does NOT measure (needs a real DOM).

### Pan/zoom is render-only — and it's slow (user-reported)
Pan/zoom never calls `processGraph` (confirmed: the `translated`/`zoomed` area
pipe in `Canvas.tsx` only runs `syncBackground()` — no node re-render, no cable
re-route). So pan/zoom cost is pure **browser paint/composite of the always-
mounted DOM**: every node React root, every SVG cable, and the recharts/gauge
SVGs are painted each frame regardless of viewport (culling was removed — see the
willChange/LOD comment block in Canvas). This is the real frontier, not compute.

**New probe (`window.__solenoidPerf`, in `Canvas.tsx`):** with the flag on, a
pan or zoom gesture logs on release, e.g.
`[perf] pan gesture: 48 frames  mean=22.4ms (45fps)  worst=61.0ms  dropped(>16.7ms)=19 (40%)`.
Covers pan + touch-pinch (pointerdown→up) and desktop wheel/pinch zoom (zoom-
activity→settle). Report mean fps + dropped% during a drag across the seed.

### ROOT CAUSE FOUND: the minimap re-rendered every frame
Paint-flashing during a pan showed the **minimap fully green every frame**, plus
the dot-grid background. The minimap (`components/Minimap.tsx`) is a custom React
render preset, and the rete minimap plugin re-emits a fresh render (new props) on
EVERY pan/zoom tick — so all ~140 node rects (+ a fresh `nodeFills` pass) re-
rendered ~60×/s. But the rects live in GRAPH coordinates: panning doesn't move
them, only the viewport box moves.

**Fix (landed):** split the rects into a `memo`'d `MinimapNodes` child keyed on a
geometry+fill+width signature, so they re-render only when a node actually moves/
resizes or the theme changes. Pan/zoom now updates just the one viewport div.

Result (Personal Finance seed, 165Hz display), before → after:
- pan steady-state: ~57fps, minimap all-green  →  **125–169fps, minimap not green**
- zoom (longer gesture): ~25fps  →  **~100fps**
The dot-grid background repaint was a smaller secondary contributor; disabling it
during pan helped a little but wasn't needed once the minimap was fixed, so the
dots were left visible (no UI regression). Holder `will-change:transform` on pan
did NOT help — the holder spans the whole graph, too large to composite as one
GPU layer (Chrome tiles + re-rasters), confirming the original "pan never
promotes" note.

### Worst-frame stall (~250–530ms) was a DevTools artifact — NOT real
Every gesture's probe showed one huge frame at gesture start. But with DevTools
CLOSED the hitch is gone (user-confirmed) — it was the overhead of having the
console / paint-flashing / profiler attached (big first-frame + per-frame cost).
Don't chase it. Real-world pan/zoom on the seed is smooth after the minimap fix.

### Group drag was choppy — member follow ran per pointermove
Dragging a single node is 165fps; dragging a big group was 34–50fps with worst
frames to ~1200ms. Cause: `nodetranslated` (fires once per `pointermove`) called
`moveGroupMembers`, which is O(members) async `area.translate`s, each re-routing
that member's cables. A high-polling mouse emits pointermove far above the refresh
rate, so the member loop ran hundreds of times/sec.

**Fix (landed):** rAF-coalesce the member follow in Canvas — accumulate deltas,
apply to members at most once per animation frame (flush on drop). Group drag went
to 119–174fps for most drags; worst frame ~1200ms → ~250ms.

STILL a residual dip to ~39fps on a hard sustained drag of a BIG group — that's
the genuine per-frame cost of M members each re-routing once a frame. Next lever
(not done, riskier): skip re-routing the group's INTERNAL cables during the drag
(both endpoints move by the same delta → shape unchanged), or move the group
subtree by a temporary rigid DOM transform and reconcile once on drop.

### Next measurements to localize the paint cost (DevTools, in-app)
- DevTools → Rendering → **Paint flashing** + **Layer borders** while panning. If
  the whole canvas green-flashes every frame → everything repaints (no layer
  promotion / no culling). Layers panel shows memory + why each layer exists.
- Performance trace during a pan: expect **Painting/Compositing (green/purple)**
  to dominate, NOT Scripting — the opposite of the input-change case.
- Ablation: temporarily hide the recharts/gauge nodes (heaviest SVG) and re-pan;
  if it smooths, vector SVG raster is the cost. Then try the 2x/4x duplicated
  seed in-app to see fps scale with painted DOM.

## Already done this session
- WebSource: async `data()` → synchronous cache read + background fetch (removed
  the source from the engine's async critical path). Helped slightly; more below.
- Headless compute scaling harness (`perfScaling.test.ts`) — compute ruled out.
- Pan/zoom frame-rate probe added to `window.__solenoidPerf` (Canvas.tsx).
