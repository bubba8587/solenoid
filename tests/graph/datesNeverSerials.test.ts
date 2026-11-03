// [[C137]] datesNeverSerials
import { describe, it, expect, afterEach } from "vitest";
import type { View } from "../../src/graph/view";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, type GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { processGraph, setEditorRefs } from "../../src/graph/process";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";
import { dateListSocket, dateTableSocket, numListSocket, frameSocket, logicalListSocket, strListSocket } from "../../src/graph/sockets";
import { isSolError } from "../../src/graph/errorValue";
import { ConcatListsNode, ListIndexNode, SumIfsNode } from "../../src/graph/nodes/list";
import { GetColumnNode, SplitFrameNode } from "../../src/graph/nodes/frame";
import { nodeOutputElemFamily } from "../../src/graph/components/valueDisplayFormat";
import { IfNode } from "../../src/graph/nodes/logic";
import { XLookupNode } from "../../src/graph/nodes/frame";
import { ChartNode } from "../../src/graph/nodes/visual";
import { MapTableNode, ReduceLambdaNode } from "../../src/graph/nodes/tableLambda";
import { ExpressionNode } from "../../src/graph/nodes/expression";
import type { FrameValue } from "../../src/graph/frame";
import { groupByFrame, pivotFrame, windowFrame, replaceValues } from "./coreVerbs";

// A date never comes out as its serial number: a summary of dates that is still a date stays a Date column.

const orders: FrameValue = {
  __frame: true,
  columns: [
    { name: "rep", type: "string", values: ["Ada", "Ada", "Bo", "Bo"] },
    { name: "due", type: "date", values: [46000, 46010, 46020, 46031] },
  ],
};
const typeOf = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)?.type;
const cellsOf = (f: FrameValue, name: string) => f.columns.find((c) => c.name === name)?.values ?? [];
const isTypeError = (v: unknown) => isSolError(v) && (v as { code: string }).code === "#TYPE!";

describe("table verbs keep a date a date", () => {
  it("Group By: min, max, mean, median and mode of dates are dates; a count is a number; a sum is #TYPE!", () => {
    const out = groupByFrame(orders, ["rep"], (["min", "max", "avg", "median", "mode", "sum", "count"] as const).map((op) => ({ column: "due", op, as: op })));
    for (const op of ["min", "max", "avg", "median", "mode"]) expect(typeOf(out, op), op).toBe("date");
    expect(typeOf(out, "count")).toBe("number");
    expect(cellsOf(out, "sum").every(isTypeError)).toBe(true);
  });

  it("Pivot: the same rule for each value column", () => {
    const out = pivotFrame(orders, { rowFields: ["rep"], colFields: [], values: ["due", "due"], funcs: ["max", "sum"] });
    const [, maxCol, sumCol] = out.columns;
    expect(maxCol.type).toBe("date");
    expect(sumCol.values.every(isTypeError)).toBe(true);
  });

  it("Window: running and rolling min, max and mean of dates are dates; a difference is a number; a sum or share is #TYPE!", () => {
    for (const fn of ["cummin", "cummax", "cumavg", "rolling_min", "rolling_max", "rolling_avg", "group_min", "group_max", "group_avg", "lag"] as const) {
      expect(typeOf(windowFrame(orders, { partitionBy: ["rep"], fn, column: "due", as: "w", n: 2 }), "w"), fn).toBe("date");
    }
    for (const fn of ["diff", "rank"] as const) {
      expect(typeOf(windowFrame(orders, { partitionBy: ["rep"], orderBy: "due", fn, column: "due", as: "w" }), "w"), fn).toBe("number");
    }
    for (const fn of ["cumsum", "rolling_sum", "group_sum", "share", "pct_change"] as const) {
      expect(cellsOf(windowFrame(orders, { partitionBy: ["rep"], orderBy: "due", fn, column: "due", as: "w", n: 2 }), "w").every(isTypeError), fn).toBe(true);
    }
  });
});

class Src extends GraphNode {
  constructor(private value: unknown, socket: GraphSocket) {
    super("Src");
    this.addOutput("out", new GraphOutput(socket));
  }
  data() { return { out: this.value }; }
}

describe("dates read and named as dates", () => {
  it("Pivot heads the columns of a date field with dates", () => {
    const out = pivotFrame(orders, { rowFields: ["rep"], colFields: ["due"], values: ["due"], funcs: ["count"] });
    expect(out.columns.map((c) => c.name)).toContain("09-Dec-2025");
    expect(out.columns.map((c) => c.name).some((n) => /^460\d\d/.test(n))).toBe(false);
  });

  it("Replace Values finds and writes a date typed as a date", () => {
    const out = replaceValues(orders, "due", "9-Dec-2025", "1-Jan-2026", "cell");
    expect(out.columns[1].values[0]).toBe(46023);
  });
});

describe("a step that would mix dates with another kind refuses with #TYPE!", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  async function run<N extends GraphNode>(card: N, wires: [GraphNode, string][], read: (n: N) => unknown) {
    const editor = new GraphEditor<Schemes>();
    const engine = new DataflowEngine<Schemes>();
    editor.use(engine);
    setEditorRefs(editor, engine, { rerenderNode: async () => {}, rerenderCables: async () => {} } as unknown as View);
    await editor.addNode(card as unknown as Schemes["Node"]);
    for (const [src, key] of wires) {
      await editor.addNode(src as unknown as Schemes["Node"]);
      await editor.addConnection(new GraphConnection(src, "out", card, key) as unknown as Schemes["Connection"]);
    }
    settleWildcardTypes(editor);
    await processGraph();
    return read(card);
  }
  const typeError = (v: unknown) => isSolError(v) && (v as { code: string }).code === "#TYPE!";
  const dates = () => new Src([46000, 46010], dateListSocket);
  const nums = () => new Src([1, 2], numListSocket);

  it("Concat Lists of a date list and a number list", async () => {
    const n = new ConcatListsNode();
    const [k1, k2] = n.valueInputKeys();
    expect(typeError(await run(n, [[dates(), k1], [nums(), k2]], (c) => c.cachedList))).toBe(true);
    const ok = new ConcatListsNode();
    const [j1, j2] = ok.valueInputKeys();
    expect(typeError(await run(ok, [[dates(), j1], [dates(), j2]], (c) => c.cachedList))).toBe(false);
  });

  it("IF over a list of conditions with a date branch and a number branch", async () => {
    const n = new IfNode();
    const conds = new Src([true, false], logicalListSocket);
    expect(typeError(await run(n, [[conds, "cond"], [dates(), "then"], [nums(), "else"]], (c) => c.cachedResult))).toBe(true);
  });

  it("XLOOKUP across that lands on a date column and a number column", async () => {
    const frame: FrameValue = { __frame: true, columns: [{ name: "due", type: "date", values: [46000] }, { name: "qty", type: "number", values: [3] }] };
    const n = new XLookupNode({ direction: "columns" });
    n.literals = { returnRow: 1 };
    n.stringLiterals = { lookup: "", ifNotFound: "" };
    const got = await run(n, [[new Src(frame, frameSocket), "frame"], [new Src(["due", "qty"], strListSocket), "lookup"]], (c) => c.cachedResult);
    expect(typeError(got)).toBe(true);
  });

  it("INDEX picking a date column and a number column", async () => {
    const frame: FrameValue = { __frame: true, columns: [{ name: "due", type: "date", values: [46000] }, { name: "qty", type: "number", values: [3] }] };
    const n = new ListIndexNode();
    n.literals = { index: 1 };
    const got = await run(n, [[new Src(frame, frameSocket), "list"], [new Src([1, 2], numListSocket), "column"]], (c) => c.cachedResult);
    expect(typeError(got)).toBe(true);
  });

  it("Get Column reads a date column as dates by default, and refuses to read it as Number", async () => {
    const frame: FrameValue = { __frame: true, columns: [{ name: "due", type: "date", values: [46000, 46010] }] };
    const n = new GetColumnNode();
    n.stringLiterals = { name: "due" };
    expect(n.readAs).toBe("auto");
    expect(await run(n, [[new Src(frame, frameSocket), "frame"]], (c) => c.cachedResult)).toEqual([46000, 46010]);
    expect(nodeOutputElemFamily(n.id, "values")).toBe("date");
    const asNumber = new GetColumnNode({ readAs: "number" });
    asNumber.stringLiterals = { name: "due" };
    expect(typeError(await run(asNumber, [[new Src(frame, frameSocket), "frame"]], (c) => c.cachedResult))).toBe(true);
  });
  it("SUMIFS: MIN, MAX and AVERAGE of a date column are dates; a sum of dates is refused", async () => {
    const frame: FrameValue = { __frame: true, columns: [{ name: "rep", type: "string", values: ["Ada", "Ada", "Bo"] }, { name: "due", type: "date", values: [46000, 46010, 46020] }] };
    const ifs = (op: "minifs" | "maxifs" | "averageifs" | "sumifs") => {
      const n = new SumIfsNode({ op });
      n.stringLiterals = { values: "due", column0: "rep", value0: "Ada" };
      return n;
    };
    for (const [op, want] of [["minifs", 46000], ["maxifs", 46010], ["averageifs", 46005]] as const) {
      const n = ifs(op);
      expect(await run(n, [[new Src(frame, frameSocket), "frame"]], (c) => c.cachedResult), op).toBe(want);
      expect(nodeOutputElemFamily(n.id, "result"), op).toBe("date");
    }
    expect(typeError(await run(ifs("sumifs"), [[new Src(frame, frameSocket), "frame"]], (c) => c.cachedResult))).toBe(true);
  });
  it("Split Frame under All leaves no matrix over a date column; Date splits it as a date table", async () => {
    const frame: FrameValue = { __frame: true, columns: [{ name: "due", type: "date", values: [46000] }, { name: "qty", type: "number", values: [3] }] };
    const all = new SplitFrameNode();
    expect(await run(all, [[new Src(frame, frameSocket), "frame"]], (c) => [c.cachedMatrix, c.cachedMixed])).toEqual([null, true]);
    const dated = new SplitFrameNode({ colType: "date" });
    expect(await run(dated, [[new Src(frame, frameSocket), "frame"]], (c) => c.cachedMatrix)).toEqual([[46000]]);
    expect(nodeOutputElemFamily(dated.id, "matrix")).toBe("date");
  });
  it("a chart refuses to draw a plain date list or a lone date column as heights", async () => {
    expect(typeError(await run(new ChartNode(), [[dates(), "values"]], (c) => c.cachedError))).toBe(true);
    const lone: FrameValue = { __frame: true, columns: [{ name: "due", type: "date", values: [46000, 46010] }] };
    expect(typeError(await run(new ChartNode(), [[new Src(lone, frameSocket), "values"]], (c) => c.cachedError))).toBe(true);
    expect(await run(new ChartNode(), [[nums(), "values"]], (c) => c.cachedError)).toBe(null);
  });
  it("the LAMBDA helpers: Auto takes a date answer, Number refuses it, and text reads a date as a date", async () => {
    const table = () => new Src([[46000], [46010]], dateTableSocket);
    const map = new MapTableNode({ expr: "value + 1" });
    expect(await run(map, [[table(), "table"]], (c) => c.cachedResult)).toEqual([[46001], [46011]]);
    expect(map.lastResultFamily).toBe("date");
    const asNumber = new MapTableNode({ expr: "value + 1", resultAs: "number" });
    expect(typeError(await run(asNumber, [[table(), "table"]], (c) => c.cachedResult))).toBe(true);
    const text = new MapTableNode({ expr: "value & \"!\"" });
    expect(await run(text, [[table(), "table"]], (c) => c.cachedResult)).toEqual([["09-Dec-2025!"], ["19-Dec-2025!"]]);
    const latest = new ReduceLambdaNode({ expr: "MAX(acc, value)" });
    latest.literals = { initial: 0 };
    expect(await run(latest, [[table(), "table"]], (c) => c.cachedResult)).toBe(46010);
    expect(latest.lastResultFamily).toBe("date");
  });
  it("a Formula card set to Number refuses a date answer", async () => {
    const n = new ExpressionNode({ expr: "d + 1", resultAs: "number" });
    expect(typeError(await run(n, [[dates(), "d"]], (c) => c.cachedResult))).toBe(true);
  });
});
