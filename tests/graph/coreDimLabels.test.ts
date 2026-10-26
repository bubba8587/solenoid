// [[D99]] rustIsSpec, [[C25]] firstClassUnits
// Every dimension's label (fixtures/core/dim-labels.json.gz): each catalog unit's dimension (coreUnitCatalog.test.ts),
// its square and its inverse, and custom and mixed dimensions.
import { describe, expect, it } from "vitest";
import { frozen, readFrozen } from "./coreFixtures";
import { formatDim, type Dim } from "../../src/graph/dimension";

describe("every dimension's label reads as frozen", () => {
  it("each unit's dimension, its square, its inverse, and custom and mixed dimensions", () => {
    const units = readFrozen<{ unit: { dim: Dim } | null }>("unit-catalog").map((c) => c.unit).filter((u): u is { dim: Dim } => u !== null);
    const dims: Dim[] = [{}, { length: 0 }, { "custom:widget": 1 }, { "custom:b": 1, "custom:a": 1, time: -1 }, { length: 1.5 }, { angle: -2, currency: 1 }];
    for (const u of units) {
      dims.push(u.dim, Object.fromEntries(Object.entries(u.dim).map(([k, e]) => [k, e * 2])), Object.fromEntries(Object.entries(u.dim).map(([k, e]) => [k, -e])));
    }
    const fresh = dims.map((dim) => ({ dim, want: formatDim(dim) }));
    const cases = frozen<{ dim: Dim; want?: string }>("dim-labels", () => fresh);
    expect(cases.length).toBe(fresh.length);
    const bad = cases.filter((c, i) => c.want !== fresh[i].want).map((c) => JSON.stringify(c.dim));
    expect(bad).toEqual([]);
  });
});
