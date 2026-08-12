import { describe, it, expect } from "vitest";
import { separateOverlaps, computeExpandPush, type PushBox, type ExpandSpec, type Disp } from "./groupPushCore";
import { distributeDeltas, alignDeltas, DISTRIBUTE_GAP, type Placed } from "./selectionOps";
import { solveStandoffs } from "./standoffSolver";
import { anchorPoint, ANCHOR_DIR, STANDOFF_MIN, type Standoff, type StandoffAnchor, type Box } from "./standoffs";

// ─── Property tests for the author's standing "no overlaps ever" rule ────────────
// Randomized-fixture sweeps over the PURE layout cores, so the invariants each op
// guarantees are machine-checked (there was no such check before). A fixed seed per
// suite makes every failure reproducible: re-run and the same fixtures regenerate.
//
// What each op actually guarantees (do NOT over-assert):
//   • separateOverlaps  — the HARD no-overlap backstop: after it, no non-baseline
//     pair overlaps (this is the guarantee the group-expand pipeline leans on;
//     computeExpandPush alone is heuristic and CAN leave overlaps by design).
//   • distributeDeltas  — ≥ DISTRIBUTE_GAP between neighbors ALONG the distributed
//     axis (overlap-free on that axis; the cross axis is intentionally untouched).
//   • alignDeltas       — aligns the chosen edge; it is DELIBERATELY not overlap-free
//     (a manual gesture, like every design tool's Align), so we assert the alignment
//     contract, NOT no-overlap.
//   • solveStandoffs    — the band holds: the axis projection lands in [min,max], and
//     a locked/forced standoff also zeroes the perpendicular offset.

// Deterministic PRNG (mulberry32) — same pattern as modelFuzz.ts.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo));

type Rect = { id: string; x: number; y: number; w: number; h: number };
const applyDisp = <T extends Rect>(b: T, disp: Map<string, Disp>): T => {
  const d = disp.get(b.id);
  return d ? { ...b, x: b.x + d.dx, y: b.y + d.dy } : b;
};
const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-9 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-9;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** First non-baseline overlapping pair as a string, or null if none. */
function firstOverlap(boxes: Rect[], baseline: Set<string> = new Set()): string | null {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (baseline.has(pairKey(boxes[i].id, boxes[j].id))) continue;
      if (overlaps(boxes[i], boxes[j])) return `${boxes[i].id} ∩ ${boxes[j].id}`;
    }
  }
  return null;
}
function overlappingPairs(boxes: Rect[]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) s.add(pairKey(boxes[i].id, boxes[j].id));
    }
  }
  return s;
}

function randBoxes(rng: () => number, n: number, spread = 600): PushBox[] {
  const boxes: PushBox[] = [];
  for (let i = 0; i < n; i++) {
    boxes.push({ id: `b${i}`, x: ri(rng, 0, spread), y: ri(rng, 0, spread * 0.7), w: ri(rng, 40, 300), h: ri(rng, 30, 210) });
  }
  return boxes;
}

describe("separateOverlaps — the hard no-overlap backstop (randomized)", () => {
  it("clears every non-baseline overlap across 300 seeded fixtures", () => {
    const rng = mulberry32(0x0A11);
    for (let iter = 0; iter < 300; iter++) {
      const boxes = randBoxes(rng, ri(rng, 3, 10));
      const disp = separateOverlaps(boxes);
      const moved = boxes.map((b) => applyDisp(b, disp));
      // The guarantee: no two boxes overlap after (no baseline exemptions here).
      expect(firstOverlap(moved)).toBeNull();
      // Monotonic: it only ever shifts down/right (preserves the anchor corner).
      for (const [, d] of disp) {
        expect(d.dx).toBeGreaterThanOrEqual(0);
        expect(d.dy).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("leaves baseline (pre-existing user) overlaps alone but clears the rest", () => {
    const rng = mulberry32(0x0B22);
    for (let iter = 0; iter < 200; iter++) {
      const boxes = randBoxes(rng, ri(rng, 3, 9), 400); // denser → more pre-overlaps
      const baseline = overlappingPairs(boxes);
      const disp = separateOverlaps(boxes, baseline);
      const moved = boxes.map((b) => applyDisp(b, disp));
      // Every NON-baseline pair must be separated; baseline pairs are exempt.
      expect(firstOverlap(moved, baseline)).toBeNull();
    }
  });
});

describe("group expand push → separateOverlaps (the app pipeline) is finite + overlap-free", () => {
  it("no NaN out of computeExpandPush, and the composed result has no non-baseline overlap", () => {
    const rng = mulberry32(0x0E33);
    for (let iter = 0; iter < 200; iter++) {
      const preW = ri(rng, 80, 160), preH = ri(rng, 30, 70);
      const spec: ExpandSpec = {
        x: ri(rng, 0, 100), y: ri(rng, 0, 100),
        preW, preH,
        postW: preW + ri(rng, 40, 320), postH: preH + ri(rng, 40, 320),
      };
      // Obstacles scattered around the group's growth quadrant.
      const obstacles = randBoxes(rng, ri(rng, 3, 8), 500).map((b) => ({ ...b, x: spec.x + b.x - 100, y: spec.y + b.y - 60 }));
      const push = computeExpandPush(spec, obstacles, new Map());
      for (const [, d] of push) {
        expect(Number.isFinite(d.dx) && Number.isFinite(d.dy)).toBe(true);
      }
      const pushed = obstacles.map((b) => applyDisp(b, push));
      // Baseline = pairs that already overlapped BEFORE the expand (user-made, exempt).
      const baseline = overlappingPairs(obstacles);
      const sep = separateOverlaps(pushed, baseline);
      const final = pushed.map((b) => applyDisp(b, sep));
      expect(firstOverlap(final, baseline)).toBeNull();
    }
  });
});

describe("distributeDeltas — ≥ DISTRIBUTE_GAP between neighbors along the axis", () => {
  for (const axis of ["h", "v"] as const) {
    it(`no along-axis overlap after distribute (axis ${axis}, randomized)`, () => {
      const rng = mulberry32(axis === "h" ? 0x0D44 : 0x0D55);
      const start = (b: Rect) => (axis === "h" ? b.x : b.y);
      const size = (b: Rect) => (axis === "h" ? b.w : b.h);
      for (let iter = 0; iter < 200; iter++) {
        const n = ri(rng, 3, 9);
        const items: Placed[] = [];
        for (let i = 0; i < n; i++) {
          items.push({ id: `n${i}`, box: { x: ri(rng, 0, 800), y: ri(rng, 0, 500), w: ri(rng, 40, 260), h: ri(rng, 30, 180) } });
        }
        const moves = distributeDeltas(items, axis);
        const byId = new Map(moves.map((m) => [m.seedId, m]));
        const placed = items.map((it) => {
          const m = byId.get(it.id);
          return { id: it.id, x: it.box.x + (m?.dx ?? 0), y: it.box.y + (m?.dy ?? 0), w: it.box.w, h: it.box.h };
        });
        placed.sort((a, b) => start(a) - start(b));
        for (let i = 1; i < placed.length; i++) {
          const gap = start(placed[i]) - (start(placed[i - 1]) + size(placed[i - 1]));
          expect(gap).toBeGreaterThanOrEqual(DISTRIBUTE_GAP - 1e-6);
        }
      }
    });
  }
});

describe("alignDeltas — aligns the chosen edge (overlap is allowed BY DESIGN)", () => {
  const items = (rng: () => number, n: number): Placed[] =>
    Array.from({ length: n }, (_, i) => ({ id: `n${i}`, box: { x: ri(rng, 0, 800), y: ri(rng, 0, 500), w: ri(rng, 40, 260), h: ri(rng, 30, 180) } }));
  const place = (its: Placed[], moves: ReturnType<typeof alignDeltas>) => {
    const byId = new Map(moves.map((m) => [m.seedId, m]));
    return its.map((it) => {
      const m = byId.get(it.id);
      return { x: it.box.x + (m?.dx ?? 0), y: it.box.y + (m?.dy ?? 0), w: it.box.w, h: it.box.h };
    });
  };

  it("align-left drives every box to the selection's min x", () => {
    const rng = mulberry32(0x0F66);
    for (let iter = 0; iter < 100; iter++) {
      const its = items(rng, ri(rng, 2, 8));
      const minX = Math.min(...its.map((e) => e.box.x));
      for (const r of place(its, alignDeltas(its, "left"))) expect(r.x).toBeCloseTo(minX, 6);
    }
  });

  it("align-top drives every box to the selection's min y", () => {
    const rng = mulberry32(0x0F77);
    for (let iter = 0; iter < 100; iter++) {
      const its = items(rng, ri(rng, 2, 8));
      const minY = Math.min(...its.map((e) => e.box.y));
      for (const r of place(its, alignDeltas(its, "top"))) expect(r.y).toBeCloseTo(minY, 6);
    }
  });

  it("align-center-h shares one vertical center line (centers equal)", () => {
    const rng = mulberry32(0x0F88);
    for (let iter = 0; iter < 100; iter++) {
      const its = items(rng, ri(rng, 2, 8));
      const centers = place(its, alignDeltas(its, "center-h")).map((r) => r.x + r.w / 2);
      for (const c of centers) expect(c).toBeCloseTo(centers[0], 6);
    }
  });
});

describe("solveStandoffs — the band holds after a satisfiable solve (randomized)", () => {
  const ANCHORS: StandoffAnchor[] = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];
  it("single standoff, one pinned end: projection ∈ [min,max]; locked ⇒ perpendicular 0", () => {
    const rng = mulberry32(0x0C99);
    for (let iter = 0; iter < 400; iter++) {
      const aAnchor = ANCHORS[ri(rng, 0, 8)];
      const bAnchor = ANCHORS[ri(rng, 0, 8)];
      const A: Box = { x: ri(rng, -300, 300), y: ri(rng, -300, 300), w: ri(rng, 60, 240), h: ri(rng, 40, 160) };
      const B: Box = { x: ri(rng, -600, 600), y: ri(rng, -600, 600), w: ri(rng, 60, 240), h: ri(rng, 40, 160) };
      const min = STANDOFF_MIN + ri(rng, 0, 120);
      const max = min + 20 + ri(rng, 0, 240);
      const locked = rng() < 0.5;
      const s: Standoff = { id: "s", a: { nodeId: "a", anchor: aAnchor }, b: { nodeId: "b", anchor: bAnchor }, min, max, locked };
      // A pinned → the whole correction goes to the free end B, which converges exactly.
      const disp = solveStandoffs(new Map([["a", A], ["b", B]]), [s], new Set(["a"]));
      const dB = disp.get("b") ?? { dx: 0, dy: 0 };
      const pa = anchorPoint(A, aAnchor);
      const pb = anchorPoint({ ...B, x: B.x + dB.dx, y: B.y + dB.dy }, bAnchor);
      const axis = ANCHOR_DIR[aAnchor];
      const t = (pb.x - pa.x) * axis.x + (pb.y - pa.y) * axis.y;
      expect(t).toBeGreaterThanOrEqual(min - 1);
      expect(t).toBeLessThanOrEqual(max + 1);
      if (locked) {
        const tp = (pb.x - pa.x) * -axis.y + (pb.y - pa.y) * axis.x;
        expect(Math.abs(tp)).toBeLessThan(1);
      }
    }
  });

  it("a satisfiable east-anchored chain (cluster): every link's band holds", () => {
    const rng = mulberry32(0x0CAA);
    for (let iter = 0; iter < 150; iter++) {
      const k = ri(rng, 3, 6);
      const boxes = new Map<string, Box>();
      const standoffs: Standoff[] = [];
      let x = 0;
      for (let i = 0; i < k; i++) {
        boxes.set(`n${i}`, { x, y: ri(rng, -60, 60), w: ri(rng, 60, 160), h: ri(rng, 40, 120) });
        x += ri(rng, 150, 620); // scatter so links start over/under-stretched
      }
      for (let i = 0; i + 1 < k; i++) {
        const min = STANDOFF_MIN + ri(rng, 0, 80);
        const max = min + 20 + ri(rng, 0, 160);
        standoffs.push({ id: `s${i}`, a: { nodeId: `n${i}`, anchor: "e" }, b: { nodeId: `n${i + 1}`, anchor: "w" }, min, max });
      }
      const disp = solveStandoffs(boxes, standoffs, new Set(["n0"])); // root pinned
      const at = (id: string): Box => {
        const b = boxes.get(id)!;
        const d = disp.get(id) ?? { dx: 0, dy: 0 };
        return { ...b, x: b.x + d.dx, y: b.y + d.dy };
      };
      for (const s of standoffs) {
        const t = anchorPoint(at(s.b.nodeId), "w").x - anchorPoint(at(s.a.nodeId), "e").x; // east axis = (1,0)
        expect(t).toBeGreaterThanOrEqual(s.min - 1.5);
        expect(t).toBeLessThanOrEqual(s.max + 1.5);
      }
    }
  });
});
