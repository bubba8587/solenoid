import { describe, it, expect } from "vitest";
import { computeExpandPush, separateOverlaps, PushBox, Satellite, ExpandSpec, PUSH_GAP, Pt } from "./groupPushCore";

// A group at (0,0) collapsing to a 100×40 card, expanding to 400×300.
const spec: ExpandSpec = { x: 0, y: 0, preW: 100, preH: 40, postW: 400, postH: 300 };
const RIGHT = spec.x + spec.postW;  // expanded right edge (400)
const BOTTOM = spec.y + spec.postH; // expanded bottom edge (300)

const box = (id: string, x: number, y: number, w = 80, h = 50): PushBox => ({ id, x, y, w, h });

const run = (obstacles: PushBox[], sats?: Map<string, Satellite>) =>
  computeExpandPush(spec, obstacles, sats ?? new Map());

const after = (b: PushBox, d?: { dx: number; dy: number }) => ({
  x: b.x + (d?.dx ?? 0),
  y: b.y + (d?.dy ?? 0),
});

describe("clear (minimal disturbance)", () => {
  it("moves a covered right-side neighbor just clear of the expanded edge", () => {
    const a = box("a", 130, 100); // covered by the 400×300 footprint, beside the card
    const d = run([a]);
    expect(after(a, d.get("a"))).toEqual({ x: RIGHT + PUSH_GAP, y: 100 });
  });

  it("moves a covered below neighbor just clear of the expanded bottom", () => {
    const a = box("a", 10, 80);
    const d = run([a]);
    expect(after(a, d.get("a"))).toEqual({ x: 10, y: BOTTOM + PUSH_GAP });
  });

  it("a box deep inside the footprint moves the short way out, not by the growth delta", () => {
    const a = box("a", 350, 100); // 50px from the expanded right edge
    const d = run([a]).get("a")!;
    expect(d).toEqual({ dx: RIGHT + PUSH_GAP - 350, dy: 0 }); // 78px, not 300
  });

  it("resolves a corner neighbor to its dominant axis: roughly-beside goes right", () => {
    const a = box("a", 150, 90);
    expect(after(a, run([a]).get("a"))).toEqual({ x: RIGHT + PUSH_GAP, y: 90 });
  });

  it("resolves a corner neighbor to its dominant axis: roughly-under goes down", () => {
    const a = box("a", 110, 220);
    expect(after(a, run([a]).get("a"))).toEqual({ x: 110, y: BOTTOM + PUSH_GAP });
  });

  it("never moves neighbors left of or above the group", () => {
    const d = run([box("left", -200, 100), box("above", 10, -100)]);
    expect(d.size).toBe(0);
  });

  it("expands into free area without moving anything already clear of the footprint", () => {
    const d = run([box("right", 450, 100), box("far-below", 150, 400)]);
    expect(d.size).toBe(0);
  });

  it("exempts boxes the user parked on the collapsed card", () => {
    const d = run([box("a", 50, 10)]); // overlaps the 100×40 card
    expect(d.size).toBe(0);
  });
});

// A within-group Tidy doesn't go small-card → big-box; it grows an ALREADY-large
// box a bit (e.g. ELK spread the members wider). Same engine, different pre-size:
// neighbors the GROWN edge newly covers must still be pushed.
describe("grow push (within-group Tidy grows an already-expanded box)", () => {
  // 200×150 group at origin, grown to 280×150 (wrapped wider members → +80 right).
  const grow: ExpandSpec = { x: 0, y: 0, preW: 200, preH: 150, postW: 280, postH: 150 };
  const growRight = grow.x + grow.postW; // 280

  it("pushes a neighbor the grown right edge now covers", () => {
    const a: PushBox = { id: "a", x: 220, y: 50, w: 60, h: 40 }; // clear of preW=200, covered by postW=280
    const d = computeExpandPush(grow, [a], new Map());
    expect(after(a, d.get("a"))).toEqual({ x: growRight + PUSH_GAP, y: 50 });
  });

  it("leaves a neighbor already clear of the grown footprint", () => {
    const a: PushBox = { id: "a", x: 320, y: 50, w: 60, h: 40 }; // beyond postW=280
    const d = computeExpandPush(grow, [a], new Map());
    expect(d.size).toBe(0);
  });
});

describe("connection-aware rails", () => {
  it("rails a displaced upstream feeder to the LEFT edge, aligned with its member", () => {
    const a = box("a", 130, 100); // covered — would clear right
    const sats = new Map<string, Satellite>([["a", { side: "upstream", alignCy: 120 }]]);
    const d = run([a], sats).get("a")!;
    expect(a.x + d.dx).toBeCloseTo(spec.x - PUSH_GAP - a.w);
    expect(a.y + d.dy + a.h / 2).toBeCloseTo(120);
  });

  it("rails a below-parked consumer to the RIGHT edge instead of pushing it further down", () => {
    const a = box("a", 10, 80); // covered — would clear down
    const sats = new Map<string, Satellite>([["a", { side: "downstream", alignCy: 150 }]]);
    const d = run([a], sats).get("a")!;
    expect(a.x + d.dx).toBeCloseTo(RIGHT + PUSH_GAP);
    expect(a.y + d.dy + a.h / 2).toBeCloseTo(150);
  });

  it("keeps a consumer already on the right side on its row (cleared, not re-placed)", () => {
    const a = box("a", 130, 100);
    const sats = new Map<string, Satellite>([["a", { side: "downstream", alignCy: 250 }]]);
    const d = run([a], sats).get("a")!;
    expect(after(a, d)).toEqual({ x: RIGHT + PUSH_GAP, y: 100 }); // y untouched
  });

  it("leaves a satellite the expansion doesn't touch alone", () => {
    const a = box("a", -300, 100); // far left, clear of everything
    const sats = new Map<string, Satellite>([["a", { side: "downstream", alignCy: 150 }]]);
    expect(run([a], sats).size).toBe(0);
  });

  it("stacks two satellites railed to the same side without overlap", () => {
    const a = box("a", 130, 100, 80, 50);
    const b = box("b", 150, 110, 80, 50);
    const sats = new Map<string, Satellite>([
      ["a", { side: "upstream", alignCy: 120 }],
      ["b", { side: "upstream", alignCy: 120 }],
    ]);
    const d = run([a, b], sats);
    const ra = after(a, d.get("a"));
    const rb = after(b, d.get("b"));
    expect(ra.x).toBeCloseTo(rb.x); // same rail
    const top = Math.min(ra.y, rb.y);
    const bottom = Math.max(ra.y, rb.y);
    expect(bottom).toBeGreaterThanOrEqual(top + 50); // no vertical overlap
  });
});

describe("cascade", () => {
  it("pushes a box the mover lands on just clear, in the direction of travel", () => {
    const b = box("b", 130, 100, 80, 50); // covered → clears to x=428
    const c = box("c", 460, 100, 80, 50); // clear of the footprint, in b's landing path
    const d = run([b, c]);
    const rb = after(b, d.get("b"));
    expect(rb.x).toBe(RIGHT + PUSH_GAP);
    expect(after(c, d.get("c"))).toEqual({ x: rb.x + 80 + PUSH_GAP, y: 100 });
  });

  it("re-stacks two covered boxes in their original order instead of flattening", () => {
    const b1 = box("b1", 130, 100, 80, 50);
    const b2 = box("b2", 250, 100, 80, 50); // both clear to the same edge line
    const d = run([b1, b2]);
    const r1 = after(b1, d.get("b1"));
    const r2 = after(b2, d.get("b2"));
    expect(r1.x).toBe(RIGHT + PUSH_GAP);
    expect(r2.x).toBeGreaterThanOrEqual(r1.x + 80 + PUSH_GAP); // still ordered, not overlapping
  });

  it("does not cascade when the pushed box lands clear of an out-of-band neighbor", () => {
    const a = box("a", 130, 100, 80, 50);      // clears to 428..508, y 100..150
    const cAbove = box("c", 460, -80, 80, 60); // fully above a's landing spot
    const d = run([a, cAbove]);
    expect(d.has("c")).toBe(false);
  });

  it("does not separate pairs that already overlapped before the expand", () => {
    const a = box("a", 130, 100, 80, 50);
    const b = box("b", 140, 110, 80, 50); // already overlapping a
    const d = run([a, b]);
    // Both get cleared (both covered), but no cascade tries to pry them apart.
    expect(d.get("a")).toBeDefined();
    expect(d.get("b")).toBeDefined();
    const ra = after(a, d.get("a"));
    const rb = after(b, d.get("b"));
    // Their relative offset may compress, but neither is flung further than
    // one clearing distance.
    expect(Math.abs(rb.x - ra.x)).toBeLessThanOrEqual(20);
  });
});

describe("connection anchors (shortest connections win)", () => {
  const runA = (obstacles: PushBox[], anchors: Map<string, Pt[]>) =>
    computeExpandPush(spec, obstacles, new Map(), anchors);

  it("a covered node wired to something on the LEFT hops left, staying near it", () => {
    // The reported case: Group C (the spec) expands over loose node B, which
    // is connected to Group A off to the left. B must end near A, not be
    // flung past C's right edge.
    const b = box("b", 150, 100);
    const anchorsOfA = new Map([["b", [{ x: -200, y: 125 }]]]);
    const d = runA([b], anchorsOfA).get("b")!;
    expect(after(b, d)).toEqual({ x: spec.x - PUSH_GAP - b.w, y: 100 }); // left of the group
  });

  it("a covered node wired to something ABOVE hops up", () => {
    const b = box("b", 150, 100);
    const anchorsAbove = new Map([["b", [{ x: 190, y: -250 }]]]);
    const d = runA([b], anchorsAbove).get("b")!;
    expect(after(b, d)).toEqual({ x: 150, y: spec.y - PUSH_GAP - b.h }); // above the group
  });

  it("a covered node wired to something on the RIGHT still clears right", () => {
    const b = box("b", 150, 100);
    const anchorsRight = new Map([["b", [{ x: 700, y: 125 }]]]);
    const d = runA([b], anchorsRight).get("b")!;
    expect(after(b, d)).toEqual({ x: RIGHT + PUSH_GAP, y: 100 });
  });

  it("anchors don't move boxes the expansion doesn't touch", () => {
    const b = box("b", 450, 100); // clear of the footprint
    const anchorsLeft = new Map([["b", [{ x: -200, y: 125 }]]]);
    expect(runA([b], anchorsLeft).size).toBe(0);
  });

  it("a satellite of the expanding group keeps its rail despite anchors elsewhere", () => {
    const b = box("b", 130, 100);
    const sats = new Map<string, Satellite>([["b", { side: "upstream", alignCy: 120 }]]);
    const anchorsRight = new Map([["b", [{ x: 700, y: 125 }]]]);
    const d = computeExpandPush(spec, [b], sats, anchorsRight).get("b")!;
    expect(b.x + d.dx).toBeCloseTo(spec.x - PUSH_GAP - b.w); // railed left regardless
  });
});

describe("degenerate specs", () => {
  it("no growth → no movement", () => {
    const flat: ExpandSpec = { x: 0, y: 0, preW: 100, preH: 40, postW: 100, postH: 40 };
    expect(computeExpandPush(flat, [box("a", 130, 10)], new Map()).size).toBe(0);
  });
});

describe("separateOverlaps (hard de-overlap backstop)", () => {
  const anyOverlap = (boxes: PushBox[], disp: Map<string, { dx: number; dy: number }>) => {
    const at = (b: PushBox) => { const d = disp.get(b.id); return d ? { ...b, x: b.x + d.dx, y: b.y + d.dy } : b; };
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = at(boxes[i]), b = at(boxes[j]);
      if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0 &&
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0) return true;
    }
    return false;
  };

  it("separates two fully-coincident boxes", () => {
    const boxes = [box("A", 0, 0, 500, 300), box("B", 0, 0, 500, 300)];
    expect(anyOverlap(boxes, separateOverlaps(boxes))).toBe(false);
  });

  it("clears a packed grid of oversized boxes", () => {
    const boxes = [
      box("A", 0, 0, 520, 320), box("B", 300, 0, 520, 320),
      box("C", 0, 130, 520, 320), box("D", 300, 130, 520, 320),
    ];
    expect(anyOverlap(boxes, separateOverlaps(boxes))).toBe(false);
  });

  it("only moves boxes down/right (never up/left)", () => {
    const boxes = [box("A", 0, 0, 400, 250), box("B", 12, 8, 400, 250)];
    for (const [, d] of separateOverlaps(boxes)) {
      expect(d.dx).toBeGreaterThanOrEqual(0);
      expect(d.dy).toBeGreaterThanOrEqual(0);
    }
  });

  it("leaves baseline (pre-existing) overlaps alone", () => {
    const boxes = [box("A", 0, 0, 200, 200), box("B", 50, 50, 200, 200)];
    const baseline = new Set(["A|B"]);
    expect(separateOverlaps(boxes, baseline).size).toBe(0);
  });

  it("no overlaps → no movement", () => {
    const boxes = [box("A", 0, 0, 100, 100), box("B", 200, 0, 100, 100)];
    expect(separateOverlaps(boxes).size).toBe(0);
  });
});
