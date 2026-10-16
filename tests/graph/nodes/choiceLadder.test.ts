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
  it("plans the restaurant trip within $450 and six meals with two vegetarian, the expensive top pick struck", () => {
    const { plan, n } = run("r");
    expect(col(plan, "Restaurant")).toEqual(["Kato omakase", "Marrow", "Saffron Court", "Lune bistro", "Taqueria Sol", "Bao House"]);
    expect((col(plan, "Dollars") as number[]).reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(450);
    expect(col(plan, "Vegetarian so far").at(-1)).toBe(2);
    expect(col(plan, "Dollars so far").at(-1)).toBe(438);
    const p = payloadOf(n);
    expect(p.edges[p.main[0]].struck.map((i) => p.options[i].name)).toContain("Hearth & Ember");
  });

  it("orders the policy agenda by value for capital, with no total: the promise, then the earner, a prerequisite pulled in", () => {
    const { plan, n } = run("p");
    const names = col(plan, "Policy") as string[];
    expect(names.slice(0, 2)).toEqual(["Child tax credit", "Small business relief"]);
    expect(names).not.toContain("Oversight board");
    expect(payloadOf(n).ruledOut).toEqual(["Oversight board"]);
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
    expect(payloadOf(run("r").n).resources.map((r) => [r.limit, r.floor])).toEqual([[450, null], [6, null], [null, 2]]);
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

describe("Choice Ladder deal-breakers, Must and Never ([[C124]] dealBreakers)", () => {
  const policies = frame(seedFrame("pOpts").columns.filter((c) => c.name !== "Must" && c.name !== "Never"));
  const names = col(policies, "Policy") as string[];
  const flag = (name: string, on: string[]): FrameColumn => ({ name, type: "logical", values: names.map((n) => on.includes(n)) });
  const withCols = (...cs: FrameColumn[]) => frame([...policies.columns, ...cs]);
  const runWith = (opts: FrameValue, weights = seedFrame("pWeights"), limits = seedFrame("pLimits")) => {
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [opts], weights: [weights], limits: [limits] });
    return { n, plan: out.frame as FrameValue };
  };

  it("takes a Must first, before the earner, and marks it", () => {
    const { plan } = runWith(withCols(flag("Must", ["Oversight board"])));
    expect(col(plan, "Policy")[0]).toBe("Oversight board");
    expect(col(plan, "Choice")[0]).toBe("Must");
  });

  it("a Must brings in what it needs first", () => {
    const { plan } = runWith(withCols(flag("Must", ["Transit expansion"])));
    expect((col(plan, "Policy") as string[]).slice(0, 2)).toEqual(["Zoning reform", "Transit expansion"]);
    expect((col(plan, "Choice") as string[]).slice(0, 2)).toEqual(["Needed", "Must"]);
  });

  it("a Never is never taken, and whatever needs it goes too; both are listed on the figure", () => {
    const { plan, n } = runWith(withCols(flag("Never", ["Zoning reform"])));
    const taken = col(plan, "Policy") as string[];
    expect(taken).not.toContain("Zoning reform");
    expect(taken).not.toContain("Transit expansion");
    expect(payloadOf(n).ruledOut).toEqual(["Transit expansion", "Zoning reform"]);
  });

  it("Must and Never are neither criteria nor costs", () => {
    const { n } = runWith(withCols(flag("Must", []), flag("Never", [])));
    expect(payloadOf(n).criteria).toEqual(["Impact", "Urgency", "Support", "Equity", "Feasibility"]);
  });

  it("a deal-breaker in the Weights rules an option out of the ladder", () => {
    const w = seedFrame("pWeights");
    const crit = col(w, w.columns[0].name) as string[];
    const weights = frame([...w.columns, { name: "At least", type: "number", values: crit.map((c) => (c === "Support" ? 6 : null)) }]);
    const support = col(policies, "Support") as number[];
    const low = names.filter((_, i) => support[i] < 6);
    expect(low.length).toBeGreaterThan(0);
    const { plan, n } = runWith(policies, weights);
    for (const name of low) expect(col(plan, "Policy")).not.toContain(name);
    expect(payloadOf(n).ruledOut).toEqual(expect.arrayContaining(low));
  });

  it("Musts that exclude each other are #VALUE! naming both", () => {
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [withCols(flag("Must", ["Fuel levy", "Fuel tax holiday"]))], weights: [seedFrame("pWeights")], limits: [seedFrame("pLimits")] });
    expect(isSolError(out.frame)).toBe(true);
    expect((out.frame as unknown as { message: string }).message).toMatch(/Fuel levy and Fuel tax holiday exclude each other/);
  });

  it("Musts that need more than a countable limit are #VALUE!", () => {
    const r = seedFrame("rOpts");
    const rn = col(r, "Restaurant") as string[];
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [frame([...r.columns, { name: "Must", type: "logical", values: rn.map((x) => ["Hearth & Ember", "Kato omakase", "Fennel"].includes(x)) }])], weights: [seedFrame("rWeights")], limits: [seedFrame("rLimits")] });
    expect(isSolError(out.frame)).toBe(true);
    expect((out.frame as unknown as { message: string }).message).toMatch(/Dollars/);
  });
});

describe("Choice Ladder floors (At least)", () => {
  it("a side whose floor needs filling takes an option for it, marked Needed", () => {
    const p = payloadOf(run("r").n);
    const quota = p.edges.filter((e) => e.kind === "quota");
    expect(quota.map((e) => p.options[e.pick].name)).toEqual(["Bao House"]);
  });

  it("every path meets the floor", () => {
    const p = payloadOf(run("r").n);
    const veg = new Set(["Saffron Court", "Bao House", "Fennel"]);
    for (const s of p.states.filter((x) => x.end && x.share > 0)) expect(s.taken.filter((i) => veg.has(p.options[i].name)).length).toBeGreaterThanOrEqual(2);
  });

  it("a floor the options can't reach is #VALUE! naming it", () => {
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [seedFrame("rOpts")], weights: [seedFrame("rWeights")], limits: [frame([
      { name: "Resource", type: "string", values: ["Vegetarian"] }, { name: "At least", type: "number", values: [4] },
    ])] });
    expect((out.frame as unknown as { message: string }).message).toMatch(/Vegetarian's At least/);
  });

  it("a floor that fits no plan within the caps is #VALUE!", () => {
    const n = new ChoiceLadderNode();
    const out = n.data({ frame: [seedFrame("rOpts")], weights: [seedFrame("rWeights")], limits: [frame([
      { name: "Resource", type: "string", values: ["Dollars", "Vegetarian"] },
      { name: "At most", type: "number", values: [100, null] }, { name: "At least", type: "number", values: [null, 3] },
    ])] });
    expect((out.frame as unknown as { message: string }).message).toMatch(/no plan meets every At least/);
  });

  it("a table without At most or At least reads its first number column as the cap", () => {
    const n = new ChoiceLadderNode();
    n.data({ frame: [seedFrame("rOpts")], weights: [seedFrame("rWeights")], limits: [frame([
      { name: "Resource", type: "string", values: ["Dollars"] }, { name: "Budget", type: "number", values: [200] },
    ])] });
    expect(payloadOf(n).resources).toEqual([expect.objectContaining({ limit: 200, floor: null })]);
  });
});
