// [[C130]], [[C24]]
// A lazy frame read from JavaScript (frame-verbs.md § Lazy frames): read whole once a ref, its first rows as a card's
// preview with its row count and itself beside them, a plan's error as a value.
import { describe, it, expect } from "vitest";
import { readFrame, collectPreview, refWithFormats, isFrameRef } from "../../src/graph/frameBackend";
import { isSolError } from "../../src/graph/errorValue";
import type { FrameValue } from "../../src/graph/frame";
import { planned, planOf, frameStats } from "./frameRefKit";

const sample: FrameValue = {
  __frame: true,
  columns: [
    { name: "n", type: "number", values: [1, 2, 3, 4, 5] },
    { name: "s", type: "string", values: ["a", "b", "c", "d", "e"] },
  ],
};
const long: FrameValue = { __frame: true, columns: [{ name: "i", type: "number", values: Array.from({ length: 250 }, (_, i) => i) }] };

describe("reading a lazy frame", () => {
  it("reads the whole frame, its plan run once however often it is read", async () => {
    frameStats();
    const ref = planned(sample, { kind: "sort", by: "n", dir: "desc" });
    const a = await readFrame(ref);
    const b = await readFrame(ref);
    expect(a).toBe(b);
    expect((a as FrameValue).columns[0].values).toEqual([5, 4, 3, 2, 1]);
    expect(frameStats()).toMatchObject({ runs: 1, collects: 1 });
  });

  it("previews its first 100 rows with the row count and the ref beside them", async () => {
    const ref = planned(long, { kind: "sort", by: "i", dir: "desc" });
    const p = (await collectPreview(ref)) as FrameValue;
    expect(p.columns[0].values).toHaveLength(100);
    expect(p.columns[0].values[0]).toBe(249);
    expect(p.__totalRows).toBe(250);
    expect(isFrameRef(p.__ref)).toBe(true);
    expect(((await readFrame(p.__ref as never)) as FrameValue).columns[0].values).toHaveLength(250);
  });

  it("a frame with no more rows than the preview previews as the whole frame", async () => {
    const ref = planned(sample, { kind: "head", n: 3 });
    expect(await collectPreview(ref)).toBe(await readFrame(ref));
    expect(((await collectPreview(ref, 0)) as FrameValue).__totalRows).toBe(3);
  });

  it("a plan that fails reads as its error and throws from a preview", async () => {
    const bad = planned(sample, { kind: "select", columns: ["nope"] });
    const out = await readFrame(bad);
    expect(isSolError(out) && out.code).toBe("#REF!");
    await expect(collectPreview(bad)).rejects.toMatchObject({ code: "#REF!" });
  });

  it("a value, null or an error reads as itself", async () => {
    expect(await readFrame(sample)).toBe(sample);
    expect(await readFrame(null)).toBeNull();
    expect(await collectPreview(sample)).toBe(sample);
  });

  it("format picks ride as one more op of the plan", async () => {
    const ref = planned(sample, { kind: "distinct" });
    const out = refWithFormats(ref, { n: { kind: "number", decimals: 2 } as never });
    expect(planOf(out)).toEqual(["distinct", "formats"]);
    expect(((await readFrame(out)) as FrameValue).columns[0].format).toEqual({ kind: "number", decimals: 2 });
  });
});
