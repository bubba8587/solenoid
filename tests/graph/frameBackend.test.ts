import { describe, it, expect } from "vitest";
import { frameBackend, framePreview, materialize, type FrameHandle } from "../../src/graph/frameBackend";
import { isSolError, solError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";

const sample: FrameValue = {
  __frame: true,
  columns: [
    { name: "n", type: "number", values: [1, 2, 3, 4, 5] },
    { name: "s", type: "string", values: ["a", "b", "c", "d", "e"] },
  ],
};

describe("framePreview — head-N shaping", () => {
  it("returns schema, head rows, true row count, and the truncated flag", () => {
    const p = framePreview(sample, 2);
    expect(p.schema).toEqual([
      { name: "n", type: "number" },
      { name: "s", type: "string" },
    ]);
    expect(p.rows).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(p.rowCount).toBe(5);
    expect(p.truncated).toBe(true);
  });

  it("is not truncated when n covers every row", () => {
    const p = framePreview(sample, 100);
    expect(p.rows).toHaveLength(5);
    expect(p.truncated).toBe(false);
  });

  it("pads a short column with null", () => {
    const ragged: FrameValue = {
      __frame: true,
      columns: [
        { name: "a", type: "number", values: [1, 2, 3] },
        { name: "b", type: "number", values: [9] }, // shorter
      ],
    };
    const p = framePreview(ragged, 3);
    expect(p.rowCount).toBe(3);
    expect(p.rows).toEqual([[1, 9], [2, null], [3, null]]);
  });
});

describe("JsFrameBackend — handle lifecycle + materialization", () => {
  it("source → preview round-trips through a handle", async () => {
    const be = frameBackend();
    const h = await be.source(sample);
    const p = await be.preview(h, 2);
    expect(p.rowCount).toBe(5);
    expect(p.rows[0]).toEqual([1, "a"]);
  });

  it("collect materializes the WHOLE frame back (every row)", async () => {
    const be = frameBackend();
    const h = await be.source(sample);
    const got = await be.collect(h);
    expect(got.__frame).toBe(true);
    expect(got.columns).toEqual(sample.columns);
  });

  it("column materializes one column back as an eager typed list", async () => {
    const be = frameBackend();
    const h = await be.source(sample);
    const col = await be.column(h, "s");
    expect(col?.type).toBe("string");
    expect(col?.values).toEqual(["a", "b", "c", "d", "e"]);
    expect(await be.column(h, "missing")).toBeNull();
  });

  it("drop frees the handle — a later materialize is a #REF!", async () => {
    const be = frameBackend();
    const h = await be.source(sample);
    be.drop(h);
    const err = await be.preview(h, 1).catch((e) => e);
    if (!isSolError(err)) throw new Error("expected a SolError after drop");
    expect(err.code).toBe("#REF!");
  });

  it("an unknown handle materializes to #REF!", async () => {
    const be = frameBackend();
    const err = await be.column("jsf:does-not-exist" as FrameHandle, "n").catch((e) => e);
    if (!isSolError(err)) throw new Error("expected a SolError for an unknown handle");
    expect(err.code).toBe("#REF!");
  });

  it("drop is a safe no-op on an unknown handle", () => {
    expect(() => frameBackend().drop("jsf:nope" as FrameHandle)).not.toThrow();
  });

  it("apply composes a verb into a NEW handle, leaving the source intact", async () => {
    const be = frameBackend();
    const h = await be.source(sample);
    const h2 = await be.apply(h, { kind: "select", columns: ["n"] });
    expect(h2).not.toBe(h);
    expect((await be.preview(h2, 1)).schema).toEqual([{ name: "n", type: "number" }]);
    // source handle still has both columns
    expect((await be.preview(h, 1)).schema).toHaveLength(2);
  });

  it("join combines two handles into a new one", async () => {
    const be = frameBackend();
    const left = await be.source({
      __frame: true, columns: [{ name: "id", type: "number", values: [1, 2] }],
    });
    const right = await be.source({
      __frame: true, columns: [
        { name: "fk", type: "number", values: [1, 1] },
        { name: "v", type: "string", values: ["x", "y"] },
      ],
    });
    const joined = await be.join(left, right, { leftKey: "id", rightKey: "fk", how: "inner" });
    const p = await be.preview(joined, 10);
    expect(p.schema.map((c) => c.name)).toEqual(["id", "v"]);
    expect(p.rows).toEqual([[1, "x"], [1, "y"]]);
  });
});

describe("materialize — error-as-value bridge for the node boundary", () => {
  it("passes a resolved value through", async () => {
    expect(await materialize(Promise.resolve(42))).toBe(42);
  });
  it("returns a rejected SolError as a value (preserving its code), not a throw", async () => {
    const out = await materialize(Promise.reject(solError("#REF!", "dropped")));
    if (!isSolError(out)) throw new Error("expected the SolError returned as a value");
    expect(out.code).toBe("#REF!");
  });
  it("wraps a non-SolError rejection as #ERROR! keeping the message", async () => {
    const out = await materialize(Promise.reject(new Error("boom")));
    if (!isSolError(out)) throw new Error("expected a SolError");
    expect(out.code).toBe("#ERROR!");
    expect(out.message).toBe("boom");
  });
  it("bridges a real dropped-handle preview rejection into a #REF! value", async () => {
    const be = frameBackend();
    const h = await be.source(sample);
    be.drop(h);
    const out = await materialize(be.preview(h, 1));
    expect(isSolError(out) && out.code).toBe("#REF!");
  });
});
