// [[C24]] arraySemantics, [[C44]] dateSerials, [[C45]]
// PolarsBackend wiring: each method is one `invoke` with the right command name
// and arg shape. We can't run the native engine in the node test env, so we mock
// `@tauri-apps/api/core`'s `invoke` and assert the calls. `isDesktop()` is forced
// on via the same global the desktop shell sets.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FrameValue } from "../../src/graph/frame";
import type { FrameOp, JoinOpts } from "../../src/graph/frameVerbs";

// The invoke spy — ipcBridge imports `@tauri-apps/api/core` lazily inside
// ipcInvoke, so the mock must be registered before that dynamic import runs.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { frameBackend, initFrameBackend, resetFrameBackendToJs, runFrameUnary, readFrame, collectPreview, clearCollectMemo, isFrameRef } from "../../src/graph/frameBackend";
import { solError } from "../../src/graph/errorValue";
import { READINGS_ADD, READINGS_SCALE } from "../../src/graph/unitValue";
import { ZERO_GROUP_TOTAL } from "../../src/graph/frameVerbs";

// Force the desktop guard on (engineAvailable() === isDesktop(), which reads
// window.__TAURI_INTERNALS__), and start each test from the default JS backend.
beforeEach(() => {
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invokeMock.mockReset();
  resetFrameBackendToJs();
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  resetFrameBackendToJs();
});

const sample: FrameValue = {
  __frame: true,
  columns: [
    { name: "n", type: "number", values: [1, 2, 3] },
    { name: "s", type: "string", values: ["a", "b", "c"] },
  ],
};

/** Ping resolves to `backend`, then install the backend via initFrameBackend. */
async function initWith(backend: string): Promise<void> {
  invokeMock.mockResolvedValueOnce({ name: "solenoid-engine", version: "0.1.0", backend });
  await initFrameBackend();
}

describe("PolarsBackend — selection at startup", () => {
  it("installs PolarsBackend when the engine reports 'polars'", async () => {
    await initWith("polars");
    invokeMock.mockResolvedValueOnce("plf:1");
    const h = await frameBackend().source(sample);
    expect(h).toBe("plf:1");
    const sourceCall = invokeMock.mock.calls.find((c) => c[0] === "engine_source");
    expect(sourceCall![1]).toEqual({
      frame: {
        columns: [
          { name: "n", type: "number", values: [1, 2, 3] },
          { name: "s", type: "string", values: ["a", "b", "c"] },
        ],
      },
    });
  });

  it("does NOT swap when the engine reports a non-polars backend", async () => {
    await initWith("none");
    invokeMock.mockClear();
    const h = await frameBackend().source(sample);
    expect(String(h).startsWith("jsf:")).toBe(true);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("PolarsBackend — verb command shapes", () => {
  beforeEach(async () => {
    await initWith("polars");
    invokeMock.mockClear();
  });

  it("apply → engine_apply { handle, op }", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:2");
    const h = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:3");
    const op: FrameOp = { kind: "select", columns: ["n"] };
    await be.apply(h, op);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_apply");
    expect(call![1]).toEqual({ handle: h, op });
  });

  it("join → engine_join { left, right, opts }", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:L");
    const l = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:R");
    const r = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:J");
    const opts: JoinOpts = { leftKey: "n", rightKey: "n", how: "inner" };
    await be.join(l, r, opts);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_join");
    expect(call![1]).toEqual({ left: l, right: r, opts });
  });

  it("join → an asof `how` forwards asofDirection/asofTolerance through the same opts shape", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:L");
    const l = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:R");
    const r = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:J");
    const opts: JoinOpts = { leftKey: "n", rightKey: "n", how: "asof", asofDirection: "nearest", asofTolerance: 2 };
    await be.join(l, r, opts);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_join");
    expect(call![1]).toEqual({ left: l, right: r, opts });
  });

  it("join → keys in two units send the transform the join corpus's `unit keys` cases pin", async () => {
    const { columnUnitFromSpec } = await import("../../src/graph/unitColumn");
    const keyed = (spec: string): FrameValue => ({ __frame: true, columns: [{ name: "d", type: "number", values: [1], unit: columnUnitFromSpec(spec)! }] });
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:L");
    const l = await be.source(keyed("km"));
    invokeMock.mockResolvedValueOnce("plf:R");
    const r = await be.source(keyed("m"));
    invokeMock.mockResolvedValueOnce("plf:J");
    await be.join(l, r, { leftKey: "d", rightKey: "d", how: "inner" });
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_join");
    expect((call![1] as { opts: JoinOpts }).opts).toEqual({ leftKey: "d", rightKey: "d", how: "inner", rightKeyScale: 0.001, rightKeyOffset: 0 });
  });

  it("append → engine_append { handles }", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:A");
    const a = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:B");
    const b = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:AB");
    await be.append([a, b]);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_append");
    expect(call![1]).toEqual({ handles: [a, b] });
  });

  it("preview → engine_preview { handle, n } and returns the preview", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:P");
    const h = await be.source(sample);
    const preview = { schema: [{ name: "n", type: "number" }], rows: [[1]], rowCount: 3, truncated: true };
    invokeMock.mockResolvedValueOnce(preview);
    const got = await be.preview(h, 1);
    expect(got).toEqual(preview);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_preview");
    expect(call![1]).toEqual({ handle: h, n: 1 });
  });

  it("collect → engine_collect { handle }, wraps columns in a FrameValue", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:K");
    const h = await be.source(sample);
    invokeMock.mockResolvedValueOnce([
      { name: "n", type: "number", values: [1, 2, 3] },
      { name: "s", type: "string", values: ["a", "b", "c"] },
    ]);
    const got = await be.collect(h);
    expect(got.__frame).toBe(true);
    expect(got.columns).toHaveLength(2);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_collect");
    expect(call![1]).toEqual({ handle: h });
  });

  it("column → engine_column { handle, name }", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:C");
    const h = await be.source(sample);
    invokeMock.mockResolvedValueOnce({ name: "s", type: "string", values: ["a", "b", "c"] });
    const col = await be.column(h, "s");
    expect(col?.values).toEqual(["a", "b", "c"]);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_column");
    expect(call![1]).toEqual({ handle: h, name: "s" });
  });

  it("drop → engine_drop { handle }, fire-and-forget (swallows rejection)", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:D");
    const h = await be.source(sample);
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    expect(() => be.drop(h)).not.toThrow();
    // drop is fire-and-forget: its invoke fires after the lazy `import()` resolves.
    await vi.waitFor(() => {
      expect(invokeMock.mock.calls.find((c) => c[0] === "engine_drop")).toBeTruthy();
    });
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_drop");
    expect(call![1]).toEqual({ handle: h });
  });

  it("applyMany → engine_apply_many { handle, ops }", async () => {
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:E");
    const h = await be.source(sample);
    invokeMock.mockResolvedValueOnce("plf:F");
    const ops: FrameOp[] = [{ kind: "select", columns: ["n"] }, { kind: "head", n: 2 }];
    await be.applyMany(h, ops);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_apply_many");
    expect(call![1]).toEqual({ handle: h, ops });
  });
});

// ─── Verb-chain fusion: chaining runFrameUnary never round-trips per verb — the
// plan accumulates on the FrameRef (frameBackend.ts's `extendRef`) and is sent
// as ONE `engine_apply_many` only at a materialization boundary (`readFrame` /
// `collectPreview`). This is the Bet-1 "compile/fuse" IPC-count claim, measured
// directly (not eyeballed): a 3-verb chain costs ONE apply-family round trip,
// not three, and the per-node preview invariant (the one non-negotiable) still
// renders the correctly fused result at ANY point in the chain.
describe("PolarsBackend — verb chain fusion (applyMany batching)", () => {
  beforeEach(async () => {
    await initWith("polars");
    invokeMock.mockClear();
    clearCollectMemo();
  });

  it("3 chained runFrameUnary calls make ZERO apply round trips until readFrame flushes once", async () => {
    invokeMock.mockResolvedValueOnce("plf:src"); // engine_source
    let ref = await runFrameUnary(sample, { kind: "select", columns: ["n", "s"] });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    ref = await runFrameUnary(ref, { kind: "sort", by: "n", dir: "desc" });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    ref = await runFrameUnary(ref, { kind: "head", n: 2 });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    expect(ref.__plan).toHaveLength(3);

    // Chaining alone: only the source upload happened — no apply/applyMany yet.
    const applyCallsSoFar = invokeMock.mock.calls.filter((c) => c[0] === "engine_apply" || c[0] === "engine_apply_many");
    expect(applyCallsSoFar).toHaveLength(0);

    invokeMock.mockResolvedValueOnce("plf:fused"); // engine_apply_many (the ONE flush)
    invokeMock.mockResolvedValueOnce([
      { name: "n", type: "number", values: [3, 2] },
      { name: "s", type: "string", values: ["c", "b"] },
    ]); // engine_collect
    const out = await readFrame(ref);
    expect(out).toEqual({
      __frame: true,
      columns: [
        { name: "n", type: "number", values: [3, 2] },
        { name: "s", type: "string", values: ["c", "b"] },
      ],
    });

    const applyManyCalls = invokeMock.mock.calls.filter((c) => c[0] === "engine_apply_many");
    expect(applyManyCalls).toHaveLength(1); // ONE round trip for all 3 verbs, not 3
    expect(applyManyCalls[0][1]).toEqual({
      handle: "plf:src",
      ops: [
        { kind: "select", columns: ["n", "s"] },
        { kind: "sort", by: "n", dir: "desc" },
        { kind: "head", n: 2 },
      ],
    });
    expect(invokeMock.mock.calls.filter((c) => c[0] === "engine_apply")).toHaveLength(0);
  });

  it("a card preview mid-chain still flushes and renders the fused result (the non-negotiable invariant)", async () => {
    invokeMock.mockResolvedValueOnce("plf:src");
    let ref = await runFrameUnary(sample, { kind: "select", columns: ["n"] });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    ref = await runFrameUnary(ref, { kind: "sort", by: "n", dir: "asc" });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");

    invokeMock.mockResolvedValueOnce("plf:fused2"); // engine_apply_many for THIS node's preview
    invokeMock.mockResolvedValueOnce({
      schema: [{ name: "n", type: "number" }],
      rows: [[1], [2]],
      rowCount: 5,
      truncated: true, // big frame: preview shows a head-N, no extra full collect
    });
    const preview = await collectPreview(ref);
    expect(preview).toMatchObject({
      __frame: true,
      columns: [{ name: "n", type: "number", values: [1, 2] }],
      __totalRows: 5,
    });
    // ONE apply_many for the flush, no engine_collect (the preview didn't need it).
    expect(invokeMock.mock.calls.filter((c) => c[0] === "engine_apply_many")).toHaveLength(1);
    expect(invokeMock.mock.calls.filter((c) => c[0] === "engine_collect")).toHaveLength(0);
  });
});

describe("PolarsBackend — the non-finite wire sentinel + aggregate guard (B-1b)", () => {
  beforeEach(async () => {
    await initWith("polars");
    invokeMock.mockClear();
    clearCollectMemo();
  });

  it("source ENCODES non-finite numbers and SolError cells as tagged sentinels", async () => {
    const withNf: FrameValue = {
      __frame: true,
      columns: [{ name: "v", type: "number", values: [1, Infinity, -Infinity, NaN, solError("#DIV/0!", "x")] }],
    };
    invokeMock.mockResolvedValueOnce("plf:nf");
    await frameBackend().source(withNf);
    const call = invokeMock.mock.calls.find((c) => c[0] === "engine_source");
    expect(call?.[1]).toEqual({
      frame: { columns: [{ name: "v", type: "number", values: [1, { __nf: "inf" }, { __nf: "-inf" }, { __nf: "nan" }, { __err: "#DIV/0!", ref: expect.any(Number) }] }] },
    });
  });

  it("an uploaded error cell comes back as the same SolError, message and origin kept", async () => {
    const err = { ...solError("#N/A", "no match for 7"), origin: { nodeId: "n1", nodeName: "Lookup", rowIndex: 2 } };
    invokeMock.mockResolvedValueOnce("plf:src");
    const ref = await runFrameUnary({ __frame: true, columns: [{ name: "v", type: "number", values: [1, err] }] }, { kind: "sort", by: "v", dir: "desc" });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    const sent = invokeMock.mock.calls.find((c) => c[0] === "engine_source")![1] as { frame: { columns: { values: { ref?: number }[] }[] } };
    const wireRef = sent.frame.columns[0].values[1].ref;
    invokeMock.mockResolvedValueOnce("plf:f");
    invokeMock.mockResolvedValueOnce([{ name: "v", type: "number", values: [1, { __err: "#N/A", ref: wireRef }] }]);
    const out = await readFrame(ref) as FrameValue;
    expect(out.columns[0].values[1]).toBe(err);
  });

  it("a frame with an error cell in a text or logical column computes on the oracle", async () => {
    const be = frameBackend();
    const textErr: FrameValue = { __frame: true, columns: [
      { name: "k", type: "number", values: [2, 1] },
      { name: "s", type: "string", values: ["a", solError("#N/A", "x")] },
    ] };
    const h = await be.source(textErr);
    expect(String(h).startsWith("jsf:")).toBe(true);
    const sorted = await be.apply(h, { kind: "sort", by: "k", dir: "asc" });
    expect((await be.collect(sorted)).columns[1].values[0]).toMatchObject({ code: "#N/A" });
    expect(invokeMock).not.toHaveBeenCalled();
    invokeMock.mockResolvedValueOnce("plf:R");
    const right = await be.source({ __frame: true, columns: [{ name: "k", type: "number", values: [1] }, { name: "v", type: "number", values: [10] }] });
    invokeMock.mockResolvedValueOnce([{ name: "k", type: "number", values: [1] }, { name: "v", type: "number", values: [10] }]);
    const joined = await be.join(h, right, { leftKey: "k", rightKey: "k", how: "inner" });
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(["engine_source", "engine_collect"]);
    const out = await be.collect(joined);
    expect(out.columns.map((c) => c.values)).toEqual([[1], [expect.objectContaining({ code: "#N/A" })], [10]]);
  });

  it("collect DECODES the sentinel back to Infinity/NaN (no more silent null)", async () => {
    invokeMock.mockResolvedValueOnce("plf:src"); // engine_source
    const ref = await runFrameUnary(sample, { kind: "select", columns: ["n"] });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    invokeMock.mockResolvedValueOnce("plf:f"); // apply_many
    invokeMock.mockResolvedValueOnce([{ name: "n", type: "number", values: [{ __nf: "inf" }, { __nf: "nan" }, 2] }]); // collect
    const out = await readFrame(ref);
    expect(out).toMatchObject({ columns: [{ name: "n", values: [Infinity, NaN, 2] }] });
  });

  it("an engine error cell decodes with the oracle's message for its reason", async () => {
    invokeMock.mockResolvedValueOnce("plf:src");
    const ref = await runFrameUnary(sample, { kind: "select", columns: ["n"] });
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    invokeMock.mockResolvedValueOnce("plf:f");
    invokeMock.mockResolvedValueOnce([{ name: "n", type: "number", values: [
      { __err: "#UNIT!", why: "readings_add" }, { __err: "#UNIT!", why: "readings_scale" },
      { __err: "#DIV/0!", why: "zero_total" }, { __err: "#DOMAIN!" },
    ] }]);
    const out = await readFrame(ref) as FrameValue;
    const messages = out.columns[0].values.map((v) => (v as { message?: string }).message);
    expect(messages).toEqual([READINGS_ADD, READINGS_SCALE, ZERO_GROUP_TOTAL, "from the native engine"]);
  });

  it("a groupBy ±Inf result from an ALL-FINITE base column classifies as #OVERFLOW! (one extra column fetch)", async () => {
    invokeMock.mockResolvedValueOnce("plf:src");
    const ref = await runFrameUnary(sample, {
      kind: "groupBy", keys: ["s"], aggs: [{ column: "n", op: "sum", as: "total" }],
    } as FrameOp);
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    invokeMock.mockResolvedValueOnce("plf:agg");                                    // apply_many
    invokeMock.mockResolvedValueOnce([                                              // collect
      { name: "s", type: "string", values: ["a"] },
      { name: "total", type: "number", values: [{ __nf: "inf" }] },
    ]);
    invokeMock.mockResolvedValueOnce({ name: "n", type: "number", values: [1e308, 1e308] }); // engine_column base scan
    const out = await readFrame(ref);
    if (out == null || isSolErrorLike(out)) throw new Error("expected a frame");
    const cell = (out as FrameValue).columns[1].values[0];
    expect(isSolErrorLike(cell) && (cell as { code: string }).code).toBe("#OVERFLOW!");
    expect(invokeMock.mock.calls.filter((c) => c[0] === "engine_column")).toHaveLength(1);
  });

  it("a groupBy ∞ result PASSES when the base column itself carried ∞ (SUM of ∞ is ∞)", async () => {
    invokeMock.mockResolvedValueOnce("plf:src");
    const ref = await runFrameUnary(sample, {
      kind: "groupBy", keys: ["s"], aggs: [{ column: "n", op: "sum", as: "total" }],
    } as FrameOp);
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    invokeMock.mockResolvedValueOnce("plf:agg2");
    invokeMock.mockResolvedValueOnce([
      { name: "s", type: "string", values: ["a"] },
      { name: "total", type: "number", values: [{ __nf: "inf" }] },
    ]);
    invokeMock.mockResolvedValueOnce({ name: "n", type: "number", values: [{ __nf: "inf" }, 5] }); // base scan (decoded → ∞)
    const out = await readFrame(ref);
    expect((out as FrameValue).columns[1].values[0]).toBe(Infinity);
  });

  it("a finite groupBy result costs NO extra column fetch (the guard is lazy)", async () => {
    invokeMock.mockResolvedValueOnce("plf:src");
    const ref = await runFrameUnary(sample, {
      kind: "groupBy", keys: ["s"], aggs: [{ column: "n", op: "sum", as: "total" }],
    } as FrameOp);
    if (!isFrameRef(ref)) throw new Error("expected a FrameRef");
    invokeMock.mockResolvedValueOnce("plf:agg3");
    invokeMock.mockResolvedValueOnce([
      { name: "s", type: "string", values: ["a"] },
      { name: "total", type: "number", values: [6] },
    ]);
    const out = await readFrame(ref);
    expect((out as FrameValue).columns[1].values[0]).toBe(6);
    expect(invokeMock.mock.calls.filter((c) => c[0] === "engine_column")).toHaveLength(0);
  });
});

// Local structural check (this file avoids importing errorValue's guards
// directly to keep the mock surface minimal).
function isSolErrorLike(v: unknown): boolean {
  return !!v && typeof v === "object" && "__solError" in (v as object);
}

describe("PolarsBackend — units and formats survive a native verb ([[C25]] firstClassUnits)", () => {
  beforeEach(async () => {
    await initWith("polars");
    invokeMock.mockClear();
  });

  it("a column's unit comes back on collect, column and preview, as the JS oracle keeps it", async () => {
    const { columnUnitFromSpec } = await import("../../src/graph/unitColumn");
    const km = columnUnitFromSpec("km")!;
    const withUnit: FrameValue = { __frame: true, columns: [{ name: "d", type: "number", values: [3, 1], unit: km }, sample.columns[1]] };
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:1");
    const src = await be.source(withUnit);
    invokeMock.mockResolvedValueOnce("plf:2");
    const sorted = await be.apply(src, { kind: "sort", by: "d", dir: "asc" });
    // The wire answers bare columns, as the native engine does.
    invokeMock.mockResolvedValueOnce([{ name: "d", type: "number", values: [1, 3] }, { name: "s", type: "string", values: ["b", "a"] }]);
    const f = await be.collect(sorted);
    expect(f.columns[0].unit?.display).toBe("km");
    expect(f.columns[1].unit).toBeUndefined();
    invokeMock.mockResolvedValueOnce({ name: "d", type: "number", values: [1, 3] });
    expect((await be.column(sorted, "d"))?.unit?.display).toBe("km");
    invokeMock.mockResolvedValueOnce({ schema: [{ name: "d", type: "number" }], rows: [[1]], rowCount: 2, truncated: true });
    expect((await be.preview(sorted, 1)).schema[0].unit?.display).toBe("km");
  });

  it("a native column whose type differs from the schema gets no unit", async () => {
    const { columnUnitFromSpec } = await import("../../src/graph/unitColumn");
    const withUnit: FrameValue = { __frame: true, columns: [{ name: "d", type: "number", values: [3], unit: columnUnitFromSpec("km")! }] };
    const be = frameBackend();
    invokeMock.mockResolvedValueOnce("plf:1");
    const src = await be.source(withUnit);
    invokeMock.mockResolvedValueOnce([{ name: "d", type: "string", values: ["3"] }]);
    expect((await be.collect(src)).columns[0].unit).toBeUndefined();
  });
});
