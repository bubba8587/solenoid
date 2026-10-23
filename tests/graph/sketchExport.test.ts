// [[C23]] calcModes
// A write or export reads every row, even while Sketch mode samples the passes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const written: string[] = [];
vi.mock("../../src/graph/fileBridge", async (orig) => ({
  ...(await orig<typeof import("../../src/graph/fileBridge")>()),
  isDesktop: () => true,
  writeTextFilePath: async (_path: string, content: string) => { written.push(content); },
}));

import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";
import type { View } from "../../src/graph/view";
import { useWasmBackend, clearCollectMemo, SKETCH_SAMPLE_ROWS } from "../../src/graph/frameBackend";
import { processGraph, setEditorRefs } from "../../src/graph/process";
import { calcModeStore } from "../../src/graph/calcModeStore";
import { WriteFileNode } from "../../src/graph/nodes/sink";
import { DistinctNode } from "../../src/graph/nodes/frame";
import type { FrameValue } from "../../src/graph/frame";

const rows = SKETCH_SAMPLE_ROWS * 4;
const big: FrameValue = {
  __frame: true,
  columns: [{ name: "n", type: "number", values: Array.from({ length: rows }, (_, i) => i) }],
};

class Src extends GraphNode {
  constructor() { super("Src"); this.addOutput("frame", new GraphOutput(new GraphSocket("s"))); }
  data() { return { frame: big }; }
}

/** Source → Distinct → `sink`, computed once in the current mode. */
async function wire(sink: GraphNode, input: string) {
  const editor = new GraphEditor<Schemes>();
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const src = new Src(), distinct = new DistinctNode();
  for (const n of [src, distinct, sink]) await editor.addNode(n as unknown as Schemes["Node"]);
  await editor.addConnection(new GraphConnection(src, "frame", distinct, "frame") as unknown as Schemes["Connection"]);
  await editor.addConnection(new GraphConnection(distinct, "frame", sink, input) as unknown as Schemes["Connection"]);
  setEditorRefs(editor, engine, { rerenderNode: async () => {} } as unknown as View);
  await processGraph();
}

beforeEach(() => { useWasmBackend(); clearCollectMemo(); written.length = 0; calcModeStore.setMode("sketch"); });
afterEach(() => { calcModeStore.setMode("auto"); });

describe("Write File in Sketch mode", () => {
  it("writes every row of a lazy input the pass sampled", async () => {
    const w = new WriteFileNode({ path: "/tmp/out.csv" });
    w.enabled = true;
    await wire(w, "in");
    expect(w.cachedFrame).toMatchObject({ __totalRows: SKETCH_SAMPLE_ROWS });
    await w.run();
    expect(w.statusMessage).toBe(`${rows} rows written`);
    expect(written[0].trim().split("\n")).toHaveLength(rows + 1);
  });
});
