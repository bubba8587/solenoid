import { describe, it, expect } from "vitest";
import { PEEK_KINDS, peekKindFor, type PeekKind } from "../../src/graph/valuePeekKind";
import { solError } from "../../src/graph/errorValue";

// The socket hover-peek renders a value through the Display's own value views; a value
// kind the peek can't classify would hover blank. peekKindFor is the shared choke point
// (SocketValuePeek switches on it), so pin that every Display value kind maps to a
// branch. The `sampleFor` switch is exhaustive over PeekKind — a newly declared kind
// fails to compile until it joins this sweep. Mirrors displayPopupCoverage.test.ts.

function sampleFor(kind: PeekKind): unknown {
  switch (kind) {
    case "error":   return solError("#REF!", "gone");
    case "frame":   return { __frame: true, columns: [{ name: "A", type: "number", values: [1, 2] }] };
    case "cube":    return { __cube: true, depth: 1, columns: [{ name: "A", type: "number", cells: [1, 2] }] };
    case "chart":   return { __chart: true, op: "bar", values: [1, 2, 3], options: {} };
    case "mermaid": return { __mermaid: true, source: "graph TD;A-->B" };
    case "svg":     return { __svg: true, source: "<svg/>" };
    case "lambda":  return { __lambda: true, fn: () => 0 };
    case "table":   return [[1, 2], [3, 4]];
    case "list":    return [1, 2, 3];
    case "scalar":  return 42;
    case "empty":   return null;
  }
}

describe("socket value-peek coverage — every Display value kind renders", () => {
  it("enumerates the peek kinds with no gaps or duplicates", () => {
    expect(PEEK_KINDS.length).toBeGreaterThan(0);
    expect(new Set(PEEK_KINDS).size).toBe(PEEK_KINDS.length);
  });

  it("each Display value kind classifies to its own peek branch", () => {
    for (const kind of PEEK_KINDS) {
      expect(peekKindFor(sampleFor(kind)), `${kind}: peekKindFor misclassified its sample`).toBe(kind);
    }
  });
});
