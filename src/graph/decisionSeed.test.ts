import { describe, it, expect } from "vitest";
import seed from "./seedGraphs/decision-matrix.json";
import { decisionMatrix, decisionCriteria, decisionSensitivity } from "./frameVerbs";
import { isCubeValue, type FrameValue, type FrameColumn } from "./frame";
import type { DecisionNormalize } from "./frameVerbs";
import { parseNoteFrontmatter } from "./noteFrontmatter";
import { extractInlineRefs } from "./noteInlineRefs";
import { joinFrames } from "./frameVerbs";

// Runtime check for the Decision Matrix seed: the notes state concrete outcomes
// (who wins, where the winner flips, the dead tie), so run the seed's own data
// through the verbs and hold the prose to them. Fails when data, weights, or
// engine semantics drift apart.

type SeedNode = {
  id: string;
  init?: Record<string, unknown>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
};
type SeedConn = { source: string; sourceOutput: string; target: string; targetInput: string };
const nodes = (seed as { nodes: SeedNode[] }).nodes;
const connections = (seed as unknown as { connections: SeedConn[] }).connections;
const byId = (id: string): SeedNode => nodes.find((n) => n.id === id)!;

const frameOf = (id: string): FrameValue => ({
  __frame: true,
  columns: JSON.parse(byId(id).init!.frameText as string) as FrameColumn[],
});

// The graph assembles the Scores frame the keyed way: the Note's two frontmatter
// lists become a (Laptop, Screen) frame, left-joined onto the score table by
// laptop name — row order in either table cannot misalign a score.
const noteFields = parseNoteFrontmatter(byId("noteScreen").init!.body as string).fields;
const laptopField = noteFields.find((f) => f.key === "laptop")!;
const screenField = noteFields.find((f) => f.key === "screen")!;
const screenFrame: FrameValue = {
  __frame: true,
  columns: [
    { name: byId("screenframe").stringLiterals!.name0, type: "string", values: laptopField.value as string[] },
    { name: byId("screenframe").stringLiterals!.name1, type: "number", values: screenField.value as number[] },
  ],
};
const joinLits = byId("join").stringLiterals!;
const scores: FrameValue = joinFrames(frameOf("scores"), screenFrame, {
  leftKey: joinLits.leftKey, rightKey: joinLits.rightKey,
  how: byId("join").init!.how as "left",
});
const scenarios = frameOf("scenarios");
const dmInit = byId("dm").init as {
  normalize: DecisionNormalize;
  weightMap: Record<string, number>;
  normMap: Record<string, DecisionNormalize>;
};
const weights = decisionCriteria(scores).map((name) => dmInit.weightMap[name] ?? 1);

describe("decision-matrix seed", () => {
  it("the Note's lists are keyed: every laptop in the score table gets a screen score", () => {
    expect(laptopField.guessed).toBe("strlist");
    expect(screenField.guessed).toBe("list");
    expect((screenField.value as number[]).length).toBe((laptopField.value as string[]).length);
    for (const v of screenField.value as number[]) expect(typeof v).toBe("number");
    // set equality with the score table's key column — the join must match every row
    const tableNames = [...(frameOf("scores").columns[0].values as string[])].sort();
    expect([...(laptopField.value as string[])].sort()).toEqual(tableNames);
    // and the joined frame carries a complete numeric Screen column
    const screenCol = scores.columns.find((c) => c.name === "Screen")!;
    for (const v of screenCol.values) expect(typeof v).toBe("number");
  });

  it("every =ref in the report body is wired, and the winner INDEX reads row 1 col 1", () => {
    const refs = extractInlineRefs(byId("report").init!.body as string);
    expect(refs.length).toBeGreaterThan(0);
    const wired = connections.filter((c) => c.target === "report").map((c) => c.targetInput);
    expect([...refs].sort()).toEqual([...wired].sort());
    expect(byId("winner").literals).toEqual({ index: 1, column: 1 });
    // the ranking is best-first, so [1,1] IS the winner's name
    const conn = connections.find((c) => c.target === "winner")!;
    expect(conn.source).toBe("dm");
  });

  it("the weightMap and normMap name real criteria, and every scenario column does too", () => {
    const criteria = decisionCriteria(scores);
    expect(Object.keys(dmInit.weightMap).sort()).toEqual([...criteria].sort());
    for (const name of Object.keys(dmInit.normMap)) expect(criteria).toContain(name);
    for (const c of scenarios.columns) {
      if (c.type === "number") expect(criteria).toContain(c.name);
    }
  });

  it("main matrix: UltraSlim wins, and the breakdown contributions sum to the Score", () => {
    const out = decisionMatrix(scores, weights, dmInit.normalize, true, dmInit.normMap);
    expect(out.columns[0].values).toEqual(["UltraSlim", "ProBook", "Budget", "PowerLifter"]);
    const score = out.columns.find((c) => c.name === "Score")!.values as number[];
    const crit = decisionCriteria(scores).map((n) => out.columns.find((c) => c.name === n)!.values as number[]);
    score.forEach((s, i) => {
      const sum = crit.reduce((a, colVals) => a + colVals[i], 0);
      expect(sum).toBeCloseTo(s, 3);
    });
  });

  it("the chart feed keeps the option labels: Select Columns names exist in the ranking", () => {
    const keep = byId("select").stringLiterals!.columns.split(",");
    const out = decisionMatrix(scores, weights, dmInit.normalize, true, dmInit.normMap);
    const names = out.columns.map((c) => c.name);
    for (const k of keep) expect(names).toContain(k);
    expect(keep[0]).toBe(out.columns[0].name); // labels first, values second
  });

  it("sensitivity: the winner flips across scenarios and Budget lands the tie the note claims", () => {
    const sensInit = byId("sens").init as { normalize: DecisionNormalize };
    const cube = decisionSensitivity(scores, scenarios, sensInit.normalize);
    if (!isCubeValue(cube)) throw new Error("expected a cube");
    expect(cube.columns[1].cells).toEqual(["UltraSlim", "PowerLifter", "UltraSlim = Budget"]);
    const margins = cube.columns[2].cells as number[];
    expect(margins[0]).toBeGreaterThan(0);
    expect(margins[1]).toBeGreaterThan(0);
    expect(margins[2]).toBe(0);
    // the prose states exactly these outcomes — keep the note and the engine agreeing
    const body = byId("noteSens").init!.body as string;
    expect(body).toContain("UltraSlim = Budget");
    expect(body).toContain("PowerLifter");
  });
});
