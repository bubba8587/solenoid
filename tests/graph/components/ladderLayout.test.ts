// [[C122]] choiceLadder
import { describe, it, expect } from "vitest";
import { layoutLadder, metricsFor, type Layout, type Box } from "../../../src/graph/components/ladderLayout";
import { choiceLadder } from "../../../src/graph/frameVerbs";
import type { FrameValue } from "../../../src/graph/frame";
import type { LadderPayload } from "../../../src/graph/chartValue";
import seed from "../../../src/graph/seedGraphs/choice-ladder.json";

const seedFrame = (id: string): FrameValue => {
  const n = seed.nodes.find((x) => x.id === id) as { init: { frameText: string } };
  return { __frame: true, columns: JSON.parse(n.init.frameText) };
};
const limitsFrame = (names: string[], vals: number[]): FrameValue => ({ __frame: true, columns: [
  { name: "Resource", type: "string", values: names }, { name: "Limit", type: "number", values: vals },
] });
function payload(p: "r" | "h", wiggle: number, limits?: number[]): LadderPayload {
  const lim = limits ? limitsFrame(p === "r" ? ["Dollars", "Meals"] : ["Dollars", "Weekends"], limits) : seedFrame(p + "Limits");
  return choiceLadder(seedFrame(p + "Opts"), seedFrame(p + "Weights"), lim, "max", wiggle).payload;
}
/** Uneven card heights, as text wrapping gives them. */
function fakeHeights(p: LadderPayload): Map<string, number> {
  const h = new Map<string, number>([["source", 48]]);
  for (const r of p.rungs) {
    h.set(`r${r.id}`, r.kind === "tossup" ? 170 : 70 + 15 * (r.struck?.length ?? 0));
    if (r.kind === "tossup") h.set(`a${r.id}`, 96);
  }
  return h;
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const bboxOf = (d: string) => {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  // Paths are absolute M/C/L/H/V; H and V carry one number, so read the pairs loosely and the singles from the commands.
  const xs: number[] = [], ys: number[] = [];
  const re = /([MCLHVZ])([^MCLHVZ]*)/g;
  let m: RegExpExecArray | null, cx = 0, cy = 0;
  while ((m = re.exec(d))) {
    const v = (m[2].match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    if (m[1] === "H") { cx = v[0]; xs.push(cx); ys.push(cy); continue; }
    if (m[1] === "V") { cy = v[0]; xs.push(cx); ys.push(cy); continue; }
    for (let i = 0; i + 1 < v.length; i += 2) { xs.push(v[i]); ys.push(v[i + 1]); cx = v[i]; cy = v[i + 1]; }
  }
  void nums;
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

function check(p: LadderPayload, L: Layout) {
  const boxes = [...L.boxes.values()];
  const R = p.resources.length;

  // Cards never overlap.
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    expect(overlaps(boxes[i], boxes[j]), `${boxes[i].key} overlaps ${boxes[j].key}`).toBe(false);

  for (const piece of L.pieces) {
    const bb = bboxOf(piece.d);
    // Bands and crosses run in gutters and gaps, never under a card; a turn ends at its own card's edge.
    if (piece.kind === "trunk" || piece.kind === "cross")
      for (const b of boxes) if (b.key !== "source") expect(overlaps(bb, b), `${piece.kind} ${piece.from}->${piece.to} band ${piece.band} under ${b.key}`).toBe(false);
    if (piece.kind === "turn") {
      const b = L.boxes.get(piece.to)!;
      expect(near(piece.x1, b.x) || near(piece.x1, b.x + b.w), `turn into ${b.key} ends on its side`).toBe(true);
      expect(piece.y1 >= b.y && piece.y1 + piece.width <= b.y + b.h, `turn into ${b.key} lands within its height`).toBe(true);
    }
    if (piece.kind === "line") {
      const a = L.boxes.get(piece.from)!, b = L.boxes.get(piece.to)!;
      expect(near(piece.y0, a.y + a.h) && near(piece.y1, b.y), `line ${a.key}->${b.key} joins bottom to top`).toBe(true);
    }
  }

  // Every card but the source is reached by a flowchart line; every card but a plan leads on.
  for (const b of boxes) {
    if (b.key === "source") continue;
    expect(L.pieces.some((x) => x.kind === "line" && x.to === b.key), `${b.key} has an edge in`).toBe(true);
    const isPlan = b.key[0] === "r" && p.rungs.find((r) => `r${r.id}` === b.key)!.kind === "plan";
    if (!isPlan) expect(L.pieces.some((x) => x.kind === "line" && x.from === b.key), `${b.key} has an edge out`).toBe(true);
  }

  // Each band conserves at each card: what flows in is what the card spends plus what flows on.
  for (const b of boxes) {
    if (b.key === "source") continue;
    for (let r = 0; r < R; r++) {
      const sum = (kind: string, pick: (x: typeof L.pieces[number]) => boolean) =>
        L.pieces.filter((x) => x.kind === kind && x.band === r && pick(x)).reduce((s, x) => s + x.width, 0);
      const into = sum("trunk", (x) => x.to === b.key) + sum("cross", (x) => x.to === b.key);
      const spent = sum("turn", (x) => x.to === b.key);
      // The dashed copy a toss-up sends to its alternative is the same money, not a share of it.
      const out = sum("trunk", (x) => x.from === b.key && !x.ghost);
      expect(into, `${b.key} band ${r}: in = spent + out`).toBeCloseTo(spent + out, 6);
    }
  }

  // A trunk ends where the next one starts, and the first leaves the source's bottom.
  for (const t of L.pieces.filter((x) => x.kind === "trunk")) {
    if (t.from === "source") { expect(t.y0).toBeCloseTo(L.boxes.get("source")!.h, 6); continue; }
    const feeder = L.pieces.find((x) => (x.kind === "trunk" || x.kind === "cross") && x.band === t.band && x !== t
      && near(x.kind === "cross" ? x.y1 : x.y1, t.y0) && (x.to === t.from || x.to === t.to));
    expect(feeder, `trunk ${t.from}->${t.to} band ${t.band} is fed from above`).toBeTruthy();
  }
}

describe("ladder layout", () => {
  const cases: [string, LadderPayload][] = [
    ["restaurants at 25%", payload("r", 0.25)],
    ["restaurants at 40%", payload("r", 0.4)],
    ["restaurants at 5%", payload("r", 0.05)],
    ["house at 25%", payload("h", 0.25)],
    ["house at 40%", payload("h", 0.4)],
    ["restaurants on a tight budget", payload("r", 0.3, [200, 4])],
    ["restaurants with nothing affordable", payload("r", 0.25, [10, 6])],
    ["house with a big budget", payload("h", 0.25, [60000, 10])],
  ];
  it.each(cases)("%s: every band starts and ends on a card, and conserves", (_n, p) => {
    for (const plan of p.rungs.filter((r) => r.kind === "plan")) check(p, layoutLadder(p, fakeHeights(p), metricsFor(1), plan.id));
  });
  it("draws the selected plan's path and nothing else as on", () => {
    const p = payload("r", 0.25);
    const other = p.rungs.find((r) => r.kind === "plan" && r.id !== p.best)!;
    const L = layoutLadder(p, fakeHeights(p), metricsFor(1), other.id);
    expect(L.boxes.get(`r${other.id}`)!.on).toBe(true);
    expect(L.boxes.get(`r${p.best}`)!.on).toBe(false);
    for (const x of L.pieces.filter((q) => q.kind === "turn")) expect(x.on).toBe(L.boxes.get(x.to)!.on);
  });
  it("without Limits, cards still connect by lines", () => {
    const p = choiceLadder(seedFrame("rOpts"), seedFrame("rWeights"), null, "max", 0.25).payload;
    const L = layoutLadder(p, fakeHeights(p), metricsFor(1), p.best);
    expect(L.pieces.every((x) => x.kind === "line")).toBe(true);
    check(p, L);
  });
});
