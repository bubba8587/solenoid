// The strict validating reader (graphValidate.ts): every silently-repaired
// load condition must surface as a repair-grade issue, and — just as load-
// bearing — nothing a real save contains may false-positive. The seed sweep at
// the bottom is that guard: every shipped seed, validated both as JSON and
// through its text form, must come back clean.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateGraph, validateText, formatIssues, hardIssues } from "../../src/graph/graphValidate";
import { writeTextForm } from "../../src/graph/textForm";
import type { SavedGraph } from "../../src/graph/persistence";

const CLEAN = `Price: NumberInputNode label="Price" value=25
Qty: NumberInputNode label="Qty" value=4
Total: ArithmeticNode op="mul" a<-Price.value b<-Qty.value
Show: DisplayNode in<-Total.result
---
{ "v": 2, "positions": { "Price": { "x": 0, "y": 0 } } }
`;

describe("validateText — clean input", () => {
  it("reports nothing on a well-formed graph", () => {
    const { issues, graph } = validateText(CLEAN);
    expect(issues).toEqual([]);
    expect(graph?.nodes).toHaveLength(4);
    expect(graph?.connections).toHaveLength(3);
  });
});

describe("validateText — grammar", () => {
  it("flags a missing separator", () => {
    const { issues } = validateText(`A: NumberInputNode value=1\n`);
    expect(issues.some((i) => i.message.includes('"---"'))).toBe(true);
  });

  it("flags every malformed line, not just the first", () => {
    const { issues } = validateText(`A NumberInputNode value=1\nB NumberInputNode value=2\n---\n{}`);
    expect(issues.filter((i) => i.message.includes("malformed node line"))).toHaveLength(2);
    expect(issues[0].line).toBe(1);
    expect(issues[1].line).toBe(2);
  });

  it("flags a duplicate name with the first line's number", () => {
    const { issues } = validateText(`A: NumberInputNode value=1\nA: NumberInputNode value=2\n---\n{}`);
    const dup = issues.find((i) => i.message.includes("duplicate node name"));
    expect(dup?.line).toBe(2);
    expect(dup?.message).toContain("line 1");
  });

  it("flags a malformed sidecar and still validates the node lines", () => {
    const { issues } = validateText(`A: NumberInputNod value=1\n---\n{not json`);
    expect(issues.some((i) => i.message.includes("sidecar is not valid JSON"))).toBe(true);
    expect(issues.some((i) => i.message.includes('unknown node type "NumberInputNod"'))).toBe(true);
  });
});

describe("validateGraph — semantics", () => {
  it("suggests the nearest class for an unknown type", () => {
    const { issues } = validateText(`A: NumberInputNod value=1\n---\n{}`);
    const issue = issues.find((i) => i.message.includes("unknown node type"));
    expect(issue?.message).toContain("`NumberInputNode`");
    expect(issue?.line).toBe(1);
  });

  it("suggests the nearest key for an unknown init field", () => {
    const { issues } = validateText(`A: NumberInputNode valu=1\n---\n{}`);
    const issue = issues.find((i) => i.message.includes('unknown init field "valu"'));
    expect(issue?.message).toContain("`value`");
  });

  it("suggests the nearest input key and lists the real ones", () => {
    const { issues } = validateText(`A: NumberInputNode value=1\nB: DisplayNode inn<-A.value\n---\n{}`);
    const issue = issues.find((i) => i.message.includes('no input "inn"'));
    expect(issue?.message).toContain("`in`");
    expect(issue?.node).toBe("B");
  });

  it("suggests the nearest output key on the source", () => {
    const { issues } = validateText(`A: NumberInputNode value=1\nB: DisplayNode in<-A.val\n---\n{}`);
    const issue = issues.find((i) => i.message.includes('has no output "val"'));
    expect(issue?.message).toContain("`value`");
  });

  it("flags a connection from an unknown node with a name suggestion", () => {
    const { issues } = validateText(`Num_1: NumberInputNode value=1\nB: DisplayNode in<-Num_2.value\n---\n{}`);
    const issue = issues.find((i) => i.message.includes('unknown node "Num_2"'));
    expect(issue?.message).toContain("`Num_1`");
  });

  it("flags a cable the live editor would refuse (family cross → Cast)", () => {
    const { issues } = validateText(`A: NumberInputNode value=1\nB: TextLenNode text<-A.value\n---\n{}`);
    const issue = issues.find((i) => i.message.includes("can't feed"));
    expect(issue?.message).toContain("Cast");
  });

  it("flags an inline literal on a class that declares no map", () => {
    const { issues } = validateText(`A: NumberInputNode value=1 lit:x=5\n---\n{}`);
    const issue = issues.find((i) => i.message.includes("lit:x"));
    expect(issue?.message).toContain("silently drop");
  });

  it("flags a double-wired single-cable input", () => {
    const { issues } = validateText(
      `A: NumberInputNode value=1\nB: NumberInputNode value=2\nC: DisplayNode in<-A.value in<-B.value\n---\n{}`,
    );
    // The grammar tokenizes both fields; only one `in<-` key survives per
    // token map — so build the double wire straight on a SavedGraph instead.
    const g: SavedGraph = {
      v: 2,
      nodes: [
        { id: "A", type: "NumberInputNode", name: "A", x: 0, y: 0, init: { value: 1 } },
        { id: "B", type: "NumberInputNode", name: "B", x: 0, y: 0, init: { value: 2 } },
        { id: "C", type: "DisplayNode", name: "C", x: 0, y: 0, init: {} },
      ],
      connections: [
        { source: "A", sourceOutput: "value", target: "C", targetInput: "in" },
        { source: "B", sourceOutput: "value", target: "C", targetInput: "in" },
      ],
    };
    const direct = validateGraph(g);
    expect(direct.some((i) => i.message.includes("wired more than once"))).toBe(true);
    // (the text-form variant may or may not carry both cables — assert nothing on it)
    void issues;
  });

  it("flags a dependency cycle as a WARNING (legal to run — it computes #CIRC!)", () => {
    const { issues } = validateText(
      `A: ArithmeticNode a<-B.result\nB: ArithmeticNode a<-A.result\n---\n{}`,
    );
    const issue = issues.find((i) => i.message.includes("#CIRC!"));
    expect(issue?.severity).toBe("warning");
    expect(issue?.message).toContain("A");
    expect(issue?.message).toContain("B");
    expect(hardIssues(issues)).toEqual([]);
  });

  it("flags a save version that is not this build's", () => {
    for (const v of [99, 1]) {
      const { issues } = validateText(`A: NumberInputNode value=1\n---\n{ "v": ${v} }`);
      expect(issues.some((i) => i.message.includes("only opens the current format"))).toBe(true);
    }
  });

  it("flags an op outside the class's vocabulary", () => {
    const { issues } = validateText(`A: AggregateNode op="summ" lit:list=1\n---\n{}`);
    const issue = issues.find((i) => i.message.includes('unknown op "summ"'));
    expect(issue?.message).toContain("`sum`");
  });

  it("flags a bad aggregate op on Group By (dropdown-only vocabulary)", () => {
    const { issues } = validateText(`G: GroupByFrameNode op="average"\n---\n{}`);
    const issue = issues.find((i) => i.message.includes('unknown op "average"'));
    expect(issue?.message).toContain("Ops: sum, avg");
  });

  it("recurses into a composite's internal subgraph", () => {
    const g: SavedGraph = {
      v: 2,
      nodes: [
        {
          id: "C", type: "CompositeNode", name: "C", x: 0, y: 0,
          init: {
            internal: {
              nodes: [{ id: "n1", type: "NumberInputNod", init: { value: 1 } }],
              connections: [],
            },
          },
        },
      ],
      connections: [],
    };
    const issues = validateGraph(g);
    const issue = issues.find((i) => i.message.includes("inside the composite"));
    expect(issue?.message).toContain('unknown node type "NumberInputNod"');
    expect(issue?.node).toBe("C");
  });

  it("flags sidecar references to unknown nodes", () => {
    const { issues } = validateText(
      `A: NumberInputNode value=1\n---\n{ "positions": { "Ax": { "x": 0, "y": 0 } }, "pins": [{ "nodeId": "Bx", "outputKey": "value" }] }`,
    );
    expect(issues.some((i) => i.message.includes(`positions references unknown node "Ax"`))).toBe(true);
    expect(issues.some((i) => i.message.includes(`pins references unknown node "Bx"`))).toBe(true);
  });
});

describe("formatIssues", () => {
  it("anchors to lines and nodes", () => {
    const { issues } = validateText(`A: NumberInputNod value=1\n---\n{}`);
    const text = formatIssues(issues);
    expect(text).toContain("line 1");
    expect(text).toContain("[A]");
  });
});

// ─── The false-positive guards ──────────────────────────────────────────────────
// Every Add-menu leaf, saved exactly as its factory constructs it, must
// validate clean — this is what makes the validator's checks (init keys, op
// vocabulary, literal declarations) safe to enforce across the whole surface.

describe("catalog sweep", () => {
  it("every catalog leaf validates clean as a single-node save", async () => {
    const { FLAT_CATALOG } = await import("../../src/graph/catalogUtils");
    const { extractInit } = await import("../../src/graph/copyPaste");
    const bad: string[] = [];
    for (const [type, leaf] of FLAT_CATALOG) {
      let inst;
      try {
        inst = leaf.create() as import("rete").ClassicPreset.Node;
      } catch {
        continue;
      }
      const anyInst = inst as unknown as Record<string, unknown>;
      const sn: SavedGraph["nodes"][number] = {
        id: "n1", type: inst.constructor.name, x: 0, y: 0, init: extractInit(inst),
      };
      if (anyInst.literals && typeof anyInst.literals === "object") sn.literals = { ...(anyInst.literals as Record<string, number>) };
      if (anyInst.stringLiterals && typeof anyInst.stringLiterals === "object") sn.stringLiterals = { ...(anyInst.stringLiterals as Record<string, string>) };
      const issues = hardIssues(validateGraph({ v: 2, nodes: [sn], connections: [] }));
      if (issues.length > 0) bad.push(`${type}: ${issues[0].message}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("seed sweep", () => {
  const dir = join(__dirname, "../../src/graph/seedGraphs");
  const seeds = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("found the seeds", () => {
    expect(seeds.length).toBeGreaterThan(5);
  });

  for (const f of seeds) {
    it(`${f} validates clean as JSON and through the text form`, () => {
      const g = JSON.parse(readFileSync(join(dir, f), "utf8")) as SavedGraph;
      // Hard issues only: null-and-logical ships a deliberate #CIRC! cycle demo.
      expect(formatIssues(hardIssues(validateGraph(g)))).toBe("");
      const { issues } = validateText(writeTextForm(g));
      expect(formatIssues(hardIssues(issues))).toBe("");
    });
  }
});
