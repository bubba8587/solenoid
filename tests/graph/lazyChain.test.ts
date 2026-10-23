// [[C130]], [[C24]], [[C25]]
// What a verb CHAIN costs the frame backend when driven through real node data() calls (editor + DataflowEngine +
// input coercion), not raw runners: how often it uploads, flushes, previews and collects.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode } from "../../src/graph/graphModel";
import { DataflowEngine } from "../../src/graph/dataflowEngine";
import type { Schemes } from "../../src/graph/schemes";

import { setFrameBackend, useWasmBackend, clearCollectMemo, type FrameBackend, type FrameHandle } from "../../src/graph/frameBackend";
import { installInputCoercion } from "../../src/graph/coerceInputs";
import { installErrorGuards } from "../../src/graph/errorValue";
import { FrameInputNode, DistinctNode, FillBlanksNode } from "../../src/graph/nodes/frame";
import type { FrameColumn, FrameColType } from "../../src/graph/frame";

const BIG = 5000;
const schema: { name: string; type: FrameColType }[] = [{ name: "A", type: "number" }, { name: "B", type: "string" }];
const columns: FrameColumn[] = [
  { name: "A", type: "number", values: [1, 2] },
  { name: "B", type: "string", values: ["x", "y"] },
];

/** A backend stub that answers every call as if the frame held BIG rows, and logs each call, so a test only counts. */
const log: { method: string; args: unknown[] }[] = [];
function stubBackend(): FrameBackend {
  let handles = 0;
  const next = async () => `h:${++handles}` as FrameHandle;
  const stub: FrameBackend = {
    source: next, apply: next, applyMany: next, join: next, append: next, bindColumns: next,
    preview: async () => ({ schema, rows: [[1, "x"], [2, "y"]], rowCount: BIG, truncated: true }),
    collect: async () => ({ __frame: true, columns }),
    column: async (_h, name) => columns.find((c) => c.name === name) ?? null,
    drop: () => {},
    sample: async (handle) => ({ handle, factor: 1 }),
  };
  return new Proxy(stub, {
    get: (t, k: string) => (...args: unknown[]) => { log.push({ method: k, args }); return (t[k as keyof FrameBackend] as (...a: unknown[]) => unknown)(...args); },
  });
}
const calls = (method: string) => log.filter((c) => c.method === method).length;

beforeEach(() => {
  setFrameBackend(stubBackend());
  clearCollectMemo();
  log.length = 0;
});
afterEach(() => useWasmBackend());

async function chain(nodes: GraphNode[], lastKey = "frame") {
  const editor = new GraphEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  for (const n of nodes) await editor.addNode(n as Schemes["Node"]);
  for (let i = 1; i < nodes.length; i++) {
    const key = i === nodes.length - 1 ? lastKey : "frame";
    await editor.addConnection(new GraphConnection(nodes[i - 1], "frame", nodes[i], key) as Schemes["Connection"]);
  }
  return engine.fetch(nodes[nodes.length - 1].id);
}

describe("verb chain backend cost through real node data()", () => {
  it("Distinct → Fill Down → Distinct uploads the source ONCE and never collects", async () => {
    await chain([new FrameInputNode(), new DistinctNode(), new FillBlanksNode(), new DistinctNode()]);
    // One upload: a consumer that collected and re-sourced would upload twice.
    expect(calls("source")).toBe(1);
    // Nothing in the chain reads whole rows, so the bridge never collects.
    expect(calls("collect")).toBe(0);
    // Every verb node still flushes for its own card preview (the non-negotiable),
    // but each flush REBASES onto the card upstream's materialized frame: three
    // applyMany calls of ONE op each, chained handle to handle — not three
    // re-runs of a growing prefix.
    expect(calls("preview")).toBe(3);
    const applies = log.filter((c) => c.method === "applyMany").map((c) => c.args as [string, { kind: string }[]]);
    expect(applies.map(([, ops]) => ops.map((o) => o.kind))).toEqual([["distinct"], ["fillBlanks"], ["distinct"]]);
    // The stub numbers handles in creation order: the source h:1, then each flush's output is the NEXT flush's base.
    expect(applies.map(([h]) => h)).toEqual(["h:1", "h:2", "h:3"]);
  });
});

// Every verb class that emits a ref (calls a runFrame* runner, or plans its body over refs) must be in the lazy
// set, or coerceInputs collects its INPUT and the chain re-sources mid-way — the
// 2026-08-25 finding (BindColumns / FillBlanks / ReplaceValues / Window were missing).
import { readFileSync } from "node:fs";
import { LAZY_FRAME_NODES } from "../../src/graph/coerceInputs";

describe("LAZY_FRAME_NODES covers every ref-emitting verb class", () => {
  it("frame.ts: a class calling runFrame* is lazy", () => {
    const src = readFileSync(new URL("../../src/graph/nodes/frame.ts", import.meta.url), "utf-8");
    const classes = [...src.matchAll(/^export class (\w+) extends GraphNode[\s\S]*?(?=^export class |\Z)/gm)];
    const emitters = classes.filter((m) => /\b(runFrame(Unary|Join|Append|BindColumns)|lazyPass|lazyFramePass|planOnBody)\(/.test(m[0])).map((m) => m[1]);
    expect(emitters.length).toBeGreaterThan(10);
    const missing = emitters.filter((c) => !LAZY_FRAME_NODES.has(c));
    expect(missing).toEqual([]);
  });
});

// Consumers that read LESS than the whole frame must not collect it.
import { TableInfoNode } from "../../src/graph/nodes/matrix";
import { SumIfsNode } from "../../src/graph/nodes/list";
import { WriteFileNode } from "../../src/graph/nodes/sink";
import { readFrame } from "../../src/graph/frameBackend";

describe("cheap-primitive consumers on a lazy upstream", () => {
  it("Table Size reads rowCount + schema from a zero-row preview", async () => {
    const info = new TableInfoNode();
    const out = (await chain([new FrameInputNode(), new DistinctNode(), info], "matrix")) as { rows: number; cols: number };
    expect(out).toEqual({ rows: BIG, cols: 2 });
    expect(calls("collect")).toBe(0);
    expect(calls("source")).toBe(1);
  });

  it("SUMIFS fetches only the named columns", async () => {
    const n = new SumIfsNode({ op: "countifs" });
    n.condConfig["0"] = { op: "notblank" };
    n.stringLiterals.column0 = "A";
    const out = (await chain([new FrameInputNode(), new DistinctNode(), n])) as { result: number };
    expect(out.result).toBe(2);
    expect(calls("column")).toBe(1);
    expect(calls("collect")).toBe(0);
  });

  it("Write File holds the ref through data() and collects only at run()", async () => {
    const w = new WriteFileNode({ path: "C:/out/x.csv" });
    await chain([new FrameInputNode(), new DistinctNode(), w], "in");
    expect(calls("collect")).toBe(0);
    expect(w.cachedFrame).toMatchObject({ __frame: true, __totalRows: BIG });
    // run() is desktop-gated and touches disk; the read it would do is readFrame on
    // the held input — exercise that boundary directly.
    const full = await readFrame((w as unknown as { cachedInput: Parameters<typeof readFrame>[0] }).cachedInput);
    expect(full).toMatchObject({ __frame: true });
    expect(calls("collect")).toBe(1);
  });
});

import { SortFrameNode } from "../../src/graph/nodes/frame";
import { isFrameRef } from "../../src/graph/frameBackend";

describe("a no-op verb forwards the ref instead of collecting", () => {
  it("Frame Sort with no column emits a non-owning ref (plan ends in an empty drop)", async () => {
    const out = (await chain([new FrameInputNode(), new DistinctNode(), new SortFrameNode()])) as { frame: unknown };
    expect(isFrameRef(out.frame)).toBe(true);
    const ref = out.frame as { __plan: readonly { kind: string }[] };
    expect(ref.__plan.map((o) => o.kind)).toEqual(["distinct", "drop"]);
    expect(calls("collect")).toBe(0);
    expect(calls("source")).toBe(1);
  });
});

// The Slicer reads ONLY the selected column (for its buttons) off a lazy upstream and
// pushes its row filter as a verb — it must never collect the whole frame.
import { SlicerNode } from "../../src/graph/nodes/control";

describe("Slicer on a lazy upstream reads one column and filters lazily", () => {
  it("with no selection: reads one column for the buttons, forwards the ref (empty drop)", async () => {
    const s = new SlicerNode();
    const out = (await chain([new FrameInputNode(), new DistinctNode(), s], "frame")) as { result: unknown };
    // The card's buttons cost exactly ONE column read; the frame is never collected.
    expect(calls("column")).toBe(1);
    expect(calls("collect")).toBe(0);
    expect(calls("source")).toBe(1);
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
    expect(calls("column")).toBe(1);
    expect(calls("collect")).toBe(0);
    expect(isFrameRef(out.result)).toBe(true);
    const ref = out.result as { __plan: readonly { kind: string }[] };
    expect(ref.__plan.map((o) => o.kind)).toEqual(["distinct", "filterMulti"]);
  });
});

import { PivotNode } from "../../src/graph/nodes/frame";

describe("Pivot on a lazy upstream fetches only its field columns", () => {
  it("row field B, value A: two column reads, no collect", async () => {
    const p = new PivotNode();
    p.stringLiterals.rowFields = "B";
    p.stringLiterals.values = "A";
    const out = (await chain([new FrameInputNode(), new DistinctNode(), p])) as { frame: { columns: { name: string; values: unknown[] }[] } };
    expect(out.frame.columns.map((c) => c.name)).toEqual(["B", "A"]);
    expect(out.frame.columns[1].values).toEqual([1, 2]);
    expect(calls("column")).toBe(2);
    expect(calls("collect")).toBe(0);
    expect(p.sourceColumns.map((c) => c.distinct.length)).toEqual([2, 2]);
  });
});
