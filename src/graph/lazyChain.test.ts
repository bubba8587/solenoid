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
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "engine_ping": return { name: "solenoid-engine", version: "0.1.0", backend: "polars" };
      case "engine_source": case "engine_apply": case "engine_apply_many":
      case "engine_join": case "engine_append": case "engine_bind_columns":
        return `plf:${++handles}`;
      case "engine_preview": return { schema, rows: [[1, "x"], [2, "y"]], rowCount: BIG, truncated: true };
      case "engine_collect": return columns;
      case "engine_column": return columns[0];
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

async function chain(nodes: ClassicPreset.Node[]) {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  for (const n of nodes) await editor.addNode(n as Schemes["Node"]);
  for (let i = 1; i < nodes.length; i++) {
    await editor.addConnection(new ClassicPreset.Connection(nodes[i - 1], "frame", nodes[i], "frame") as Schemes["Connection"]);
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
    // Every verb node still flushes for its own card preview (the non-negotiable):
    // three verbs → three fused applyMany flushes + three previews. Phase 4 of the
    // lazy-handle plan is what would lower THIS pair.
    expect(calls("engine_apply_many")).toBe(3);
    expect(calls("engine_preview")).toBe(3);
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
