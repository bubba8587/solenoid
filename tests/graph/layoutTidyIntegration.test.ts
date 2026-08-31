import { describe, it, expect } from "vitest";
import ELK from "elkjs";
import { ELK_ROOT_OPTIONS, tidyLayoutOptions, tidyLayerSplitFor, type TidyDirection, type TidyDensity, type TidyWidthCap } from "../../src/graph/tidyArrange";

// ─── Tidy knob → ELK option contract ────────────────────────────────────────────
// The REAL arrange path (makeArrangeFn over a fake area, standoff clusters and the
// overlap backstop included) is driven headless by tidyArrangeGroups.test.ts. What
// that suite doesn't pin is the knob mapping itself and ELK's behavior under it:
// this file drives elkjs directly with the app's own root options (ELK_ROOT_OPTIONS,
// the same constant elkTidyLayout spreads) + tidyLayoutOptions, and asserts the
// width cap's layerUnzipping really wraps a fat layer without overlaps.

const elk = new ELK();

function appOpts(s: { direction: TidyDirection; density: TidyDensity; widthCap: TidyWidthCap }): Record<string, string> {
  return { ...ELK_ROOT_OPTIONS, ...tidyLayoutOptions(s) };
}
const DEFAULT_TIDY = { direction: "right", density: "normal", widthCap: 0 } as const;

type Rect = { id: string; x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;
function firstOverlap(rects: Rect[]): string | null {
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      if (overlaps(rects[i], rects[j])) return `${rects[i].id} ∩ ${rects[j].id}`;
  return null;
}

type ElkNode = { id: string; width: number; height: number };
type ElkEdge = { id: string; sources: string[]; targets: string[] };
async function layout(
  children: ElkNode[],
  edges: ElkEdge[],
  tidy: { direction: TidyDirection; density: TidyDensity; widthCap: TidyWidthCap } = DEFAULT_TIDY,
): Promise<{ rects: Rect[]; width: number; height: number }> {
  // Faithful reproduction: the app stamps the per-node `layerSplit` (the port preset's
  // `options` hook) from the layout's node count — `tidyLayoutOptions` only carries the
  // global strategy switch. Mirror that here via the shared formula.
  const split = tidyLayerSplitFor(children.length, tidy.widthCap);
  const kids = children.map((c) => ({
    ...c,
    ...(split > 0 ? { layoutOptions: { "elk.layered.layerUnzipping.layerSplit": String(split) } } : {}),
  }));
  const g = await elk.layout({ id: "root", layoutOptions: appOpts(tidy), children: kids, edges }) as {
    children?: { id: string; x?: number; y?: number; width?: number; height?: number }[];
    width?: number; height?: number;
  };
  return {
    rects: (g.children ?? []).map((c) => ({ id: c.id, x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 })),
    width: g.width ?? 0,
    height: g.height ?? 0,
  };
}

// distinct coordinate buckets among a set of rects (1px tolerance), per axis.
function distinct(rects: Rect[], axis: "x" | "y"): number {
  const vals = rects.map((r) => r[axis]).sort((a, b) => a - b);
  let n = 0;
  let last = Number.NaN;
  for (const v of vals) { if (Number.isNaN(last) || Math.abs(v - last) > 1) { n++; last = v; } }
  return n;
}

describe("tidyLayoutOptions — the three knobs map to ELK options", () => {
  it("direction sets elk.direction; RIGHT and DOWN", () => {
    expect(tidyLayoutOptions({ direction: "right", density: "normal", widthCap: 0 })["elk.direction"]).toBe("RIGHT");
    expect(tidyLayoutOptions({ direction: "down", density: "normal", widthCap: 0 })["elk.direction"]).toBe("DOWN");
  });

  it("density picks the spacing pair; normal stays today's 55/38", () => {
    const pair = (d: TidyDensity) => {
      const o = tidyLayoutOptions({ direction: "right", density: d, widthCap: 0 });
      return [o["elk.layered.spacing.nodeNodeBetweenLayers"], o["elk.spacing.nodeNode"]];
    };
    expect(pair("compact")).toEqual(["36", "24"]);
    expect(pair("normal")).toEqual(["55", "38"]);
    expect(pair("airy")).toEqual(["80", "56"]);
  });

  it("a width cap turns layerUnzipping on globally; off omits it", () => {
    const off = tidyLayoutOptions({ direction: "right", density: "normal", widthCap: 0 });
    expect(off["elk.layered.layerUnzipping.strategy"]).toBeUndefined();
    for (const cap of [2, 3, 4] as const) {
      const o = tidyLayoutOptions({ direction: "right", density: "normal", widthCap: cap });
      expect(o["elk.layered.layerUnzipping.strategy"]).toBe("ALTERNATING");
    }
  });

  it("tidyLayerSplitFor: 'at most N per row' → ceil(count/cap), floored at 1; 0 uncapped", () => {
    expect(tidyLayerSplitFor(10, 0)).toBe(0);
    // 10 nodes: cap 2 → 5 sublayers, cap 3 → 4, cap 4 → 3 (the per-layer width never exceeds cap).
    expect(tidyLayerSplitFor(10, 2)).toBe(5);
    expect(tidyLayerSplitFor(10, 3)).toBe(4);
    expect(tidyLayerSplitFor(10, 4)).toBe(3);
    expect(tidyLayerSplitFor(1, 4)).toBe(1); // floored at 1
  });
});

describe("width cap wraps a fat layer (layerUnzipping), no overlaps", () => {
  // A 9→1 fan: without a cap ELK stacks all 9 sources in ONE layer (a very tall/wide column);
  // a cap wraps that layer into sublayers so no row holds more than `cap`. RIGHT wraps along
  // x, DOWN along y. The fan is 10 nodes total (9 sources + sink), so the shared split formula
  // gives ceil(10/cap) sublayers: cap 2→5, cap 3→4, cap 4→3 — each keeps the per-row count ≤ cap.
  const fan = () => {
    const children: ElkNode[] = [{ id: "sink", width: 180, height: 80 }];
    const edges: ElkEdge[] = [];
    for (let i = 0; i < 9; i++) {
      children.push({ id: `s${i}`, width: 180, height: 80 });
      edges.push({ id: `e${i}`, sources: [`s${i}`], targets: ["sink"] });
    }
    return { children, edges };
  };
  const sources = (rects: Rect[]) => rects.filter((r) => r.id !== "sink");
  // Largest count of sources sharing one axis bucket (~2px tolerance) — the widest "row".
  const maxPerBucket = (rects: Rect[], axis: "x" | "y"): number => {
    const counts = new Map<number, number>();
    for (const r of rects) {
      const key = Math.round(r[axis] / 2);
      let placed = false;
      for (const k of counts.keys()) if (Math.abs(k - key) <= 1) { counts.set(k, counts.get(k)! + 1); placed = true; break; }
      if (!placed) counts.set(key, 1);
    }
    return Math.max(...counts.values());
  };

  it("RIGHT: each cap wraps the 9-fan so no x-column exceeds the cap; shorter than uncapped", async () => {
    const { children, edges } = fan();
    const uncapped = await layout(children, edges, { direction: "right", density: "normal", widthCap: 0 });
    expect(distinct(sources(uncapped.rects), "x")).toBe(1);      // all 9 in one column
    expect(maxPerBucket(sources(uncapped.rects), "x")).toBe(9);
    expect(firstOverlap(uncapped.rects)).toBeNull();
    for (const cap of [2, 3, 4] as const) {
      const capped = await layout(children, edges, { direction: "right", density: "normal", widthCap: cap });
      expect(distinct(sources(capped.rects), "x")).toBeGreaterThan(1);       // it wrapped
      expect(maxPerBucket(sources(capped.rects), "x")).toBeLessThanOrEqual(cap); // no row over cap
      expect(capped.height).toBeLessThan(uncapped.height);                    // the fat column shrank
      expect(firstOverlap(capped.rects)).toBeNull();
    }
  });

  it("DOWN: each cap wraps the 9-fan so no y-row exceeds the cap; shorter than uncapped", async () => {
    const { children, edges } = fan();
    const uncapped = await layout(children, edges, { direction: "down", density: "normal", widthCap: 0 });
    expect(distinct(sources(uncapped.rects), "y")).toBe(1);
    expect(maxPerBucket(sources(uncapped.rects), "y")).toBe(9);
    expect(firstOverlap(uncapped.rects)).toBeNull();
    for (const cap of [2, 3, 4] as const) {
      const capped = await layout(children, edges, { direction: "down", density: "normal", widthCap: cap });
      expect(distinct(sources(capped.rects), "y")).toBeGreaterThan(1);
      expect(maxPerBucket(sources(capped.rects), "y")).toBeLessThanOrEqual(cap);
      expect(capped.width).toBeLessThan(uncapped.width);
      expect(firstOverlap(capped.rects)).toBeNull();
    }
  });
});
