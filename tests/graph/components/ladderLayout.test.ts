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
function payload(p: "r" | "h", wiggle: number, limits?: number[], choices: string[] = []): LadderPayload {
  const lim = limits ? limitsFrame(p === "r" ? ["Dollars", "Meals"] : ["Dollars", "Weekends"], limits) : seedFrame(p + "Limits");
  return choiceLadder(seedFrame(p + "Opts"), seedFrame(p + "Weights"), lim, "max", wiggle, choices).payload;
}
/** Uneven card heights, as text wrapping gives them. */
function fakeHeights(p: LadderPayload): Map<string, number> {
  const h = new Map<string, number>([["source", 48]]);
  p.rungs.forEach((r, k) => h.set(`r${k}`, r.alt ? 170 : 70 + 15 * (r.struck?.length ?? 0)));
  return h;
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: Box) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function check(p: LadderPayload, L: Layout) {
  const boxes = [...L.boxes.values()];
  const R = p.resources.length;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    expect(overlaps(boxes[i], boxes[j]), `${boxes[i].key} overlaps ${boxes[j].key}`).toBe(false);

  for (const x of L.pieces) {
    if (x.kind === "trunk") {
      // A trunk is a plain rectangle beside the cards, never under one but the source it leaves.
      const rect = { x: x.x0, y: x.y0, w: x.width, h: x.y1 - x.y0 };
      for (const b of boxes) if (b.key !== "source") expect(overlaps(rect, b), `band ${x.band} ${x.from}->${x.to} under ${b.key}`).toBe(false);
    }
    if (x.kind === "turn") {
      const b = L.boxes.get(x.to)!;
      expect(near(x.x1, b.x) || near(x.x1, b.x + b.w), `turn into ${b.key} ends on its side`).toBe(true);
      expect(x.y1 >= b.y && x.y1 + x.width <= b.y + b.h, `turn into ${b.key} lands within its height`).toBe(true);
    }
    if (x.kind === "line") {
      const a = L.boxes.get(x.from)!, b = L.boxes.get(x.to)!;
      expect(near(x.y0, a.y + a.h) && near(x.y1, b.y), `line ${a.key}->${b.key} joins bottom to top`).toBe(true);
    }
  }

  p.rungs.forEach((rung, k) => {
    const key = `r${k}`, prev = k === 0 ? "source" : `r${k - 1}`;
    expect(L.pieces.some((x) => x.kind === "line" && x.from === prev && x.to === key), `${key} has an edge in`).toBe(true);
    for (let r = 0; r < R; r++) {
      const sum = (kind: string, pick: (x: typeof L.pieces[number]) => boolean) =>
        L.pieces.filter((x) => x.kind === kind && x.band === r && pick(x)).reduce((s, x) => s + x.width, 0);
      const into = sum("trunk", (x) => x.to === key), spent = sum("turn", (x) => x.to === key), out = sum("trunk", (x) => x.from === key);
      // Each band conserves at each card: what flows in is what the card spends plus what flows on.
      expect(into, `${key} band ${r}: in = spent + out`).toBeCloseTo(spent + out, 6);
      // The flow in is exactly what was left before this rung.
      expect(into).toBeCloseTo(Math.min(1, Math.max(0, rung.left[r] / p.resources[r].limit)) * metricsFor(1).band, 6);
    }
  });
  // A plan card takes whatever is left, so nothing flows past it.
  expect(L.pieces.some((x) => x.kind === "trunk" && x.from === `r${p.rungs.length - 1}`)).toBe(false);
  // Trunks join end to end: each starts where the one above it ended.
  for (const t of L.pieces.filter((x) => x.kind === "trunk")) {
    if (t.from === "source") { expect(t.y0).toBeCloseTo(L.boxes.get("source")!.h, 6); continue; }
    const feeder = L.pieces.find((x) => x.kind === "trunk" && x.band === t.band && x.to === t.from);
    expect(feeder && near(feeder.y1, t.y0), `band ${t.band} into ${t.to} continues the one above`).toBe(true);
  }
}

describe("ladder layout", () => {
  const cases: [string, LadderPayload][] = [
    ["restaurants at 25%", payload("r", 0.25)],
    ["restaurants at 40%", payload("r", 0.4)],
    ["restaurants with Lune bistro chosen", payload("r", 0.25, undefined, ["Lune bistro"])],
    ["house at 25%", payload("h", 0.25)],
    ["house with Roof patch chosen", payload("h", 0.25, undefined, ["Roof patch"])],
    ["restaurants on a tight budget", payload("r", 0.3, [200, 4])],
    ["restaurants with nothing affordable", payload("r", 0.25, [10, 6])],
    ["house with a big budget", payload("h", 0.25, [60000, 10])],
  ];
  it.each(cases)("%s: every band starts and ends on a card, and conserves", (_n, p) => {
    check(p, layoutLadder(p, fakeHeights(p), metricsFor(1)));
  });
  it("without Limits, cards still connect by lines", () => {
    const p = choiceLadder(seedFrame("rOpts"), seedFrame("rWeights"), null, "max", 0.25).payload;
    const L = layoutLadder(p, fakeHeights(p), metricsFor(1));
    expect(L.pieces.every((x) => x.kind === "line")).toBe(true);
    check(p, L);
  });
});
