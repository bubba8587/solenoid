# `src/graph/pixi/` — pixi-era library modules + the deprecated renderer spike

Two different things share this folder, with opposite maintenance status:

- **LIVE library code the shipped HTML-in-Canvas mode imports** — `pixiCamera`
  (the camera math), `pixiCableGeom` (`cablePolyline` off the real router), and
  `pixiGraphSnapshot` (the live-graph snapshot). `htmlCanvasRenderer.ts` and
  `HtmlCanvasLayer.tsx` depend on these in production; maintain them like any
  live module.
- **The DEPRECATED Pixi renderer path** — `pixiScenes`, `pixiPicker`, and the
  buried **Edit ▸ "Renderer spike (Pixi)"** overlay
  (`../components/RendererSpike.tsx`). The renderer direction was dropped
  (author 2026-07-19; `docs/archive/renderer-decision.md` has the why); this
  part is parked groundwork, not on by default, not maintained.

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

## What this is NOT

The spike proved the path and the direction was then dropped in favor of the
HTML-in-Canvas renderer (D6) — the full port (MSDF text, ported cables/node
bodies, deleting the rete render plugins) is NOT planned. The groundwork stays
parked in case a full swap is ever forced (D6's reversal clause), and the
library modules above live on inside the HIC mode.
