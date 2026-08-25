// The IPC cost of a verb CHAIN driven through real node data() calls (editor +
// DataflowEngine + input coercion), not raw runners — polarsBackend.test.ts proves
// fusion for runFrameUnary in isolation; this pins what a graph actually pays.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import type { Schemes } from "./schemes";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { initFrameBackend, resetFrameBackendToJs, clearCollectMemo } from "./frameBackend";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";
import { FrameInputNode, DistinctNode, FillBlanksNode } from "./nodes/frame";

const BIG = 5000;
const schema = [{ name: "A", type: "number" }, { name: "B", type: "string" }];
const columns = [
  { name: "A", type: "number", values: [1, 2] },
  { name: "B", type: "string", values: ["x", "y"] },
];

/** A dispatching engine stub: every command answers by name, so a test only counts. */
function stubEngine() {
  let handles = 0;
  invokeMock.mockImplementation(async (cmd: string, args?: { name?: string }) => {
    switch (cmd) {
      case "engine_ping": return { name: "solenoid-engine", version: "0.1.0", backend: "polars" };
      case "engine_source": case "engine_apply": case "engine_apply_many":
      case "engine_join": case "engine_append": case "engine_bind_columns":
        return `plf:${++handles}`;
      case "engine_preview": return { schema, rows: [[1, "x"], [2, "y"]], rowCount: BIG, truncated: true };
      case "engine_collect": return columns;
      case "engine_column": return columns.find((c) => c.name === args?.name) ?? null;
      default: return null;
    }
  });
}
const calls = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd).length;

beforeEach(async () => {
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invokeMock.mockReset();
  resetFrameBackendToJs();
  stubEngine();
  await initFrameBackend();
  clearCollectMemo();
  invokeMock.mockClear();
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  resetFrameBackendToJs();
});

async function chain(nodes: ClassicPreset.Node[], lastKey = "frame") {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  for (const n of nodes) await editor.addNode(n as Schemes["Node"]);
  for (let i = 1; i < nodes.length; i++) {
    const key = i === nodes.length - 1 ? lastKey : "frame";
    await editor.addConnection(new ClassicPreset.Connection(nodes[i - 1], "frame", nodes[i], key) as Schemes["Connection"]);
  }
  return engine.fetch(nodes[nodes.length - 1].id);
}

describe("verb chain IPC cost through real node data()", () => {
  it("Distinct → Fill Down → Distinct uploads the source ONCE and never collects", async () => {
    await chain([new FrameInputNode(), new DistinctNode(), new FillBlanksNode(), new DistinctNode()]);
    // One upload: a consumer that collected and re-sourced would upload twice.
    expect(calls("engine_source")).toBe(1);
    // Nothing in the chain reads whole rows, so the bridge never collects.
    expect(calls("engine_collect")).toBe(0);
    // Every verb node still flushes for its own card preview (the non-negotiable),
    // but each flush REBASES onto the card upstream's materialized frame: three
    // applyMany calls of ONE op each, chained handle to handle — not three
    // re-runs of a growing prefix.
    expect(calls("engine_preview")).toBe(3);
    const applies = invokeMock.mock.calls.filter((c) => c[0] === "engine_apply_many").map((c) => c[1] as { handle: string; ops: { kind: string }[] });
    expect(applies.map((a) => a.ops.map((o) => o.kind))).toEqual([["distinct"], ["fillBlanks"], ["distinct"]]);
    // The stub numbers handles in creation order: source plf:1, then each flush's
    // output is the NEXT flush's base.
    expect(applies.map((a) => a.handle)).toEqual(["plf:1", "plf:2", "plf:3"]);
  });
});

// Every verb class that emits a ref (calls a runFrame* runner) must be in the lazy
// set, or coerceInputs collects its INPUT and the chain re-sources mid-way — the
// 2026-08-25 finding (BindColumns / FillBlanks / ReplaceValues / Window were missing).
import { readFileSync } from "node:fs";
import { LAZY_FRAME_NODES } from "./coerceInputs";

describe("LAZY_FRAME_NODES covers every ref-emitting verb class", () => {
  it("frame.ts: a class calling runFrame* is lazy", () => {
    const src = readFileSync(new URL("./nodes/frame.ts", import.meta.url), "utf-8");
    const classes = [...src.matchAll(/^export class (\w+) extends ClassicPreset\.Node[\s\S]*?(?=^export class |\Z)/gm)];
    const emitters = classes.filter((m) => /\brunFrame(Unary|Join|Append|BindColumns)\(/.test(m[0])).map((m) => m[1]);
    expect(emitters.length).toBeGreaterThan(10);
    const missing = emitters.filter((c) => !LAZY_FRAME_NODES.has(c));
    expect(missing).toEqual([]);
  });
});

// Consumers that read LESS than the whole frame must not collect it.
import { TableInfoNode } from "./nodes/matrix";
import { SumIfsNode } from "./nodes/list";
import { WriteFileNode } from "./nodes/sink";
import { readFrame } from "./frameBackend";

describe("cheap-primitive consumers on a lazy upstream", () => {
  it("Table Size reads rowCount + schema from a zero-row preview", async () => {
    const info = new TableInfoNode();
    const out = (await chain([new FrameInputNode(), new DistinctNode(), info], "matrix")) as { rows: number; cols: number };
    expect(out).toEqual({ rows: BIG, cols: 2 });
    expect(calls("engine_collect")).toBe(0);
    expect(calls("engine_source")).toBe(1);
  });

  it("SUMIFS fetches only the named columns", async () => {
    const n = new SumIfsNode({ op: "countifs" });
    n.condConfig["0"] = { op: "notblank" };
    n.stringLiterals.column0 = "A";
    const out = (await chain([new FrameInputNode(), new DistinctNode(), n])) as { result: number };
    expect(out.result).toBe(2);
    expect(calls("engine_column")).toBe(1);
    expect(calls("engine_collect")).toBe(0);
  });

  it("Write File holds the ref through data() and collects only at run()", async () => {
    const w = new WriteFileNode({ path: "C:/out/x.csv" });
    await chain([new FrameInputNode(), new DistinctNode(), w], "in");
    expect(calls("engine_collect")).toBe(0);
    expect(w.cachedFrame).toMatchObject({ __frame: true, __totalRows: BIG });
    // run() is desktop-gated and touches disk; the read it would do is readFrame on
    // the held input — exercise that boundary directly.
    const full = await readFrame((w as unknown as { cachedInput: Parameters<typeof readFrame>[0] }).cachedInput);
    expect(full).toMatchObject({ __frame: true });
    expect(calls("engine_collect")).toBe(1);
  });
});

import { SortFrameNode } from "./nodes/frame";
import { isFrameRef } from "./frameBackend";

describe("a no-op verb forwards the ref instead of collecting", () => {
  it("Frame Sort with no column emits a non-owning ref (plan ends in an empty drop)", async () => {
    const out = (await chain([new FrameInputNode(), new DistinctNode(), new SortFrameNode()])) as { frame: unknown };
    expect(isFrameRef(out.frame)).toBe(true);
    const ref = out.frame as { __plan: readonly { kind: string }[] };
    expect(ref.__plan.map((o) => o.kind)).toEqual(["distinct", "drop"]);
    expect(calls("engine_collect")).toBe(0);
    expect(calls("engine_source")).toBe(1);
  });
});

// The Slicer reads ONLY the selected column (for its buttons) off a lazy upstream and
// pushes its row filter as a verb — it must never collect the whole frame.
import { SlicerNode } from "./nodes/control";

describe("Slicer on a lazy upstream reads one column and filters lazily", () => {
  it("with no selection: reads one column for the buttons, forwards the ref (empty drop)", async () => {
    const s = new SlicerNode();
    const out = (await chain([new FrameInputNode(), new DistinctNode(), s], "frame")) as { result: unknown };
    // The card's buttons cost exactly ONE column read; the frame is never collected.
    expect(calls("engine_column")).toBe(1);
    expect(calls("engine_collect")).toBe(0);
    expect(calls("engine_source")).toBe(1);
    expect(isFrameRef(out.result)).toBe(true);
    const ref = out.result as { __plan: readonly { kind: string }[] };
    expect(ref.__plan.map((o) => o.kind)).toEqual(["distinct", "drop"]);
    // Schema (all columns) + the first column's uniques, from the stub.
    expect(s.cachedColumns).toEqual(["A", "B"]);
    expect(s.cachedUniqueValues).toEqual([1, 2]);
  });

  it("with a selection: pushes the row filter as a filterMulti verb, still no collect", async () => {
    const s = new SlicerNode({ selectedColumn: "A", selectedValues: [1] });
    const out = (await chain([new FrameInputNode(), new DistinctNode(), s], "frame")) as { result: unknown };
    expect(calls("engine_column")).toBe(1);
    expect(calls("engine_collect")).toBe(0);
    expect(isFrameRef(out.result)).toBe(true);
    const ref = out.result as { __plan: readonly { kind: string }[] };
    expect(ref.__plan.map((o) => o.kind)).toEqual(["distinct", "filterMulti"]);
  });
});

import { PivotNode } from "./nodes/frame";

describe("Pivot on a lazy upstream fetches only its field columns", () => {
  it("row field B, value A: two engine_column calls, no collect", async () => {
    const p = new PivotNode();
    p.stringLiterals.rowFields = "B";
    p.stringLiterals.values = "A";
    const out = (await chain([new FrameInputNode(), new DistinctNode(), p])) as { frame: { columns: { name: string; values: unknown[] }[] } };
    expect(out.frame.columns.map((c) => c.name)).toEqual(["B", "A"]);
    expect(out.frame.columns[1].values).toEqual([1, 2]);
    expect(calls("engine_column")).toBe(2);
    expect(calls("engine_collect")).toBe(0);
    expect(p.sourceColumns.map((c) => c.distinct.length)).toEqual([2, 2]);
  });
});
