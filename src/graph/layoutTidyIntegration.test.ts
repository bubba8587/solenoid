import { describe, it, expect } from "vitest";
import ELK from "elkjs";
import { solveStandoffs } from "./standoffSolver";
import { separateOverlaps, type PushBox } from "./groupPushCore";
import { anchorPoint, ANCHOR_DIR, type Box, type Standoff } from "./standoffs";

// ─── ELK Tidy integration guard ─────────────────────────────────────────────────
// The layout property tests (layoutInvariants.test.ts) exercise the PURE cores in
// isolation. This file covers the INTEGRATION they scoped out: elkjs actually running
// under node with the app's real layout options, then the app's post-layout passes
// (standoff settle + separateOverlaps) applied to ELK's output — asserting the
// no-overlap invariant survives the whole Tidy pipeline.
//
// What this can and CANNOT do headless: the real `arrangeFn` (Canvas.tsx) is DOM-
// coupled — it reads node sizes off `area.nodeViews` (offsetWidth), stamps inline
// heights, and moves nodes via async `area.translate`. None of that runs in vitest's
// node env. So this drives **elkjs directly** with the app's documented ELK options +
// the super-node trick Tidy uses for a standoff cluster (lay a cluster out as ONE box,
// then expand + settle), which is the faithful data-level reproduction. elkjs is a
// small, fast, deterministic layout here (a handful of nodes) so it runs in the default
// suite; if it ever turns heavy/flaky, gate the describe with
// `describe.runIf(!!process.env.SLOW)` and run `SLOW=1 npx vitest run layoutTidyIntegration`.

const elk = new ELK();

// The app's ELK config (Canvas.tsx arrangeFn): layered, rightward, with its spacings.
const APP_OPTS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "55",
  "elk.spacing.nodeNode": "38",
};

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
async function layout(children: ElkNode[], edges: ElkEdge[]): Promise<Rect[]> {
  const g = await elk.layout({ id: "root", layoutOptions: APP_OPTS, children, edges });
  return (g.children ?? []).map((c) => ({ id: c.id, x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 }));
}

describe("ELK Tidy integration (elkjs under node + the app's post-layout passes)", () => {
  it("lays out a layered graph with the app's spacing — no node overlaps", async () => {
    // A diamond + a tail, varied heights (a Number vs a Frame), like a real graph.
    const rects = await layout(
      [
        { id: "a", width: 180, height: 80 },
        { id: "b", width: 180, height: 120 },
        { id: "c", width: 180, height: 60 },
        { id: "d", width: 240, height: 160 },
        { id: "e", width: 180, height: 90 },
      ],
      [
        { id: "e1", sources: ["a"], targets: ["b"] },
        { id: "e2", sources: ["a"], targets: ["c"] },
        { id: "e3", sources: ["b"], targets: ["d"] },
        { id: "e4", sources: ["c"], targets: ["d"] },
        { id: "e5", sources: ["d"], targets: ["e"] },
      ],
    );
    expect(rects.length).toBe(5);
    expect(firstOverlap(rects)).toBeNull();
  });

  it("a standoff cluster (as an ELK super-node) reserves space; settle + backstop stay overlap-free", async () => {
    // Tidy lays a standoff-connected pair out as ONE super-node sized to the pair's bbox
    // (leader sized to the cluster, real sizes restored after). Model that: the cluster
    // occupies a single 180×198 box (two 180×80 members stacked with a 38 gap) among
    // ordinary nodes, plus a GROUP box (a sized container node).
    const M = { w: 180, h: 80 };
    const GAP = 38;
    const clusterH = M.h * 2 + GAP; // 198
    const rects = await layout(
      [
        { id: "src", width: 180, height: 70 },
        { id: "cluster", width: M.w, height: clusterH }, // the super-node
        { id: "group", width: 320, height: 220 },        // a group container node
        { id: "sink", width: 180, height: 70 },
      ],
      [
        { id: "e1", sources: ["src"], targets: ["cluster"] },
        { id: "e2", sources: ["src"], targets: ["group"] },
        { id: "e3", sources: ["cluster"], targets: ["sink"] },
        { id: "e4", sources: ["group"], targets: ["sink"] },
      ],
    );
    // ELK itself keeps every laid-out box (incl. the cluster super-node + the group) apart.
    expect(firstOverlap(rects)).toBeNull();

    // Expand the super-node into its two members at the leader's position, stacked with a
    // small OFFSET so the settle actually has to correct them (mimics a naive expansion).
    const superNode = rects.find((r) => r.id === "cluster")!;
    const top: Box = { x: superNode.x, y: superNode.y, w: M.w, h: M.h };
    const bottom: Box = { x: superNode.x + 6, y: superNode.y + M.h + GAP + 4, w: M.w, h: M.h }; // 6px skew
    // A LOCKED vertical standoff: top.south → bottom.north, band [GAP-ish], perpendicular→0.
    const standoff: Standoff = {
      id: "s", a: { nodeId: "top", anchor: "s" }, b: { nodeId: "bottom", anchor: "n" },
      min: 20, max: 80, locked: true,
    };
    const disp = solveStandoffs(new Map([["top", top], ["bottom", bottom]]), [standoff], new Set(["top"]));
    const dB = disp.get("bottom") ?? { dx: 0, dy: 0 };
    const settledBottom: Box = { ...bottom, x: bottom.x + dB.dx, y: bottom.y + dB.dy };

    // The locked band holds: the members line up on the vertical axis (perpendicular ≈ 0)
    // and their gap sits in [min,max].
    const pa = anchorPoint(top, "s");
    const pb = anchorPoint(settledBottom, "n");
    const axis = ANCHOR_DIR["s"]; // (0,1)
    const along = (pb.x - pa.x) * axis.x + (pb.y - pa.y) * axis.y;
    const perp = (pb.x - pa.x) * -axis.y + (pb.y - pa.y) * axis.x;
    expect(Math.abs(perp)).toBeLessThan(1);           // rigid 45°/locked → aligned
    expect(along).toBeGreaterThanOrEqual(20 - 1);
    expect(along).toBeLessThanOrEqual(80 + 1);

    // Final scene: the two settled members + every non-cluster node. The app's overlap
    // backstop (separateOverlaps) must leave it fully overlap-free.
    const others = rects.filter((r) => r.id !== "cluster");
    const scene: PushBox[] = [
      { id: "top", x: top.x, y: top.y, w: top.w, h: top.h },
      { id: "bottom", x: settledBottom.x, y: settledBottom.y, w: settledBottom.w, h: settledBottom.h },
      ...others.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
    ];
    const sep = separateOverlaps(scene);
    const finalRects: Rect[] = scene.map((b) => {
      const d = sep.get(b.id);
      return { id: b.id, x: b.x + (d?.dx ?? 0), y: b.y + (d?.dy ?? 0), w: b.w, h: b.h };
    });
    expect(firstOverlap(finalRects)).toBeNull();
  });
});
