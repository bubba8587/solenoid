// [[C130]] rustCore, [[C120]] linearWork
// A big frame or list of flat cells crosses the card wire as buffers (`nodes/columnar.rs`, `wireBinary`), both into a
// card and back, and reads exactly as the JSON wire reads it: the same card over the same cells answers the same
// whichever way they crossed (node-bodies.md § The call).
import { describe, it, expect } from "vitest";
import { wireBinary, readBinary, BINARY_MIN_CELLS } from "../../src/graph/nodeWire";
import { nodeOnCore } from "../../src/graph/nodeOnCore";
import { GetColumnNode } from "../../src/graph/nodes/frame";
import { solError } from "../../src/graph/errorValue";
import type { FrameCell, FrameValue } from "../../src/graph/frame";
import { sameJson, enc } from "./coreFixtures";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphInput, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import { ArithmeticNode } from "../../src/graph/nodes/scalar";
import type { Schemes } from "../../src/graph/schemes";

class Src extends GraphNode {
  constructor(public out: unknown) { super("src"); this.addOutput("out", new GraphOutput(new GraphSocket("number"))); }
  data() { return { out: this.out }; }
}
class Sink extends GraphNode {
  got: unknown;
  constructor() { super("sink"); this.addInput("x", new GraphInput(new GraphSocket("any"), "x")); }
  data(i: { x?: unknown[] }) { this.got = i.x?.[0]; return {}; }
}

async function product(a: unknown, b: unknown): Promise<unknown> {
  const editor = new GraphEditor<Schemes>();
  editor.use(new DataflowEngine<Schemes>());
  const x = new Src(a), y = new Src(b), mul = new ArithmeticNode({ op: "mul" }), sink = new Sink();
  for (const n of [x, y, mul, sink]) await editor.addNode(n as never);
  await editor.addConnection(new GraphConnection(x, "out", mul, "a") as never);
  await editor.addConnection(new GraphConnection(y, "out", mul, "b") as never);
  await editor.addConnection(new GraphConnection(mul, "result", sink, "x") as never);
  await editor.engine!.pass(undefined, undefined, false);
  editor.dispose();
  return sink.got;
}

const ODD: FrameCell[] = [0, -0, 1.5, NaN, Infinity, -Infinity, 1e308, "", " a ", "é😀", "x\u0000y", true, false, null,
  solError("#N/A", "missing"), solError("#DIV/0!", "")];
const cellAt = (i: number) => ODD[i % ODD.length];

function frame(rows: number): FrameValue {
  return { __frame: true, columns: [
    { name: "n", type: "number", values: Array.from({ length: rows }, (_, i) => cellAt(i)), unit: { dim: { length: 1 }, display: "km" }, format: null as never },
    { name: "t", type: "string", values: Array.from({ length: rows }, (_, i) => cellAt(i + 3)), raw: Array.from({ length: rows }, (_, i) => `r${i}`) },
    { name: "d", type: "date", values: Array.from({ length: rows }, (_, i) => 45000 + i) },
  ], __totalRows: rows * 3 };
}

describe("the card wire's buffers", () => {
  it("read back what they carry, frame and list", () => {
    const f = frame(200);
    const b = wireBinary(f)!;
    expect(b[0]).toBe("frame");
    expect(sameJson(enc(readBinary(b[0] as string, b[1] as string, b[2] as Uint8Array, b[3] as Float64Array, b[4] as string, b[5] as Uint32Array)), enc(f))).toBe(true);
    const list = Array.from({ length: 300 }, (_, i) => cellAt(i));
    const l = wireBinary(list)!;
    expect(sameJson(enc(readBinary("list", undefined, l[2] as Uint8Array, l[3] as Float64Array, l[4] as string, l[5] as Uint32Array)), enc(list))).toBe(true);
  });

  it("leave small values, nested cells and errors with an origin to JSON", () => {
    expect(wireBinary(Array.from({ length: BINARY_MIN_CELLS - 1 }, () => 1))).toBeUndefined();
    expect(wireBinary([...Array.from({ length: 100 }, () => 1), [1, 2]])).toBeUndefined();
    expect(wireBinary(Array.from({ length: 100 }, () => ({ ...solError("#N/A", "x"), origin: { nodeId: "a" } })))).toBeUndefined();
  });

  it("answer as JSON does, into a card and back", () => {
    const big = frame(400);
    const card = new GetColumnNode({ readAs: "text" });
    card.stringLiterals.name = "t";
    const whole = nodeOnCore(card, { frame: [big] }).values as unknown[];
    const sliced: unknown[] = [];
    for (let at = 0; at < 400; at += 10) {
      const part: FrameValue = { ...big, columns: big.columns.map((c) => ({ ...c, values: c.values.slice(at, at + 10), ...(c.raw ? { raw: c.raw.slice(at, at + 10) } : {}) })) };
      sliced.push(...(nodeOnCore(card, { frame: [part] }).values as unknown[]));
    }
    expect(whole).toHaveLength(400);
    expect(sameJson(enc(whole), enc(sliced))).toBe(true);
  });

  it("answer as JSON does between a direct card and a JavaScript one", async () => {
    // The odd cells' errors take the card's origin on the way out, so that answer crosses back as JSON; the numbers'
    // crosses as buffers.
    for (const nums of [Array.from({ length: 640 }, (_, i) => cellAt(i)), Array.from({ length: 640 }, (_, i) => [0, -0, 1.5, 12345.678, -7][i % 5])]) {
      const whole = await product(nums, 2) as unknown[];
      const sliced: unknown[] = [];
      for (let at = 0; at < nums.length; at += 16) sliced.push(...(await product(nums.slice(at, at + 16), 2) as unknown[]));
      expect(whole).toHaveLength(640);
      expect(sameJson(enc(whole), enc(sliced))).toBe(true);
    }
  });
});
