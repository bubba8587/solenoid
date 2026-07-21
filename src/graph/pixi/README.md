# `src/graph/pixi/` — the PixiJS renderer (spike → real port)

Proof-of-architecture for the GPU node renderer. See `docs/archive/renderer-decision.md`
for the *why* (adopt PixiJS v8, keep Rete headless, DOM only for the active
editor). This folder is the *how*. Nothing here is on by default — it's reached
only through the buried **Edit ▸ "Renderer spike (Pixi)"** overlay
(`../components/RendererSpike.tsx`).

## Module map

| File | Pure? | Role |
|---|---|---|
| `pixiCamera.ts` | ✅ tested | world↔screen transform: pan, anchored zoom, pinch, fit-to-bounds. Seedable from a rete area transform (`{k,x,y}`). |
| `pixiCardLayout.ts` | ✅ tested | card sub-rects (header/body), text anchors, socket distribution, `cardsBounds`, `rectIntersects` (cull test). |
| `pixiPicker.ts` | ✅ tested | `CardPicker` — topmost-card hit-test over the shared `SpatialGrid` (broad-phase) + rect narrow-phase. The production replacement for a linear scan. |
| `pixiCableGeom.ts` | ✅ tested | `cablePolyline` — reuses the app's REAL router (`getCablePath`) → `parsePathPoints`, so GPU cables match DOM cables. |
| `pixiGraphSnapshot.ts` | ❌ impure | snapshots the live rete graph (editor + area + DOM): node rects, kind colours, scraped title/value, real socket world-positions, connections, group rects. Defensive — never throws under the overlay. |
| `pixiScenes.ts` | ❌ Pixi glue | `buildSyntheticScene` (N grid cards, perf ceiling) and `buildLiveScene` (the real graph). One `SpikeScene` shape: `moveCard`, `setSelected`, `setLod`, `cull`, `setCablesVisible`, `redrawCables`. |

`RendererSpike.tsx` wires it together: the Camera + CardPicker drive hand-rolled
pointer/pinch/wheel interaction; a floating `<input>` does double-click rename
(the hidden-input pattern); a Benchmark orbit/zoom reports avg + worst fps.

## Key facts / gotchas

- **`pixi.js` is dynamic-imported** (`await import("pixi.js")`) so it code-splits
  out of the main bundle — verified (~880 kB own chunk, zero pixi in main). Scene
  builders take the runtime module as a `PixiModule` param; `typeof import(...)`
  types are erased at build, so they stay fully typed without a static import.
- **Socket world position** = `view.position + (sockRectCenter − viewElRect.topLeft) / k`
  — un-scales the live DOM rect; the viewport/canvas offset cancels (difference of
  two screen rects). `k` is `area.area.transform.k`.
- **Backend** is whatever Pixi picks: WebGPU when available, else WebGL2 (the line
  that dissolves the old WebGPU-vs-WebGL2 + Linux-WebKitGTK worry).
- **Text** uses an **MSDF atlas** — Atkinson Hyperlegible **Next** (titles) +
  **Mono** (values), in `public/fonts/atkinson-{next,mono}.{fnt,png}`, loaded via
  `Assets.load` and used by `BitmapText` (crisp at any zoom, one batched draw).
  If an atlas fails to load it falls back to Pixi's dynamic bitmap font
  (`FALLBACK_FONTS`), so text never disappears. The HUD shows MSDF vs fallback.
  **Regenerate** (ASCII charset, after a font change) from the variable TTFs:
  `msdf-bmfont -f xml -t msdf -s 42 -m 512,512 --pot -r 4 -o public/fonts/atkinson-next <Next.ttf>`
  (and `…-mono <Mono.ttf>`). The atlas is ASCII-only — widen the charset for
  non-ASCII glyphs when the real port needs them.

## What this is NOT (yet)

The spike proves the path; it does not replace the renderer. The real port
(`docs/backlog.md` → "Renderer (v1.0)"): MSDF text, port cables off
`ConnectionComponent`, port node bodies + rehost the React node components off
rete's render contract, selection/drag/box-select on the spatial index, minimap,
then delete the rete render/area/connection plugins. Do the cheap Chrome DevTools
trace first to confirm Composite-Layers dominates.
