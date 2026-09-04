import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "../../src/graph/schemes";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { frameFormatStore } from "../../src/graph/frameFormatStore";
import { fmtCell } from "../../src/graph/components/FrameDisplay";
import {
  FrameInputNode, SortFrameNode, ColumnsNode, ComputedColumnNode, AddIndexNode, AllocatorNode,
} from "../../src/graph/nodes/frame";
import {
  frameSourceToText, frameColumnsToInputText, isFrameValue,
  type FrameColumn, type FrameSource, type FrameValue,
} from "../../src/graph/frame";
import { readFrame } from "../../src/graph/frameBackend";
import { resetFrameBackendToJs, clearCollectMemo } from "../../src/graph/frameBackend";
import type { FormatAnnotation } from "../../src/graph/formatAnnotationStore";
import seed from "../../src/graph/seedGraphs/allocator.json";

const DEC3: FormatAnnotation = { format: "decimal", unit: "none", decimalDigits: 3, decimalMode: "places" };
const DEC0: FormatAnnotation = { format: "decimal", unit: "none", decimalDigits: 0, decimalMode: "places" };

const source = (cols: Array<{ name: string; type: FrameColumn["type"]; cells: string[]; unit?: string }>): string =>
  frameSourceToText(cols as FrameSource);

const frame = (columns: FrameColumn[]): FrameValue => ({ __frame: true, columns });
const col = (f: FrameValue, name: string): FrameColumn => f.columns.find((c) => c.name === name)!;

/** The real pipeline: the coercion wrapper (where the OUTPUT stamp lives) plus the
 *  engine, so a frame arrives at the last node exactly as it does on the canvas. */
async function chain(nodes: ClassicPreset.Node[], lastKey = "frame"): Promise<Record<string, unknown>> {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  for (const n of nodes) await editor.addNode(n as Schemes["Node"]);
  for (let i = 1; i < nodes.length; i++) {
    const key = i === nodes.length - 1 ? lastKey : "frame";
    await editor.addConnection(new ClassicPreset.Connection(nodes[i - 1], "frame", nodes[i], key) as Schemes["Connection"]);
  }
  return engine.fetch(nodes[nodes.length - 1].id) as Promise<Record<string, unknown>>;
}

async function collected(out: Record<string, unknown>): Promise<FrameValue> {
  const f = await readFrame(out.frame as never);
  if (!isFrameValue(f)) throw new Error("not a frame");
  return f;
}

beforeEach(() => { frameFormatStore.clear(); resetFrameBackendToJs(); clearCollectMemo(); });
afterEach(() => { frameFormatStore.clear(); });

// rules formatFlowsDownstream: a frame column's DISPLAY format rides the value like its
// unit — stamped at the producer from that node's own picks, overridden by a nearer one.
describe("a per-column format rides the frame downstream", () => {
  it("survives Sort → Columns and renders through fmtCell", async () => {
    const input = new FrameInputNode({
      frameText: source([
        { name: "A", type: "number", cells: ["2", "1"] },
        { name: "B", type: "number", cells: ["1.23456", "9.87654"] },
      ]),
    });
    frameFormatStore.set(input.id, "B", DEC3);
    const sort = new SortFrameNode();
    sort.stringLiterals.column = "A";
    const keep = new ColumnsNode({ op: "keep" });
    keep.stringLiterals.columns = "B";

    const out = await collected(await chain([input, sort, keep]));
    const b = col(out, "B");
    expect(b.format).toEqual(DEC3);
    expect(fmtCell(b.values[0], b.type, b.format)).toBe("9.877");
  });

  it("a nearer node's own pick overrides the inherited one", async () => {
    const input = new FrameInputNode({
      frameText: source([{ name: "B", type: "number", cells: ["1.23456"] }]),
    });
    frameFormatStore.set(input.id, "B", DEC3);
    const idx = new AddIndexNode();
    frameFormatStore.set(idx.id, "B", DEC0);

    const b = col(await collected(await chain([input, idx])), "B");
    expect(b.format).toEqual(DEC0);
    expect(fmtCell(b.values[0], b.type, b.format)).toBe("1");
  });

  it("an unstamped column keeps whatever arrived; a stamp never touches its siblings", async () => {
    const input = new FrameInputNode({
      frameText: source([
        { name: "A", type: "number", cells: ["1.5"] },
        { name: "B", type: "number", cells: ["2.5"] },
      ]),
    });
    frameFormatStore.set(input.id, "B", DEC3);
    const out = await collected(await chain([input, new SortFrameNode()]));
    expect(col(out, "A").format).toBeUndefined();
    expect(col(out, "B").format).toEqual(DEC3);
  });
});

// The author's report: the Headroom Computed Column's Decimal pick never reached the
// Display fed by it, because each renderer read only its OWN node's entries.
describe("the Allocator seed's Headroom column", () => {
  const hd = seed.nodes.find((n) => n.id === "hd")!;

  it("carries the pick made on the Computed Column to the frame the Display receives", async () => {
    // The join's output the seed feeds `hd`: an Allocation and the price ceiling.
    const input = new FrameInputNode({
      frameText: source([
        { name: "Category", type: "string", cells: ["Car", "Other"] },
        { name: "Allocation", type: "number", cells: ["31250", "18750"] },
        { name: "Max", type: "number", cells: ["40000", "25000"] },
      ]),
    });
    const cc = new ComputedColumnNode(hd.init as ConstructorParameters<typeof ComputedColumnNode>[0]);
    cc.stringLiterals = { ...hd.stringLiterals } as Record<string, string>;
    frameFormatStore.set(cc.id, "Headroom", DEC3);

    const out = await collected(await chain([input, cc]));
    const headroom = col(out, "Headroom");
    expect(headroom.values).toEqual([8750, 6250]);
    expect(headroom.format).toEqual(DEC3);
    expect(fmtCell(headroom.values[0], headroom.type, headroom.format)).toBe("8,750.000");
  });
});

// The unit rule is the precedent: a derived column carries the source column's format
// exactly where `nodes/frame.ts` / `frameVerbs.ts` already carry its unit tag.
describe("a DERIVED column carries the format only where it carries the unit", () => {
  it("Add Index: the index column carries nothing, the existing ones keep theirs", async () => {
    const input = new FrameInputNode({
      frameText: source([{ name: "B", type: "number", cells: ["1.5", "2.5"] }]),
    });
    frameFormatStore.set(input.id, "B", DEC3);
    const idx = new AddIndexNode();
    const out = await collected(await chain([input, idx]));
    expect(col(out, "Index").format).toBeUndefined();
    expect(col(out, "B").format).toEqual(DEC3);
  });

  it("Computed Column: an APPENDED column inherits no format (it inherits no unit either)", async () => {
    const input = new FrameInputNode({
      frameText: source([{ name: "B", type: "number", cells: ["1.5", "2.5"] }]),
    });
    frameFormatStore.set(input.id, "B", DEC3);
    const cc = new ComputedColumnNode({ expr: "@B * 2" });
    cc.stringLiterals = { name: "Doubled", after: "" };
    const out = await collected(await chain([input, cc]));
    expect(col(out, "Doubled").format).toBeUndefined();
    expect(col(out, "B").format).toEqual(DEC3);
  });

  it("Allocator: Allocation takes the Min column's format, as it takes its unit", () => {
    const cats = frame([
      { name: "Category", type: "string", values: ["Car", "Other"] },
      { name: "Min", type: "number", values: [20, 10], format: DEC3 },
      { name: "Max", type: "number", values: [50, 40] },
    ]);
    const n = new AllocatorNode();
    n.literals.amount = 60;
    const out = n.data({ categories: [cats] }).frame as FrameValue;
    expect(col(out, "Allocation").format).toEqual(DEC3);
    expect(col(out, "Share").format).toBeUndefined();
  });
});

// The store stays the ONE persisted home (keyed by node); `format` on a column is
// derived at compute time and must never reach a saved document.
describe("a stamped format is never serialized", () => {
  it("stays out of the frame text form both ways", async () => {
    const input = new FrameInputNode({
      frameText: source([{ name: "B", type: "number", cells: ["1.5"] }]),
    });
    frameFormatStore.set(input.id, "B", DEC3);
    const out = await collected(await chain([input, new SortFrameNode()]));
    expect(col(out, "B").format).toEqual(DEC3);
    expect(frameColumnsToInputText(out.columns)).not.toContain("format");
    expect(input.frameText).not.toContain("format");
  });
});
