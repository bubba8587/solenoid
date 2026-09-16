import { describe, it, expect } from "vitest";
import { POP_OUT_KINDS, popOutKindFor, accentFallbackVar, type PopOutKind } from "../../src/graph/valuePopup";

// An expanded Display drops the chip a collapsed one shows, so a frame / table / matrix
// / list would have no way into its data popup — a recurring gap. This pins the invariant
// at the shared choke point: EVERY pop-out kind is recognized by popOutKindFor (which the
// Display's corner ValueExpandButton and the chips both read) AND is wired into the
// opener's accent switch. The `sampleFor` switch is exhaustive over PopOutKind, so a
// newly declared kind fails to compile until it joins this sweep — the Display analogue
// of chartPopupCoverage.test.ts.

function sampleFor(kind: PopOutKind): unknown {
  switch (kind) {
    case "frame": return { __frame: true, columns: [{ name: "A", type: "number", values: [1, 2] }] };
    case "cube": return { __cube: true, depth: 1, columns: [{ name: "A", type: "number", cells: [1, 2] }] };
    case "table": return [[1, 2], [3, 4]];
    case "list": return [1, 2, 3];
  }
}

describe("display popup coverage — no Display value kind may lack a pop-out", () => {
  it("enumerates every pop-out kind with no gaps or duplicates", () => {
    expect(POP_OUT_KINDS.length).toBeGreaterThan(0);
    expect(new Set(POP_OUT_KINDS).size).toBe(POP_OUT_KINDS.length);
  });

  it("every pop-out kind is recognized and wired into the opener", () => {
    for (const kind of POP_OUT_KINDS) {
      const value = sampleFor(kind);
      expect(popOutKindFor(value), `${kind}: not recognized by popOutKindFor`).toBe(kind);
      // A defined fallback var proves the kind is handled by the opener's accent switch;
      // a kind added to popOutKindFor but not there would return undefined here.
      expect(accentFallbackVar(value), `${kind}: missing from accentFallbackVar (opener switch)`).toBeTruthy();
    }
  });

  it("a scalar / string / logical / chart-like value has no table pop-out", () => {
    for (const v of [42, "hi", true, null, {}, [], { __chart: true, op: "bar" }]) {
      expect(popOutKindFor(v), `${JSON.stringify(v)} should have no table pop-out`).toBeNull();
    }
  });
});
