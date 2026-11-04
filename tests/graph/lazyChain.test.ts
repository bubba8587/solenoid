// [[C130]] rustCore, [[C24]] arraySemantics, [[C25]] firstClassUnits, [[compute-pass#Lazy Frames and when they are collected]]
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import { isLazyFrameNode } from "../../src/graph/engineWasm/solenoid_graph.js";
import { FrameInputNode, DistinctNode, FillBlanksNode, SortFrameNode, PivotNode } from "../../src/graph/nodes/frame";
import { TableInfoNode } from "../../src/graph/nodes/matrix";
import { SumIfsNode } from "../../src/graph/nodes/list";
import { WriteFileNode } from "../../src/graph/nodes/sink";
import { SlicerNode } from "../../src/graph/nodes/control";
import { readFrame, isFrameRef } from "../../src/graph/frameBackend";
import { frameStats, planOf } from "./frameRefKit";

beforeEach(() => { frameStats(); });

/** More rows than a card's preview shows, so a preview reads only its first rows: A counts 1..150, B is 0 or 1. */
const ROWS = 150;
const source = () => new FrameInputNode({ frameText: ["A, B", ...Array.from({ length: ROWS }, (_, i) => `${i + 1}, ${i % 2}`)].join("\n") });

async function chain(nodes: GraphNode[], lastKey = "frame") {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  for (const n of nodes) await editor.addNode(n as Schemes["Node"]);
  for (let i = 1; i < nodes.length; i++) {
    const key = i === nodes.length - 1 ? lastKey : "frame";
    await editor.addConnection(new GraphConnection(nodes[i - 1], "frame", nodes[i], key) as Schemes["Connection"]);
  }
  return { out: await engine.fetch(nodes[nodes.length - 1].id), engine };
}

describe("verb chain cost through a real engine", () => {
  it("Distinct → Fill Down → Distinct takes the source in ONCE, runs one op a card and never reads it whole", async () => {
    await chain([source(), new DistinctNode(), new FillBlanksNode(), new DistinctNode()]);
    // Every card previews its frame, each on the card upstream's answer: three plans of one op each.
    expect(frameStats()).toEqual({ runs: 3, ops: 3, taken: 1, collects: 0 });
  });

  it("a full pass over a chain whose inputs stand runs nothing again", async () => {
    const { engine } = await chain([source(), new DistinctNode(), new FillBlanksNode(), new DistinctNode()]);
    frameStats();
    await engine.pass(undefined, undefined, true);
    expect(frameStats()).toEqual({ runs: 0, ops: 0, taken: 0, collects: 0 });
  });
});

describe("LAZY_FRAME_NODES covers every class whose body plans over a ref", () => {
  it("every verb the core dispatches is lazy", () => {
    const src = ["verbs.rs", "backend_verbs.rs", "columns.rs"]
      .map((f) => readFileSync(new URL(`../../crates/solenoid-core/src/nodes/${f}`, import.meta.url), "utf-8")).join("\n");
    const dispatched = [...src.matchAll(/"(\w+Node)"(?: \| "\w+Node")* =>/g)].flatMap((m) => [...m[0].matchAll(/"(\w+Node)"/g)].map((x) => x[1]));
    const verbs = dispatched.filter((c) => c !== "CubeInputNode");
    expect(verbs.length).toBeGreaterThan(20);
    expect(verbs.filter((c) => !isLazyFrameNode(c))).toEqual([]);
  });
});

describe("cheap-primitive consumers on a lazy upstream", () => {
  it("Table Size counts without reading the frame whole", async () => {
    const { out } = await chain([source(), new DistinctNode(), new TableInfoNode()], "matrix");
    expect(out).toEqual({ rows: ROWS, cols: 2 });
    expect(frameStats()).toMatchObject({ collects: 0, taken: 1 });
  });

  it("SUMIFS reads only the named columns", async () => {
    const n = new SumIfsNode({ op: "countifs" });
    n.condConfig["0"] = { op: "notblank" };
    n.stringLiterals.column0 = "A";
    const { out } = await chain([source(), new DistinctNode(), n]);
    expect((out as { result: number }).result).toBe(ROWS);
    expect(frameStats().collects).toBe(0);
  });

  it("Write File holds the ref through data() and reads it whole only at run()", async () => {
    const w = new WriteFileNode({ path: "C:/out/x.csv" });
    await chain([source(), new DistinctNode(), w], "in");
    expect(frameStats().collects).toBe(0);
    expect(w.cachedFrame).toMatchObject({ __frame: true, __totalRows: ROWS });
    const full = await readFrame((w as unknown as { cachedInput: Parameters<typeof readFrame>[0] }).cachedInput);
    expect(full).toMatchObject({ __frame: true });
  });
});

describe("a no-op verb forwards the ref instead of reading it", () => {
  it("Frame Sort with no column answers a ref planning nothing more", async () => {
    const { out } = await chain([source(), new DistinctNode(), new SortFrameNode()]);
    const frame = (out as { frame: unknown }).frame;
    expect(isFrameRef(frame)).toBe(true);
    expect(planOf(frame)).toEqual(["distinct", "drop"]);
    expect(frameStats()).toMatchObject({ collects: 0, taken: 1 });
  });
});

describe("Slicer on a lazy upstream reads one column and filters lazily", () => {
  it("with no selection: forwards the ref (an empty drop)", async () => {
    const s = new SlicerNode();
    const { out } = await chain([source(), new DistinctNode(), s], "frame");
    const result = (out as { result: unknown }).result;
    expect(isFrameRef(result)).toBe(true);
    expect(planOf(result)).toEqual(["distinct", "drop"]);
    expect(frameStats().collects).toBe(0);
    expect(s.cachedColumns).toEqual(["A", "B"]);
    expect(s.cachedUniqueValues).toHaveLength(ROWS);
  });

  it("with a selection: plans the row filter as a filterMulti op", async () => {
    const s = new SlicerNode({ selectedColumn: "A", selectedValues: [1] });
    const { out } = await chain([source(), new DistinctNode(), s], "frame");
    expect(planOf((out as { result: unknown }).result)).toEqual(["distinct", "filterMulti"]);
    // The one read whole is its own one-row answer, which its preview is; the upstream's 150 rows never are.
    expect(frameStats().collects).toBe(1);
  });
});

describe("Pivot on a lazy upstream reads only its field columns", () => {
  it("row field B, value A: no whole read", async () => {
    const p = new PivotNode();
    p.stringLiterals.rowFields = "B";
    p.stringLiterals.values = "A";
    const { out } = await chain([source(), new DistinctNode(), p]);
    const frame = (out as { frame: { columns: { name: string; values: unknown[] }[] } }).frame;
    expect(frame.columns.map((c) => c.name)).toEqual(["B", "A"]);
    expect(frame.columns[0].values).toEqual([0, 1]);
    expect(frame.columns[1].values).toEqual([75 * 75, 75 * 76]);
    expect(frameStats().collects).toBe(0);
    expect(p.sourceColumns.map((c) => c.distinct.length)).toEqual([ROWS, 2]);
  });
});
