// [[C100]] chartIsAValue: the US Map card reads a frame's places into pins.
import { describe, it, expect } from "vitest";
import { UsMapNode } from "../../../src/graph/nodes/visual";
import type { ChartValue, UsMapPayload } from "../../../src/graph/chartValue";
import { extractInit } from "../../../src/graph/nodeInit";
import { isSolError, type SolError } from "../../../src/graph/errorValue";

const frame = (cols: { name: string; type: string; values: unknown[] }[]) => ({ __frame: true, columns: cols }) as never;
const PLACES = frame([
  { name: "Place", type: "string", values: ["Austin", "Little Rock", "Anchorage", "Nowhere", "Bad"] },
  { name: "Latitude", type: "number", values: [30.27, 34.75, 61.2, null, 95] },
  { name: "Lng", type: "number", values: [-97.74, -92.29, -149.9, -90, -90] },
  { name: "Team", type: "string", values: ["A", "B", "A", "B", "A"] },
  { name: "Calls", type: "number", values: [4, 10, 1, 2, 3] },
]);
const map = (n: UsMapNode, f: unknown, options?: string) =>
  n.data({ frame: [f], ...(options !== undefined ? { options: [options] } : {}) }).chart as ChartValue | SolError;
const payload = (v: ChartValue | SolError) => (v as ChartValue).payload as UsMapPayload;

describe("US Map", () => {
  it("finds Latitude and Lng by their usual names and counts a row with no place in range", () => {
    const p = payload(map(new UsMapNode(), PLACES));
    expect(p).toMatchObject({ kind: "usmap", scope: "lower48", lat: [30.27, 34.75, 61.2], lon: [-97.74, -92.29, -149.9], skipped: 2 });
    expect(p.text).toEqual(["Austin", "Little Rock", "Anchorage"]);
    expect(p.names.text).toBe("Place");
  });

  it("colors by a text column as categories and by a number column on a range, and sizes by a number column", () => {
    const cat = payload(map(new UsMapNode(), PLACES, "c=team; s=Calls"));
    expect(cat.c).toEqual([0, 1, 0]);
    expect(cat.cCats).toEqual(["A", "B"]);
    expect(cat.s).toEqual([4, 10, 1]);
    expect(cat.sRange).toEqual([1, 10]);
    const num = payload(map(new UsMapNode(), PLACES, "c=Calls"));
    expect(num.c).toEqual([4, 10, 1]);
    expect(num.cRange).toEqual([1, 10]);
    expect(num.cCats).toBeUndefined();
  });

  it("refuses a named column the data lacks, data with no place columns, and a size column of text", () => {
    for (const [f, o, code] of [
      [PLACES, "c=Region", "#REF!"],
      [PLACES, "lat=Y", "#REF!"],
      [frame([{ name: "Y", type: "number", values: [1] }]), "", "#REF!"],
      [PLACES, "s=Team", "#TYPE!"],
    ] as const) {
      const out = map(new UsMapNode(), f, o);
      expect(isSolError(out) ? out.code : out).toBe(code);
    }
  });

  it("reads lat= and lon= over the usual names, and draws an empty map from no data", () => {
    const f = frame([{ name: "Y", type: "number", values: [35] }, { name: "X", type: "number", values: [-90] }]);
    expect(payload(map(new UsMapNode(), f, "lat=y; lon=x"))).toMatchObject({ lat: [35], lon: [-90] });
    expect(payload(map(new UsMapNode(), null))).toMatchObject({ lat: [], skipped: 0 });
  });

  it("keeps its scope through a save, and carries it on the payload", () => {
    const n = new UsMapNode({ scope: "all50" });
    expect(payload(map(n, PLACES)).scope).toBe("all50");
    expect(new UsMapNode(extractInit(n) as never).scope).toBe("all50");
    expect(new UsMapNode({ scope: "bogus" as never }).scope).toBe("lower48");
  });
});
