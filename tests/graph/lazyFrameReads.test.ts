// [[C16]] polarsEngine
// Readers on a lazy upstream answer as they do on the same frame held eagerly.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runFrameUnary, resetFrameBackendToJs, clearCollectMemo, readFrame, frameBackend, setFrameBackend, SKETCH_SAMPLE_ROWS, type FrameRef, type FrameBackend, type FrameHandle } from "../../src/graph/frameBackend";
import { calcModeStore } from "../../src/graph/calcModeStore";
import { SumIfsNode } from "../../src/graph/nodes/list";
import { GetColumnNode, PivotNode } from "../../src/graph/nodes/frame";
import { SlicerNode } from "../../src/graph/nodes/control";
import type { FrameValue } from "../../src/graph/frame";

const abc: FrameValue = {
  __frame: true,
  columns: [
    { name: "A", type: "number", values: [1, 2] },
    { name: "B", type: "number", values: [10, 20] },
    { name: "C", type: "number", values: [100, 200] },
  ],
};

beforeEach(() => { resetFrameBackendToJs(); clearCollectMemo(); });

describe("SUMIFS resolves a positional column against the upstream frame", () => {
  const sumifs = async (cond: string, values: string, lazy: boolean) => {
    const n = new SumIfsNode({ op: "sumifs" });
    n.condConfig["0"] = { op: "notblank" };
    n.stringLiterals.column0 = cond;
    n.stringLiterals.values = values;
    const frame = lazy ? await runFrameUnary(abc, { kind: "distinct" }) : abc;
    return (await n.data({ frame: [frame] } as never)).result;
  };

  it.each([["C", "1", 3], ["3", "A", 3], ["2", "3", 300]])("condition %s, values %s", async (cond, values, want) => {
    expect(await sumifs(cond, values, false)).toBe(want);
    expect(await sumifs(cond, values, true)).toBe(want);
  });
});

describe("one-column readers downstream of GROUPBY scale as the GROUPBY card does (Sketch)", () => {
  const rows = SKETCH_SAMPLE_ROWS * 4;
  const big: FrameValue = {
    __frame: true,
    columns: [
      { name: "k", type: "string", values: Array.from({ length: rows }, () => "x") },
      { name: "qty", type: "number", values: Array.from({ length: rows }, () => 1) },
    ],
  };
  const grouped = async () => (await runFrameUnary(big, { kind: "groupBy", keys: ["k"], aggs: [{ column: "qty", op: "sum", as: "total" }] })) as FrameRef;

  beforeEach(() => { calcModeStore.setMode("sketch"); });
  afterEach(() => { calcModeStore.setMode("auto"); });

  it("the GROUPBY card itself reads the scaled total", async () => {
    const f = await readFrame(await grouped());
    expect((f as FrameValue).columns[1].values).toEqual([rows]);
  });

  it("SUMIFS", async () => {
    const n = new SumIfsNode({ op: "sumifs" });
    n.condConfig["0"] = { op: "notblank" };
    n.stringLiterals.column0 = "k";
    n.stringLiterals.values = "total";
    expect((await n.data({ frame: [await grouped()] } as never)).result).toBe(rows);
  });

  it("Get Column", async () => {
    const n = new GetColumnNode();
    n.stringLiterals.name = "total";
    expect((await n.data({ frame: [await grouped()] } as never)).values).toEqual([rows]);
  });

  it("Pivot", async () => {
    const n = new PivotNode();
    const out = (await n.data({ frame: [await grouped()], rowFields: [["k"]], values: [["total"]] })).frame as FrameValue;
    expect(out.columns[1].values).toEqual([rows]);
  });

  it("Slicer", async () => {
    const n = new SlicerNode({ selectedColumn: "total" });
    await n.data({ frame: [await grouped()] });
    expect(n.cachedUniqueValues).toEqual([rows]);
  });
});

describe("Pivot on a lazy upstream keeps the newest pass", () => {
  it("a slow older pass does not overwrite a newer one", async () => {
    const js = frameBackend();
    const slow = new Set<FrameHandle>();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setFrameBackend(new Proxy(js, {
      get(t, k) {
        if (k === "applyMany") return async (h: FrameHandle, ops: Parameters<FrameBackend["applyMany"]>[1]) => {
          const out = await t.applyMany(h, ops);
          if (ops[0]?.kind === "distinct") slow.add(out);
          return out;
        };
        if (k === "column") return async (h: FrameHandle, n: string) => {
          if (slow.has(h)) await gate;
          return t.column(h, n);
        };
        const v = Reflect.get(t, k) as unknown;
        return typeof v === "function" ? v.bind(t) : v;
      },
    }) as FrameBackend);
    const older = (await runFrameUnary(abc, { kind: "distinct" })) as FrameRef;
    const newer = (await runFrameUnary(abc, { kind: "sort", by: "A", dir: "desc" })) as FrameRef;
    const p = new PivotNode();
    const inputs = { rowFields: [["A"]], values: [["B"]] };
    const first = p.data({ frame: [older], ...inputs });
    await p.data({ frame: [newer], ...inputs });
    const want = p.cachedResult;
    expect((want as FrameValue).columns[0].values).toEqual([2, 1]);
    release();
    await first;
    expect(p.cachedResult).toBe(want);
  });
});
