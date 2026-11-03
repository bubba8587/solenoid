// [[C136]] typesKnownAfterCalc
import { describe, it, expect, afterEach } from "vitest";
import type { View } from "../../src/graph/view";
import { CubeInputNode } from "../../src/graph/nodes/cube";
import { isCubeValue, type CubeValue } from "../../src/graph/frame";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { processGraph, setEditorRefs } from "../../src/graph/process";
import { dateListSocket } from "../../src/graph/sockets";
import { nodeOutputElemFamily } from "../../src/graph/components/valueDisplayFormat";
import { ExpressionNode } from "../../src/graph/nodes/expression";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";

// A formula that hands back a date it was given answers a date, in a formula column and on the Formula card alike.

const cubeOf = (columns: object[], rows: object[]): CubeValue => {
  const out = new CubeInputNode({ cubeText: JSON.stringify({ columns, rows }) }).data().cube;
  if (!isCubeValue(out)) throw new Error(`expected a cube, got ${JSON.stringify(out)}`);
  return out;
};
const rows = [
  { name: "A", d: "2026-09-01", n: 2 },
  { name: "B", d: "2026-09-03", n: 5 },
  { name: "C", d: "2026-10-10", n: 1 },
];
const typed = [{ name: "name", type: "string" }, { name: "d", type: "date" }, { name: "n", type: "number" }];
const typeOf = (expr: string) => cubeOf([...typed, { name: "out", expr }], rows).columns.find((c) => c.name === "out")!.type;

describe("a formula column that hands back a date is a date column", () => {
  it.each([
    "MAX(d)", "MIN(d)", "MEDIAN(d)", "AVERAGE(d)", "LARGE(d, 2)",
    "INDEX(d, 1)", "XLOOKUP(\"B\", name, d)",
    "IF(@n > 2, @d, @d + 7)", "CHOOSE(1, @d, @d + 1)", "IFERROR(@d, \"\")", "SWITCH(@name, \"A\", @d, @d + 1)",
    "ROUND(@d, 0)", "INT(@d)", "@d + 30", "EDATE(@d, 1)",
    "IFERROR(@d, 0)", "PERCENTILE(d, 0.5)",
    "LAMBDA(x, x + 7)(@d)",
  ])("%s", (expr) => {
    expect(typeOf(expr)).toBe("date");
  });

  it.each(["SUM(d)", "@d - @d", "MAX(d) - MIN(d)", "IF(@n > 2, @d, @n)", "STDEV(d)"])("%s stays a number", (expr) => {
    expect(typeOf(expr)).toBe("number");
  });
});

describe("a date a formula turns into text reads as a date ([[C137]] datesNeverSerials)", () => {
  const cellsOf = (expr: string) => cubeOf([...typed, { name: "out", expr }], rows).columns.find((c) => c.name === "out")!.cells;
  it.each([
    ["\"Due \" & @d", "Due 01-Sep-2026"],
    ["CONCAT(@name, \": \", @d)", "A: 01-Sep-2026"],
    ["TEXTJOIN(\" \", TRUE, @name, @d + 1)", "A 02-Sep-2026"],
    ["@name & \" \" & @n", "A 2"],
  ])("%s", (expr, first) => {
    expect(cellsOf(expr)[0]).toBe(first);
  });
});

class Dates extends GraphNode {
  constructor() {
    super("Dates");
    this.addOutput("out", new GraphOutput(dateListSocket));
  }
  data() { return { out: [46037, 46083, 46200] }; }
}

describe("the Formula card on Auto takes the family its formula computed", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  async function formula(expr: string, resultAs?: "number" | "auto") {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
    const src = new Dates();
    const f = new ExpressionNode({ expr, ...(resultAs ? { resultAs } : {}) });
    await editor.addNode(src as unknown as Schemes["Node"]);
    await editor.addNode(f as unknown as Schemes["Node"]);
    await editor.addConnection(new GraphConnection(src, "out", f, "x") as unknown as Schemes["Connection"]);
    settleWildcardTypes(editor); // as every connection change runs it
    await processGraph();
    await new Promise((r) => setTimeout(r, 0)); // the retype lands in a microtask after the pass
    return nodeOutputElemFamily(f.id, "result");
  }

  it("Auto is the default, and MAX of dates is a date", async () => {
    expect(new ExpressionNode().resultAs).toBe("auto");
    expect(await formula("MAX(x)")).toBe("date");
    expect(await formula("INDEX(x, 2)")).toBe("date");
  });

  it("text it builds from a date reads as a date", async () => {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
    const src = new Dates();
    const f = new ExpressionNode({ expr: "\"First \" & INDEX(x, 1)" });
    await editor.addNode(src as unknown as Schemes["Node"]);
    await editor.addNode(f as unknown as Schemes["Node"]);
    await editor.addConnection(new GraphConnection(src, "out", f, "x") as unknown as Schemes["Connection"]);
    settleWildcardTypes(editor);
    await processGraph();
    expect(f.cachedResult).toBe("First 15-Jan-2026");
  });

  it("a span of dates is a number; a picked Number stands", async () => {
    expect(await formula("MAX(x) - MIN(x)")).toBe("number");
    expect(await formula("MAX(x)", "number")).toBe("number");
  });
});
