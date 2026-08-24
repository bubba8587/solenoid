import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { syncSurfaceBackground, clampZoom, MIN_ZOOM, MAX_ZOOM } from "./areaPresets";
import { DOT_SPACING } from "./gridSnapStore";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";

// The drill-in is a SECOND editing surface, and every behavior that lives as a closure
// inside Canvas's init effect is a behavior the subgraph silently lacks. The dot grid and
// the pinch veto were two such gaps (the dots were painted by CSS but never tracked the
// camera, so a drill-in's grid stayed frozen while the main canvas's scaled). Both now
// install from areaPresets — the shared-surface module — and this pins that they install
// on BOTH surfaces, so the next one can't land on only one again.

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SURFACES = [
  "src/graph/Canvas.tsx",
  "src/graph/components/CompositeEditorOverlay.tsx",
] as const;

const fakeArea = (x: number, y: number, k: number) =>
  ({ area: { transform: { x, y, k } } }) as unknown as AreaPlugin<Schemes, AreaExtra>;

const fakeContainer = () => {
  const props: Record<string, string> = {};
  const style = {
    backgroundSize: "",
    backgroundPosition: "",
    setProperty(name: string, value: string) { props[name] = value; },
  };
  return { el: { style } as unknown as HTMLElement, style, props };
};

describe("editing-surface parity", () => {
  it("scales the dot tile by k and phases it to the pan", () => {
    const c = fakeContainer();
    syncSurfaceBackground(fakeArea(37, -12, 2), c.el);
    expect(c.style.backgroundSize).toBe(`${DOT_SPACING * 2}px ${DOT_SPACING * 2}px`);
    expect(c.style.backgroundPosition).toBe("37px -12px");
  });

  it("fades the dots out as the grid shrinks, and off entirely past the floor", () => {
    const near = fakeContainer();
    syncSurfaceBackground(fakeArea(0, 0, 1), near.el);
    expect(near.props["--dot-pct"]).toBe("100%");

    const mid = fakeContainer();
    syncSurfaceBackground(fakeArea(0, 0, 0.365), mid.el); // midpoint of the 0.18–0.55 ramp
    expect(mid.props["--dot-pct"]).toBe("50%");

    const far = fakeContainer();
    syncSurfaceBackground(fakeArea(0, 0, 0.1), far.el);
    expect(far.props["--dot-pct"]).toBe("0%");
  });

  // Drift pin: a shared installer that only one surface calls is the exact shape of the
  // bug this module exists to prevent. The perf ones earn their place the hard way — an
  // uncoalesced minimap and an unsynced far-zoom class made panning a 44-node subgraph
  // (the sudoku seed) flicker on mobile while the main canvas stayed smooth.
  it.each([
    "installSurfaceBackground",
    "installSurfacePointer",
    "installSurfaceSemanticZoom",
    "createSolenoidMinimap",
    "solenoidClassicRenderSetup",
    "installNodeDragGuard",
    "installTapSelect",
  ])("%s is installed by every editing surface", (installer) => {
    for (const file of SURFACES) {
      expect(read(file), `${file} must install ${installer}`).toContain(installer);
    }
  });

  // The coalescing is the whole point of the factory: the plugin renders synchronously
  // per translate/zoom event, so a surface that builds its own MinimapPlugin is back on
  // the pointermove-rate path.
  it("builds its minimap through the shared factory, never the raw plugin", () => {
    for (const file of SURFACES) {
      expect(read(file), `${file} must not construct MinimapPlugin directly`)
        .not.toContain("new MinimapPlugin");
    }
    expect(read("src/graph/components/Minimap.tsx")).toContain("requestAnimationFrame");
  });

  // Not cosmetic: the outer graph is already invisible under the opaque backdrop, so the
  // rule exists purely to drop its raster. Deleting it as dead styling puts two canvases'
  // worth of textures on a mobile GPU that can't afford one (see renderer-performance.md
  // § GPU layer promotion). `display: none` is the wrong cure — it zeroes the layout the
  // main area still measures while drilled in.
  it("stops painting the main canvas while a drill-in covers it", () => {
    const css = read("src/graph/components/compositeEditor.css");
    expect(css).toMatch(/html\.sol-drilled-in\s+\.solenoid-canvas-wrapper\s*\{\s*visibility:\s*hidden/);
    expect(css).not.toMatch(/html\.sol-drilled-in\s+\.solenoid-canvas-wrapper\s*\{\s*display:\s*none/);
  });

  it("clamps the zoom scale to a fixed floor and ceiling", () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(MIN_ZOOM).toBeLessThan(MAX_ZOOM);
    // Installed in the shared installSurfacePointer, so every surface (already pinned
    // above to call it) gets the same limits — via the area's pre-apply `zoom` guard.
    expect(read("src/graph/areaPresets.ts")).toMatch(/type === "zoom"[\s\S]*clampZoom/);
  });

  it("guards node drag through the shared installer on every surface", () => {
    // The guard used to be inlined in Canvas (the drill-in had none, so a finger press
    // grabbed a card and a pan over cards was dead). It now lives in areaPresets and both
    // surfaces install it; the pinch veto that stops a NEW drag under a second finger is
    // inside the guard itself.
    expect(read("src/graph/areaPresets.ts")).toMatch(/installNodeDragGuard[\s\S]*isPinching\(\)/);
    // The drill-in still needs the IN-FLIGHT veto too (a drag already moving when a second
    // finger lands), which the guard's start-time check can't cover.
    expect(read("src/graph/components/CompositeEditorOverlay.tsx"))
      .toContain("installPinchTranslateVeto");
  });
});
