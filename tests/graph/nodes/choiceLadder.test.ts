// [[C122]] choiceLadder
import { describe, it, expect } from "vitest";
import { ChoiceLadderNode } from "../../../src/graph/nodes/frame";
import type { FrameValue, FrameColumn } from "../../../src/graph/frame";
import { isSolError } from "../../../src/graph/errorValue";
import { extractInit } from "../../../src/graph/copyPaste";
import type { ChartValue, LadderPayload } from "../../../src/graph/chartValue";
import seed from "../../../src/graph/seedGraphs/choice-ladder.json";

const frame = (columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });
const seedFrame = (id: string): FrameValue => {
  const n = seed.nodes.find((x) => x.id === id) as { init: { frameText: string } };
  return frame(JSON.parse(n.init.frameText));
};
const col = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)!.values;
const payloadOf = (n: ChoiceLadderNode) => (n.cachedChart as ChartValue).payload as LadderPayload;

describe("ChoiceLadderNode", () => {
  const run = (p: "r" | "h", wiggle?: number) => {
    const n = new ChoiceLadderNode();
    if (wiggle != null) n.literals.wiggle = wiggle;
    const out = n.data({ frame: [seedFrame(p + "Opts")], weights: [seedFrame(p + "Weights")], limits: [seedFrame(p + "Limits")] });
    return { n, plan: out.frame as FrameValue, chart: out.chart as ChartValue };
  };

  it("plans the restaurant trip: the expensive top pick is struck, six meals within $450", () => {
    const { plan, n } = run("r");
    expect(col(plan, "Restaurant")).toEqual(["Kato omakase", "Marrow", "Brass Oyster", "Saffron Court", "Taqueria Sol", "Ichi noodle bar"]);
    expect(col(plan, "Rung")).toEqual([1, 2, 3, 4, 5, 6]);
    expect((col(plan, "Dollars") as number[]).reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(450);
    const p = payloadOf(n);
    expect(p.rungs[0].struck?.[0]).toMatchObject({ why: "crowd" });
    expect(p.options[p.rungs[0].struck![0].option].name).toBe("Hearth & Ember");
  });

  it("marks a pick taken at a toss-up", () => {
    const { plan } = run("r");
    expect(col(plan, "Choice")).toContain("Toss-up");
    expect(new Set(col(plan, "Choice"))).toEqual(new Set(["Clear", "Toss-up"]));
  });

  it("carries the house scenario's negative weight and forks at the first rung", () => {
    const { n } = run("h");
    const p = payloadOf(n);
    expect(p.rungs[0].kind).toBe("tossup");
    expect([p.options[p.rungs[0].pick!].name, p.options[p.rungs[0].rival!].name]).toEqual(["Heat pump", "Roof patch"]);
    const best = p.rungs.find((r) => r.id === p.best)!;
    expect(best.total).toBeGreaterThan(p.rankingTotal);
  });

  it("emits a ladder chart titled by the card", () => {
    const { chart } = run("r");
    expect(chart).toMatchObject({ __chart: true, op: "ladder", title: "Choice Ladder" });
    expect((chart.payload as LadderPayload).criteria).toEqual(["Food", "Uniqueness", "Vibe", "Buzz", "Ease"]);
  });

  it("a cost column is not a criterion unless Weights names it", () => {
    const n = new ChoiceLadderNode();
    const weights = frame([...seedFrame("rWeights").columns.map((c) => ({ ...c, values: [...c.values, c.type === "string" ? "Dollars" : -1] }))]);
    n.data({ frame: [seedFrame("rOpts")], weights: [weights], limits: [seedFrame("rLimits")] });
    expect(payloadOf(n).criteria).toContain("Dollars");
  });

  it("reads Wiggle 25 as 25%, and a smaller wiggle forks less", () => {
    expect(payloadOf(run("r", 25).n).wiggle).toBe(0.25);
    const forks = (w: number) => payloadOf(run("r", w).n).rungs.filter((r) => r.kind === "tossup").length;
    expect(forks(0.05)).toBeLessThan(forks(0.25));
  });

  it("a wired blank Wiggle forks only on exact ties; unwired takes the card", () => {
    const n = new ChoiceLadderNode();
    n.data({ frame: [seedFrame("rOpts")], weights: [seedFrame("rWeights")], limits: [seedFrame("rLimits")], wiggle: [null] });
    expect(payloadOf(n).wiggle).toBe(0);
  });

  it("unwired Limits takes every option with a positive score, in rank order", () => {
    const n = new ChoiceLadderNode();
    const plan = n.data({ frame: [seedFrame("rOpts")], weights: [seedFrame("rWeights")] }).frame as FrameValue;
    expect(col(plan, "Restaurant")).toHaveLength(12);
    expect(col(plan, "Restaurant")[0]).toBe("Hearth & Ember");
  });

  it("a Limits row naming no Options column is #VALUE!", () => {
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [seedFrame("rOpts")], limits: [frame([
      { name: "Resource", type: "string", values: ["Hours"] }, { name: "Limit", type: "number", values: [10] },
    ])] });
    expect(isSolError(out.frame)).toBe(true);
    expect(isSolError(out.chart)).toBe(true);
    expect((out.frame as { message?: string }).message).toMatch(/Hours/);
  });

  it("a limit that isn't a number is #VALUE!", () => {
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [seedFrame("rOpts")], limits: [frame([
      { name: "Resource", type: "string", values: ["Dollars"] }, { name: "Limit", type: "number", values: [null] },
    ])] });
    expect(isSolError(out.frame)).toBe(true);
  });

  it("no Options gives no plan and no figure", () => {
    const n = new ChoiceLadderNode();
    expect(n.data({})).toEqual({ frame: null, chart: null });
    expect(n.cachedChart).toBeNull();
  });

  it("round-trips its settings", () => {
    const n = new ChoiceLadderNode({ label: "Trip", normalize: "rank" });
    const init = extractInit(n) as { label: string; normalize: string };
    expect(init).toMatchObject({ label: "Trip", normalize: "rank" });
    const back = new ChoiceLadderNode(init as never);
    expect(back.normalize).toBe("rank");
  });
});
