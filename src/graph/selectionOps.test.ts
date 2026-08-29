import { describe, it, expect } from "vitest";
import { alignDeltas, distributeDeltas, DISTRIBUTE_GAP, type Placed } from "./selectionOps";

const box = (id: string, x: number, y: number, w: number, h: number): Placed =>
  ({ id, box: { x, y, w, h } });

describe("alignDeltas", () => {
  it("aligns left edges to the selection's leftmost edge", () => {
    const items = [box("a", 10, 0, 100, 50), box("b", 40, 0, 60, 50)];
    const moves = alignDeltas(items, "left");
    // both snap to xMin = 10; a already there, b moves -30
    expect(moves.find((m) => m.seedId === "a")!.dx).toBe(0);
    expect(moves.find((m) => m.seedId === "b")!.dx).toBe(-30);
    expect(moves.every((m) => m.dy === 0)).toBe(true);
  });

  it("aligns right edges (accounts for differing widths)", () => {
    const items = [box("a", 0, 0, 100, 50), box("b", 0, 0, 60, 50)];
    // xMax = 100; right-align => x = 100 - w. a: 0 (no move), b: 40
    const moves = alignDeltas(items, "right");
    expect(moves.find((m) => m.seedId === "a")!.dx).toBe(0);
    expect(moves.find((m) => m.seedId === "b")!.dx).toBe(40);
  });

  it("center-v centers each box on the selection's vertical midline", () => {
    const items = [box("a", 0, 0, 40, 20), box("b", 0, 100, 40, 80)];
    // yMin=0, yMax=180, mid=90. a -> 90-10=80 (dy 80); b -> 90-40=50 (dy -50)
    const moves = alignDeltas(items, "center-v");
    expect(moves.find((m) => m.seedId === "a")!.dy).toBe(80);
    expect(moves.find((m) => m.seedId === "b")!.dy).toBe(-50);
  });

  it("aligns top edges to the selection's topmost edge", () => {
    const items = [box("a", 0, 5, 100, 50), box("b", 0, 45, 60, 50)];
    const moves = alignDeltas(items, "top");
    expect(moves.find((m) => m.seedId === "a")!.dy).toBe(0);
    expect(moves.find((m) => m.seedId === "b")!.dy).toBe(-40);
    expect(moves.every((m) => m.dx === 0)).toBe(true);
  });

  it("center-h shares one horizontal center line (x-centers equal)", () => {
    const items = [box("a", 0, 0, 40, 20), box("b", 100, 0, 80, 20)];
    // xMin=0, xMax=180, mid=90. a -> 90-20=70 (dx 70); b -> 90-40=50 (dx -50)
    const moves = alignDeltas(items, "center-h");
    expect(moves.find((m) => m.seedId === "a")!.dx).toBe(70);
    expect(moves.find((m) => m.seedId === "b")!.dx).toBe(-50);
  });
});

describe("distributeDeltas (equal gaps, first/last fixed)", () => {
  it("returns nothing for fewer than 3 boxes", () => {
    expect(distributeDeltas([box("a", 0, 0, 10, 10), box("b", 100, 0, 10, 10)], "h")).toEqual([]);
  });

  it("spaces gaps evenly for equal-size boxes", () => {
    // three 20-wide boxes; first at x=0, last at x=200 (end 220). total size 60.
    // gap = (220 - 0 - 60) / 2 = 80. middle box start = 0 + 20 + 80 = 100.
    const items = [box("a", 0, 0, 20, 20), box("b", 55, 0, 20, 20), box("c", 200, 0, 20, 20)];
    const moves = distributeDeltas(items, "h");
    expect(moves).toHaveLength(1);
    expect(moves[0].seedId).toBe("b");
    expect(moves[0].dx).toBe(100 - 55); // 45
  });

  it("distributes GAPS not centers, so unequal sizes never overlap", () => {
    // a: [0,20) w20, big b w120 somewhere, c: [400,420) w20.
    // total size = 160; span 0..420 => gap = (420-160)/2 = 130.
    // b start = 0 + 20 + 130 = 150; b occupies [150,270); c starts at 270+130=400. ok, no overlap.
    const items = [box("a", 0, 0, 20, 20), box("b", 30, 0, 120, 20), box("c", 400, 0, 20, 20)];
    const moves = distributeDeltas(items, "h");
    const b = moves.find((m) => m.seedId === "b")!;
    expect(b.dx).toBe(150 - 30); // target start 150
    // verify no overlap: b end (270) < c start (400)
    const bStart = 30 + b.dx;
    expect(bStart + 120).toBeLessThan(400);
  });

  it("keeps the first and last (by leading edge) fixed", () => {
    const items = [box("a", 0, 0, 20, 20), box("b", 90, 0, 20, 20), box("c", 300, 0, 20, 20)];
    const moves = distributeDeltas(items, "h");
    // only the middle node moves
    expect(moves.map((m) => m.seedId)).toEqual(["b"]);
  });

  it("works on the vertical axis (dy only)", () => {
    const items = [box("a", 0, 0, 10, 30), box("b", 0, 50, 10, 30), box("c", 0, 300, 10, 30)];
    const moves = distributeDeltas(items, "v");
    expect(moves[0].dx).toBe(0);
    // total h 90, span 0..330 => gap (330-90)/2 = 120; b start = 0+30+120 = 150
    expect(moves[0].dy).toBe(150 - 50);
  });

  it("EXPANDS a stacked run so every node clears with DISTRIBUTE_GAP (rightmost moves)", () => {
    // 4 overlapping 20-wide boxes near x=0: span 35, way under required.
    const items = [box("a", 0, 0, 20, 20), box("b", 5, 0, 20, 20), box("c", 10, 0, 20, 20), box("d", 15, 0, 20, 20)];
    const g = DISTRIBUTE_GAP;
    const moves = distributeDeltas(items, "h");
    // a fixed; b/c/d pushed to uniform gaps → the LAST node moves (unlike the fit case)
    const at = (id: string) => moves.find((m) => m.seedId === id);
    expect(at("a")).toBeUndefined(); // leftmost anchored, no move emitted
    expect(at("b")!.dx).toBe(0 + 20 + g - 5);      // start 60 - 5
    expect(at("c")!.dx).toBe(0 + 20 + g + 20 + g - 10); // start 120 - 10
    expect(at("d")!.dx).toBe(3 * (20 + g) - 15);   // start 180 - 15
    // resulting edges never overlap
    const startsAt = (id: string, orig: number) => orig + (at(id)?.dx ?? 0);
    expect(startsAt("a", 0) + 20).toBeLessThanOrEqual(startsAt("b", 5));
    expect(startsAt("b", 5) + 20).toBeLessThanOrEqual(startsAt("c", 10));
    expect(startsAt("c", 10) + 20).toBeLessThanOrEqual(startsAt("d", 15));
  });

  it("leaves both ends fixed when the span already fits (gap >= DISTRIBUTE_GAP)", () => {
    // wide span, 3 small boxes → fits comfortably, only the middle moves
    const items = [box("a", 0, 0, 20, 20), box("b", 90, 0, 20, 20), box("c", 300, 0, 20, 20)];
    const moves = distributeDeltas(items, "h");
    expect(moves.map((m) => m.seedId)).toEqual(["b"]); // ends untouched
  });
});
