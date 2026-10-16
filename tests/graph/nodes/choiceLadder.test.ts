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
const run = (p: "r" | "p", init?: ConstructorParameters<typeof ChoiceLadderNode>[0], close?: number) => {
  const n = new ChoiceLadderNode(init);
  if (close != null) n.literals.close = close;
  const out = n.data({ frame: [seedFrame(p + "Opts")], weights: [seedFrame(p + "Weights")], limits: [seedFrame(p + "Limits")] });
  return { n, plan: out.frame as FrameValue, chart: out.chart as ChartValue };
};

describe("ChoiceLadderNode", () => {
  it("plans the restaurant trip within $450 and six meals, the expensive top pick struck", () => {
    const { plan, n } = run("r");
    expect(col(plan, "Restaurant")).toEqual(["Kato omakase", "Marrow", "Brass Oyster", "Saffron Court", "Taqueria Sol", "Ichi noodle bar"]);
    expect((col(plan, "Dollars") as number[]).reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(450);
    const p = payloadOf(n);
    expect(p.edges[p.main[0]].struck.map((i) => p.options[i].name)).toContain("Hearth & Ember");
  });

  it("orders the policy agenda by value for capital, with no total: the earner first, a prerequisite pulled in", () => {
    const { plan } = run("p");
    const names = col(plan, "Policy") as string[];
    expect(names[0]).toBe("Small business relief");
    expect(names.indexOf("Zoning reform")).toBe(names.indexOf("Transit expansion") - 1);
    expect(col(plan, "Choice")[names.indexOf("Zoning reform")]).toBe("Needed");
  });

  it("forks the excluded fuel pair and never takes both", () => {
    const { n, plan } = run("p");
    const p = payloadOf(n);
    const fuel = p.edges.filter((e) => ["Fuel levy", "Fuel tax holiday"].includes(p.options[e.pick].name));
    expect(fuel.map((e) => e.kind)).toEqual(["close", "close"]);
    expect(fuel[0].from).toBe(fuel[1].from);
    expect(fuel[0].to).toBe(fuel[1].to); // the futures match, so the paths merge
    const names = col(plan, "Policy") as string[];
    expect(names.includes("Fuel levy") && names.includes("Fuel tax holiday")).toBe(false);
  });

  it("the Requires and Excludes columns are neither criteria nor the label", () => {
    const p = payloadOf(run("p").n);
    expect(p.criteria).toEqual(["Impact", "Urgency", "Support", "Equity", "Feasibility"]);
    expect(p.options.map((o) => o.name)).toContain("Transit expansion");
  });

  it("a blank limit is a rough cost; a number is countable", () => {
    expect(payloadOf(run("p").n).resources).toEqual([expect.objectContaining({ name: "Capital", limit: null })]);
    expect(payloadOf(run("r").n).resources.map((r) => r.limit)).toEqual([450, 6]);
  });

  it("takes a saved choice at its fork, and the plan follows", () => {
    const { plan, n } = run("r", { choices: ["fennel"] });
    expect(col(plan, "Restaurant")[0]).toBe("Fennel");
    expect(col(plan, "Choice")[0]).toBe("Your pick");
    expect(payloadOf(n).choices).toEqual(["fennel"]);
  });

  it("reads Close 5 as 5%, and a smaller gap forks less", () => {
    const forks = (c: number) => payloadOf(run("r", undefined, c).n).edges.filter((e) => e.kind === "close").length;
    expect(forks(5)).toBe(forks(0.05));
    expect(forks(0.01)).toBeLessThan(forks(0.05));
  });

  it("emits a ladder chart titled by the card", () => {
    expect(run("r").chart).toMatchObject({ __chart: true, op: "ladder", title: "Choice Ladder" });
  });

  it("a Limits row naming no Options column is #VALUE!", () => {
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [seedFrame("rOpts")], limits: [frame([
      { name: "Resource", type: "string", values: ["Hours"] }, { name: "Limit", type: "number", values: [10] },
    ])] });
    expect(isSolError(out.frame)).toBe(true);
    expect(isSolError(out.chart)).toBe(true);
  });

  it("no Options gives no plan and no figure", () => {
    expect(new ChoiceLadderNode().data({})).toEqual({ frame: null, chart: null });
  });

  it("round-trips its settings and choices, and a copy doesn't share them", () => {
    const n = new ChoiceLadderNode({ label: "Trip", normalize: "rank", choices: ["Lune bistro"] });
    const init = extractInit(n) as { label: string; normalize: string; choices: string[] };
    expect(init).toMatchObject({ label: "Trip", normalize: "rank", choices: ["Lune bistro"] });
    const back = new ChoiceLadderNode(init as never);
    back.choices.push("Marrow");
    expect(n.choices).toEqual(["Lune bistro"]);
  });

  it("a saved choices field that isn't a list of names loads as none", () => {
    expect(new ChoiceLadderNode({ choices: "Lune" as never }).choices).toEqual([]);
    expect(new ChoiceLadderNode({ choices: ["Lune", 3 as never] }).choices).toEqual(["Lune"]);
  });
});
