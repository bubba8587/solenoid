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
const payload = (p: "r" | "p", close: number, choices: string[] = [], limits?: number[]): LadderPayload => {
  const lim: FrameValue = limits
    ? { __frame: true, columns: [{ name: "Resource", type: "string", values: ["Dollars", "Meals"] }, { name: "Limit", type: "number", values: limits }] }
    : seedFrame(p + "Limits");
  return choiceLadder(seedFrame(p + "Opts"), seedFrame(p + "Weights"), lim, "max", close, choices).payload;
};
/** Uneven card heights, as text wrapping gives them, never shorter than a card's slice needs. */
function heightsFor(p: LadderPayload): Map<string, number> {
  const need = layoutLadder(p, new Map(), metricsFor(1)).minHeight;
  const h = new Map<string, number>([["source", 40]]);
  p.edges.forEach((e, i) => h.set(`e${i}`, Math.max(need.get(`e${i}`) ?? 0, 44 + 14 * Math.min(2, e.struck.length))));
  return h;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
/** The box a straight trunk piece covers, read from its `M x y H x2 V y2` path. */
const trunkBox = (d: string): Box => {
  const [x, y, x2, y2] = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return { key: "", lane: 0, row: 0, x, y, w: x2 - x, h: y2 - y };
};

function check(p: LadderPayload, L: Layout) {
  const boxes = [...L.boxes.values()];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    expect(overlaps(boxes[i], boxes[j]), `${boxes[i].key} overlaps ${boxes[j].key}`).toBe(false);

  const sum = (pick: (x: Layout["pieces"][number]) => boolean) => L.pieces.filter(pick).reduce((t, x) => t + x.width, 0);
  for (const [key, f] of L.flows) {
    const b = L.boxes.get(key)!;
    if (key !== "source") {
      // What arrives is what this card takes plus what flows on.
      expect(sum((x) => x.kind === "link" && x.to === key), `${key}: flow in`).toBeCloseTo(f.inW, 6);
      expect(f.inW).toBeCloseTo(f.peelW + f.outW, 6);
      expect(sum((x) => x.kind === "turn" && x.from === key), `${key}: its slice`).toBeCloseTo(f.peelW, 6);
      // Every slice ends on the card's left edge, inside its height.
      for (const t of L.pieces.filter((x) => x.kind === "turn" && x.from === key)) {
        const m = t.d.match(/L(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/)!;
        expect(Number(m[1])).toBeCloseTo(b.x, 6);
        expect(Number(m[2])).toBeGreaterThanOrEqual(b.y);
        expect(Number(m[2])).toBeLessThanOrEqual(b.y + Math.max(b.h, L.minHeight.get(key) ?? 0));
      }
    }
    // What flows on leaves this card, directly or through a meeting point.
    if (f.outW > 1e-6) expect(sum((x) => x.kind === "link" && x.from === key), `${key}: flow out`).toBeCloseTo(f.outW, 6);
  }
  // A meeting point passes on everything it gathers.
  const meets = new Set(L.pieces.filter((x) => x.from.startsWith("m")).map((x) => x.from));
  for (const mk of meets) expect(sum((x) => x.to === mk)).toBeCloseTo(sum((x) => x.from === mk), 6);
  // The flow beside a card never runs under one.
  for (const t of L.pieces.filter((x) => x.kind === "trunk")) {
    const tb = trunkBox(t.d);
    for (const b of boxes) if (b.key !== "source") expect(overlaps(tb, b), `trunk of ${t.from} under ${b.key}`).toBe(false);
  }
  // The cards together take the whole band, and a path's last card takes all that reaches it.
  const served = [...L.flows].filter(([k]) => k !== "source").reduce((t, [, f]) => t + f.peelW, 0);
  expect(served).toBeCloseTo(L.flows.get("source")!.outW, 6);
  p.edges.forEach((e, i) => {
    if (!p.edges.some((x) => x.from === e.to)) expect(L.flows.get(`e${i}`)!.outW).toBeCloseTo(0, 9);
  });
}

describe("ladder layout", () => {
  const cases: [string, LadderPayload][] = [
    ["restaurants at 5%", payload("r", 0.05)],
    ["restaurants at 2%", payload("r", 0.02)],
    ["restaurants with Fennel chosen", payload("r", 0.05, ["Fennel"])],
    ["restaurants on a tight budget", payload("r", 0.05, [], [200, 4])],
    ["restaurants with nothing affordable", payload("r", 0.05, [], [10, 6])],
    ["the policy agenda", payload("p", 0.05)],
    ["the policy agenda at 10%", payload("p", 0.1)],
    ["the policy agenda with the fuel holiday chosen", payload("p", 0.05, ["Fuel tax holiday"])],
  ];
  it.each(cases)("%s: every flow starts and ends on a card and is conserved", (_n, p) => {
    check(p, layoutLadder(p, heightsFor(p), metricsFor(1)));
  });
  it("a side passed over sits right beside the pick, in a lane no card in its row uses", () => {
    const p = payload("r", 0.05, ["Fennel"]);
    const L = layoutLadder(p, heightsFor(p), metricsFor(1));
    const i = p.edges.findIndex((e) => e.kind === "passed");
    const pick = p.edges.findIndex((e) => e.kind === "chosen");
    expect(L.boxes.get(`e${i}`)!.lane).toBe(L.boxes.get(`e${pick}`)!.lane + 1);
    expect(L.flows.get(`e${i}`)).toEqual({ inW: 0, peelW: 0, outW: 0 });
  });
  it.each(cases)("%s: at every fork, the other side sits to the right of the main side's own branch", (_n, p) => {
    const L = layoutLadder(p, heightsFor(p), metricsFor(1));
    const reach = (sid: number): Set<number> => {
      const seen = new Set<number>(), stack = [sid];
      while (stack.length) {
        const s = stack.pop()!;
        p.edges.forEach((e, i) => { if (e.from === s && !seen.has(i)) { seen.add(i); stack.push(e.to); } });
      }
      return seen;
    };
    for (const st of p.states) {
      const outs = p.edges.map((e, i) => ({ e, i })).filter((x) => x.e.from === st.id && x.e.share > 0).sort((x, y) => y.e.share - x.e.share);
      if (outs.length < 2) continue;
      const theirs = reach(outs[1].e.to);
      const mine = [...reach(outs[0].e.to)].filter((i) => !theirs.has(i)).map((i) => L.boxes.get(`e${i}`)!.lane);
      expect(L.boxes.get(`e${outs[1].i}`)!.lane).toBeGreaterThan(Math.max(L.boxes.get(`e${outs[0].i}`)!.lane, ...mine));
    }
  });
});
