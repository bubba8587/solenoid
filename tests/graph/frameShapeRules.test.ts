import { describe, it, expect } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { makeFrameShapeResolver } from "../../src/graph/frameShapeResolver";
import {
  FrameInputNode, DropBlankRowsNode, FillBlanksNode, ReplaceValuesNode, AddColumnNode,
  ComputedColumnNode, BindColumnsNode, MergeColumnsNode, HeadersNode, AllocatorNode,
  ReconcileNode, DescribeNode, CorrMatrixNode, WindowNode, AppendNode, FrameFromListsNode,
  ColumnsNode, RenameNode, GroupByFrameNode, UnpivotNode, PivotNode, JoinNode,
  SplitColumnNode, AddIndexNode,
} from "../../src/graph/nodes/frame";
import { TextInputNode } from "../../src/graph/nodes/text";
import { ListInputNode, FindPeaksNode } from "../../src/graph/nodes/list";
import { PointPlotterNode, CurveNode, SlicerNode } from "../../src/graph/nodes/control";
import { AmortizationNode } from "../../src/graph/nodes/finance";
import { HrZonesNode } from "../../src/graph/nodes/health";
import { EtsForecastNode, FitDistributionNode, DecomposeNode, OdeIntegrateNode } from "../../src/graph/nodes/stats";
import { settleWildcardTypes } from "../../src/graph/trueAnyAdopt";
import type { Schemes } from "../../src/graph/schemes";
import type { Shape } from "../../src/graph/frameShape";

// One case per DECLARED rule (nodes/frameShapeHook.ts): the static columns must be exactly
// what the node's own run would produce. A rule that can't know its columns says so with
// `null` — claiming a wrong name is worse than claiming nothing.

const cols = (s: Shape | null) => s?.columns.map((c) => `${c.name}:${c.type}`) ?? null;

async function source(editor: NodeEditor<Schemes>, text: string): Promise<Schemes["Node"]> {
  const src = new FrameInputNode() as unknown as Schemes["Node"];
  (src as unknown as FrameInputNode).frameText = text;
  await editor.addNode(src);
  return src;
}

/** Wire `text` into `node`.`inKey` and read the shape of its `outKey`. */
async function shapeOf(node: object, inKey: string, text: string, outKey = "frame"): Promise<Shape | null> {
  const editor = new NodeEditor<Schemes>();
  const src = await source(editor, text);
  const n = node as Schemes["Node"];
  await editor.addNode(n);
  await editor.addConnection(new ClassicPreset.Connection(src, "frame", n, inKey) as Schemes["Connection"]);
  return makeFrameShapeResolver(editor as never).outShape(n.id, outKey);
}

const SALES = "Region, Qty, Price\nWest, 2, 5\nEast, 3, 7";

/** Wire a frame into `frame` AND a Text Input into each config socket, then read the shape. */
async function wiredConfig(node: object, configKeys: string[], text = SALES): Promise<Shape | null> {
  const editor = new NodeEditor<Schemes>();
  const src = await source(editor, text);
  const n = node as Schemes["Node"];
  await editor.addNode(n);
  await editor.addConnection(new ClassicPreset.Connection(src, "frame", n, "frame") as Schemes["Connection"]);
  for (const k of configKeys) {
    const t = new TextInputNode() as unknown as Schemes["Node"];
    await editor.addNode(t);
    await editor.addConnection(new ClassicPreset.Connection(t, "value", n, k) as Schemes["Connection"]);
  }
  return makeFrameShapeResolver(editor as never).outShape(n.id, "frame");
}

describe("declared frame shapes match what the node would produce", () => {
  it("Drop Blank Rows forwards the column set", async () => {
    expect(cols(await shapeOf(new DropBlankRowsNode(), "frame", SALES)))
      .toEqual(["Region:string", "Qty:number", "Price:number"]);
  });

  it("Fill Blanks forwards, and #REF!s an unknown column (null)", async () => {
    const fill = new FillBlanksNode();
    fill.stringLiterals.columns = "Qty";
    expect(cols(await shapeOf(fill, "frame", SALES))).toEqual(["Region:string", "Qty:number", "Price:number"]);
    const bad = new FillBlanksNode();
    bad.stringLiterals.columns = "Nope";
    expect(await shapeOf(bad, "frame", SALES)).toBeNull();
  });

  it("Replace Values forwards the column set", async () => {
    const rep = new ReplaceValuesNode();
    rep.stringLiterals.column = "Region";
    expect(cols(await shapeOf(rep, "frame", SALES))).toEqual(["Region:string", "Qty:number", "Price:number"]);
  });

  it("Add Column appends its declared type, and replaces in place by name", async () => {
    const add = new AddColumnNode({ addAs: "date" });
    add.stringLiterals.name = "When";
    expect(cols(await shapeOf(add, "frame", SALES))).toEqual(["Region:string", "Qty:number", "Price:number", "When:date"]);
    const replace = new AddColumnNode({ addAs: "text" });
    replace.stringLiterals.name = "Qty";
    expect(cols(await shapeOf(replace, "frame", SALES))).toEqual(["Region:string", "Qty:string", "Price:number"]);
  });

  it("Computed Column places the new column after the anchor; auto typing is unknowable", async () => {
    const cc = new ComputedColumnNode({ expr: "Qty * Price", addAs: "number" });
    cc.stringLiterals.name = "Total";
    cc.stringLiterals.after = "Region";
    expect(cols(await shapeOf(cc, "frame", SALES))).toEqual(["Region:string", "Total:number", "Qty:number", "Price:number"]);
    const auto = new ComputedColumnNode({ expr: "Qty * Price" });
    auto.stringLiterals.name = "Total";
    expect(await shapeOf(auto, "frame", SALES)).toBeNull();
  });

  it("Bind Columns concatenates the wired frames, deduping repeated names", async () => {
    const editor = new NodeEditor<Schemes>();
    const a = await source(editor, "Region, Qty\nWest, 2");
    const b = await source(editor, "Region, Note\nWest, ok");
    const bind = new BindColumnsNode() as unknown as Schemes["Node"];
    await editor.addNode(bind);
    const [k0, k1] = (bind as unknown as BindColumnsNode).valueInputKeys();
    await editor.addConnection(new ClassicPreset.Connection(a, "frame", bind, k0) as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(b, "frame", bind, k1) as Schemes["Connection"]);
    expect(cols(makeFrameShapeResolver(editor as never).outShape(bind.id, "frame")))
      .toEqual(["Region:string", "Qty:number", "Region2:string", "Note:string"]);
  });

  it("Append unions the wired frames by name", async () => {
    const editor = new NodeEditor<Schemes>();
    const a = await source(editor, "Region, Qty\nWest, 2");
    const b = await source(editor, "Region, Note\nWest, ok");
    const app = new AppendNode() as unknown as Schemes["Node"];
    await editor.addNode(app);
    const [k0, k1] = (app as unknown as AppendNode).valueInputKeys();
    await editor.addConnection(new ClassicPreset.Connection(a, "frame", app, k0) as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(b, "frame", app, k1) as Schemes["Connection"]);
    expect(cols(makeFrameShapeResolver(editor as never).outShape(app.id, "frame")))
      .toEqual(["Region:string", "Qty:number", "Note:string"]);
  });

  it("Merge Columns drops the sources and inserts the merged text column in their place", async () => {
    const merge = new MergeColumnsNode();
    merge.stringLiterals.columns = "Region, Price";
    merge.stringLiterals.name = "Label";
    expect(cols(await shapeOf(merge, "frame", SALES))).toEqual(["Label:string", "Qty:number"]);
  });

  it("Headers: demote is Col1…ColN text, promote reads the first ROW (null)", async () => {
    expect(cols(await shapeOf(new HeadersNode({ action: "demote" }), "frame", SALES)))
      .toEqual(["Col1:string", "Col2:string", "Col3:string"]);
    expect(await shapeOf(new HeadersNode({ action: "promote" }), "frame", SALES)).toBeNull();
  });

  it("Allocator names the category column after the first text column", async () => {
    expect(cols(await shapeOf(new AllocatorNode(), "categories", "Item, Min, Max\nCar, 1, 2")))
      .toEqual(["Item:string", "Allocation:number", "Share:number"]);
  });

  it("Reconcile pairs the shared columns before/after, with a Δ for numbers", async () => {
    const editor = new NodeEditor<Schemes>();
    const before = await source(editor, "Id, Qty, Note\n1, 2, a");
    const after = await source(editor, "Id, Qty, Extra\n1, 3, x");
    const rec = new ReconcileNode() as unknown as Schemes["Node"];
    (rec as unknown as ReconcileNode).stringLiterals.key = "Id";
    await editor.addNode(rec);
    await editor.addConnection(new ClassicPreset.Connection(before, "frame", rec, "left") as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(after, "frame", rec, "right") as Schemes["Connection"]);
    const r = makeFrameShapeResolver(editor as never);
    expect(cols(r.outShape(rec.id, "frame"))).toEqual([
      "Id:number", "Status:string", "Qty (before):number", "Qty (after):number", "Qty Δ:number",
      "Note (removed):string", "Extra (added):string",
    ]);
    expect(r.outShape(rec.id, "summary")).toBeNull(); // the text output is not a frame
  });

  it("Describe carries the fixed profile columns", async () => {
    expect(cols(await shapeOf(new DescribeNode(), "frame", SALES))).toEqual([
      "column:string", "type:string", "count:number", "blank:number", "distinct:number",
      "mean:number", "std:number", "min:number", "25%:number", "50%:number", "75%:number", "max:number",
    ]);
  });

  it("Correlation Matrix is a name column plus one column per NUMBER column", async () => {
    expect(cols(await shapeOf(new CorrMatrixNode(), "frame", SALES)))
      .toEqual(["column:string", "Qty:number", "Price:number"]);
  });

  it("Window appends its new column, named after the function when untyped", async () => {
    const w = new WindowNode({ agg: "cumsum" });
    w.stringLiterals.column = "Qty";
    expect(cols(await shapeOf(w, "frame", SALES)))
      .toEqual(["Region:string", "Qty:number", "Price:number", "running_sum_Qty:number"]);
    const lag = new WindowNode({ agg: "lag" });
    lag.stringLiterals.column = "Region";
    lag.stringLiterals.name = "Previous";
    expect(cols(await shapeOf(lag, "frame", SALES)))
      .toEqual(["Region:string", "Qty:number", "Price:number", "Previous:string"]);
  });

  it("the fixed-column producers outside the verb family declare theirs", async () => {
    const fixed: Array<[object, string, string[]]> = [
      [new PointPlotterNode(), "result", ["X:number", "Y:number"]],
      [new CurveNode(), "result", ["X:number", "Value:number"]],
      [new AmortizationNode(), "frame", ["Period:number", "Payment:number", "Interest:number", "Principal:number", "Balance:number"]],
      [new HrZonesNode(), "zones", ["Zone:string", "Low:number", "High:number"]],
      [new FindPeaksNode(), "result", ["Position:number", "Height:number"]],
      [new EtsForecastNode(), "forecast", ["Forecast:number", "Interval:number"]],
      [new DecomposeNode(), "decomposition", ["Trend:number", "Seasonal:number", "Residual:number"]],
      [new OdeIntegrateNode(), "solution", ["t:number", "y:number"]],
      [new FitDistributionNode(), "ranking", ["family:string", "parameter 1:string", "value 1:number",
        "parameter 2:string", "value 2:number", "log-likelihood:number", "AIC:number", "KS:number"]],
    ];
    for (const [node, outKey, expected] of fixed) {
      const editor = new NodeEditor<Schemes>();
      const n = node as Schemes["Node"];
      await editor.addNode(n);
      expect(cols(makeFrameShapeResolver(editor as never).outShape(n.id, outKey)), n.constructor.name).toEqual(expected);
    }
    // The Slicer only picks rows, so it carries its input's columns.
    expect(cols(await shapeOf(new SlicerNode(), "frame", SALES, "result")))
      .toEqual(["Region:string", "Qty:number", "Price:number"]);
  });

  it("Frame from Lists types each WIRED column from its port, and skips unwired rows", async () => {
    const editor = new NodeEditor<Schemes>();
    const list = new ListInputNode() as unknown as Schemes["Node"];
    await editor.addNode(list);
    const ffl = new FrameFromListsNode() as unknown as Schemes["Node"];
    await editor.addNode(ffl);
    const [nameKey, valsKey] = (ffl as unknown as FrameFromListsNode).valuePairKeys()[0];
    (ffl as unknown as FrameFromListsNode).stringLiterals[nameKey] = "Qty";
    await editor.addConnection(new ClassicPreset.Connection(list, "list", ffl, valsKey) as Schemes["Connection"]);
    settleWildcardTypes(editor); // the Column port adopts the wired list's element type
    expect(cols(makeFrameShapeResolver(editor as never).outShape(ffl.id, "frame"))).toEqual(["Qty:number"]);
  });
});

// A literal speaks for an UNWIRED socket alone (nodes/frameShapeHook.ts): once a cable feeds
// the config, the run reads the cable and the card text says nothing about the columns.
describe("a wired config socket makes the shape unknown", () => {
  it("Columns reads the typed list, and goes unknown once Columns is wired", async () => {
    const keep = new ColumnsNode();
    keep.stringLiterals.columns = "Region";
    expect(cols(await shapeOf(keep, "frame", SALES))).toEqual(["Region:string"]);
    const wired = new ColumnsNode();
    wired.stringLiterals.columns = "Region";
    expect(await wiredConfig(wired, ["columns"])).toBeNull();
  });

  it("Rename maps the typed pairs, and goes unknown once From or To is wired", async () => {
    const ren = new RenameNode();
    ren.stringLiterals.from = "Region";
    ren.stringLiterals.to = "Area";
    expect(cols(await shapeOf(ren, "frame", SALES))).toEqual(["Area:string", "Qty:number", "Price:number"]);
    for (const key of ["from", "to"]) {
      const wired = new RenameNode();
      wired.stringLiterals.from = "Region";
      wired.stringLiterals.to = "Area";
      expect(await wiredConfig(wired, [key]), key).toBeNull();
    }
  });

  it("Group By reads the typed keys, and goes unknown once Group by or Aggregate is wired", async () => {
    const g = new GroupByFrameNode();
    g.stringLiterals.keys = "Region";
    g.stringLiterals.column = "Qty";
    expect(cols(await shapeOf(g, "frame", SALES))).toEqual(["Region:string", "Qty:number"]);
    for (const key of ["keys", "column"]) {
      const wired = new GroupByFrameNode();
      wired.stringLiterals.keys = "Region";
      wired.stringLiterals.column = "Qty";
      expect(await wiredConfig(wired, [key]), key).toBeNull();
    }
  });

  it("Unpivot reads the typed columns, and goes unknown once Keep or Melt is wired", async () => {
    const u = new UnpivotNode();
    u.stringLiterals.idColumns = "Region";
    u.stringLiterals.valueColumns = "Qty, Price";
    expect(cols(await shapeOf(u, "frame", SALES))).toEqual(["Region:string", "variable:string", "value:number"]);
    for (const key of ["idColumns", "valueColumns"]) {
      const wired = new UnpivotNode();
      wired.stringLiterals.idColumns = "Region";
      wired.stringLiterals.valueColumns = "Qty, Price";
      expect(await wiredConfig(wired, [key]), key).toBeNull();
    }
  });

  it("Pivot reads the typed fields, and goes unknown once a field list is wired", async () => {
    const p = new PivotNode();
    p.stringLiterals.rowFields = "Region";
    p.stringLiterals.values = "Qty";
    expect(cols(await shapeOf(p, "frame", SALES))).toEqual(["Region:string"]);
    for (const key of ["rowFields", "colFields", "values"]) {
      const wired = new PivotNode();
      wired.stringLiterals.rowFields = "Region";
      wired.stringLiterals.values = "Qty";
      expect(await wiredConfig(wired, [key]), key).toBeNull();
    }
  });

  it("Join reads the typed keys, and goes unknown once a key is wired", async () => {
    const build = async (wireKey?: string) => {
      const editor = new NodeEditor<Schemes>();
      const left = await source(editor, "Id, Qty\n1, 2");
      const right = await source(editor, "Id, Note\n1, ok");
      const j = new JoinNode() as unknown as Schemes["Node"];
      (j as unknown as JoinNode).stringLiterals.leftKey = "Id";
      await editor.addNode(j);
      await editor.addConnection(new ClassicPreset.Connection(left, "frame", j, "left") as Schemes["Connection"]);
      await editor.addConnection(new ClassicPreset.Connection(right, "frame", j, "right") as Schemes["Connection"]);
      if (wireKey) {
        const t = new TextInputNode() as unknown as Schemes["Node"];
        await editor.addNode(t);
        await editor.addConnection(new ClassicPreset.Connection(t, "value", j, wireKey) as Schemes["Connection"]);
      }
      return makeFrameShapeResolver(editor as never).outShape(j.id, "frame");
    };
    expect(cols(await build())).toEqual(["Id:number", "Qty:number", "Note:string"]);
    expect(await build("leftKey")).toBeNull();
    expect(await build("rightKey")).toBeNull();
  });

  it("Split Column drops the typed column, and goes unknown once Column or Delimiter is wired", async () => {
    const s = new SplitColumnNode();
    s.stringLiterals.column = "Region";
    expect(cols(await shapeOf(s, "frame", SALES))).toEqual(["Qty:number", "Price:number"]);
    for (const key of ["column", "delimiter"]) {
      const wired = new SplitColumnNode();
      wired.stringLiterals.column = "Region";
      expect(await wiredConfig(wired, [key]), key).toBeNull();
    }
  });

  it("Add Index names the new column from the card, and goes unknown once Name is wired", async () => {
    expect(cols(await shapeOf(new AddIndexNode(), "frame", SALES)))
      .toEqual(["Index:number", "Region:string", "Qty:number", "Price:number"]);
    expect(await wiredConfig(new AddIndexNode(), ["name"])).toBeNull();
  });
});
