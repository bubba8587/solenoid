// [[C52]], [[C112]] noOverlapsEver
import { describe, it, expect } from "vitest";
import { NodeEditor } from "rete";
import { alignDeltas, distributeDeltas, expandMoveSet, DISTRIBUTE_GAP, toggleNodeCollapsed, restackOrder, reorderEditorNodes, type Placed } from "../../src/graph/selectionOps";
import { collapseStore } from "../../src/graph/collapseStore";
import { setGraphChanged } from "../../src/graph/process";
import { GroupNode, DisplayNode } from "../../src/graph/rete-nodes";
import type { Schemes } from "../../src/graph/schemes";
import { standoffStore } from "../../src/graph/standoffs";

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
  });
});

describe("expandMoveSet", () => {
  it("never carries a position-locked group; its members still move on their own", async () => {
    const editor = new NodeEditor<Schemes>();
    const m = new DisplayNode();
    await editor.addNode(m as never);
    const g = new GroupNode({ members: [m.id] });
    g.lockedPosition = true;
    await editor.addNode(g as never);
    expect([...expandMoveSet(editor, [g.id])]).toEqual([]);
    expect([...expandMoveSet(editor, [m.id])]).toEqual([m.id]);
    g.lockedPosition = false;
    expect(new Set(expandMoveSet(editor, [g.id]))).toEqual(new Set([g.id, m.id]));
  });

  it("leaves a standoff partner hidden in a collapsed group where it is", async () => {
    const editor = new NodeEditor<Schemes>();
    const loose = new DisplayNode();
    const member = new DisplayNode();
    await editor.addNode(loose as never);
    await editor.addNode(member as never);
    const tie = standoffStore.add({ nodeId: loose.id, anchor: "e" }, { nodeId: member.id, anchor: "w" }, 30, 60);
    try {
      expect(new Set(expandMoveSet(editor, [loose.id], () => false))).toEqual(new Set([loose.id, member.id]));
      expect([...expandMoveSet(editor, [loose.id], (id) => id === member.id)]).toEqual([loose.id]);
    } finally {
      standoffStore.remove(tie.id);
    }
  });
});

describe("toggleNodeCollapsed", () => {
  it("flips the collapse and reports a graph change, so it saves and records an undo step", () => {
    let changes = 0;
    setGraphChanged(() => { changes++; });
    toggleNodeCollapsed("n1");
    expect(collapseStore.get("n1")).toBe(true);
    toggleNodeCollapsed("n1");
    expect(collapseStore.get("n1")).toBe(false);
    expect(changes).toBe(2);
    setGraphChanged(() => {});
  });
});

describe("restackOrder", () => {
  const all = () => true;
  it("takes the selection past everything to the front or the back, keeping its own order", () => {
    expect(restackOrder(["a", "b", "c", "d"], new Set(["a", "c"]), "front", all)).toEqual(["b", "d", "a", "c"]);
    expect(restackOrder(["a", "b", "c", "d"], new Set(["b", "d"]), "back", all)).toEqual(["b", "d", "a", "c"]);
  });
  it("steps forward past the nearest card it overlaps, skipping ones it doesn't touch", () => {
    const touches = (x: string, y: string) => [x, y].sort().join() === "a,c";
    expect(restackOrder(["a", "b", "c", "d"], new Set(["a"]), "forward", touches)).toEqual(["b", "c", "a", "d"]);
  });
  it("steps backward past the nearest card it overlaps", () => {
    expect(restackOrder(["a", "b", "c"], new Set(["c"]), "backward", all)).toEqual(["a", "c", "b"]);
  });
  it("leaves a card with nothing overlapping in the way where it is", () => {
    expect(restackOrder(["a", "b"], new Set(["a"]), "forward", () => false)).toEqual(["a", "b"]);
    expect(restackOrder(["a", "b"], new Set(["b"]), "forward", all)).toEqual(["a", "b"]);
  });
  it("moves a selected pair as a block without one leapfrogging the other", () => {
    expect(restackOrder(["a", "b", "c"], new Set(["a", "b"]), "forward", all)).toEqual(["c", "a", "b"]);
    expect(restackOrder(["a", "b", "c"], new Set(["b", "c"]), "backward", all)).toEqual(["b", "c", "a"]);
  });
});

describe("reorderEditorNodes", () => {
  it("rewrites the order getNodes returns, the one the save and RF read", async () => {
    const editor = new NodeEditor<Schemes>();
    const a = new DisplayNode(), b = new DisplayNode(), c = new DisplayNode();
    for (const n of [a, b, c]) await editor.addNode(n);
    reorderEditorNodes(editor, [c.id, a.id, b.id]);
    expect(editor.getNodes().map((n) => n.id)).toEqual([c.id, a.id, b.id]);
  });
  it("ignores an order that doesn't name every node exactly", async () => {
    const editor = new NodeEditor<Schemes>();
    const a = new DisplayNode(), b = new DisplayNode();
    for (const n of [a, b]) await editor.addNode(n);
    reorderEditorNodes(editor, [b.id]);
    expect(editor.getNodes().map((n) => n.id)).toEqual([a.id, b.id]);
  });
});
