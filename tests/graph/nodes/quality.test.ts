// [[A1]] visualGraphCalculator
import { describe, it, expect } from "vitest";
import { ExpectNode } from "../../../src/graph/nodes/quality";
import { alertStore } from "../../../src/graph/alertStore";
import { solError } from "../../../src/graph/errorValue";
import { applyFcUnit } from "../../../src/graph/unitBridge";
import type { FrameValue, FrameCell, FrameColType } from "../../../src/graph/frame";

// Expect checks over FRAMES (the audit-found blind spot: a FrameValue fell into
// the scalar arm and every check silently no-opped) + the pre-existing
// list/scalar behavior, pinned so it can't regress.

const frame = (cols: [string, FrameColType, FrameCell[]][]): FrameValue => ({
  __frame: true,
  columns: cols.map(([name, type, values]) => ({ name, type, values })),
});

function run(node: ExpectNode, value: unknown) {
  node.data({ in: [value] });
  return node.violations;
}

describe("Expect over frames", () => {
  it("notNull flags a null cell anywhere in the table", () => {
    const n = new ExpectNode({ checkNotNull: true });
    expect(run(n, frame([["a", "number", [1, 2]], ["b", "string", ["x", null]]]))).toEqual(["notNull"]);
    expect(run(n, frame([["a", "number", [1, 2]], ["b", "string", ["x", "y"]]]))).toEqual([]);
  });

  it("unique means unique ROWS for a frame", () => {
    const n = new ExpectNode({ checkNotNull: false, checkUnique: true });
    const dup = frame([["a", "number", [1, 2, 1]], ["b", "string", ["x", "y", "x"]]]);
    expect(run(n, dup)).toEqual(["unique"]);
    // Same cell values across DIFFERENT columns is not a duplicate row.
    const ok = frame([["a", "number", [1, 2]], ["b", "number", [2, 1]]]);
    expect(run(n, ok)).toEqual([]);
  });

  it("range and regex scan every cell", () => {
    const n = new ExpectNode({ checkNotNull: false, checkRange: true, checkRegex: true });
    n.literals.min = 0;
    n.literals.max = 10;
    n.stringLiterals.pattern = "^[a-z]+$";
    const bad = frame([["a", "number", [5, 99]], ["b", "string", ["ok", "NOT OK"]]]);
    expect(run(n, bad)).toEqual(["range", "regex"]);
    const good = frame([["a", "number", [5, 9]], ["b", "string", ["ok", "fine"]]]);
    expect(run(n, good)).toEqual([]);
  });

  it("notNull flags a per-cell error (a #DIV/0! cell isn't valid present data)", () => {
    const n = new ExpectNode({ checkNotNull: true });
    const err = solError("#DIV/0!", "divide by zero") as unknown as FrameCell;
    expect(run(n, frame([["a", "number", [1, err]], ["b", "string", ["x", "y"]]]))).toEqual(["notNull"]);
    // A list with an errored element too.
    expect(run(n, [1, solError("#N/A", "not available"), 3])).toEqual(["notNull"]);
  });

  it("passes the frame through unchanged", () => {
    const n = new ExpectNode({ checkNotNull: true });
    const f = frame([["a", "number", [1, null]]]);
    expect(n.data({ in: [f] }).out).toBe(f);
  });
});

describe("Expect — in-list (allowlist) membership", () => {
  it("flags a value outside a wired allowlist", () => {
    const n = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    // Wired allowlist wins over the literal.
    expect(n.data({ in: ["Pear"], allowed: [["Apple", "Banana"]] }).out).toBe("Pear");
    expect(n.violations).toEqual(["allowed"]);
    n.data({ in: ["Apple"], allowed: [["Apple", "Banana"]] });
    expect(n.violations).toEqual([]);
  });

  it("scans every cell of a list/frame against the allowlist", () => {
    const n = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    n.data({ in: [["Apple", "Kiwi", "Banana"]], allowed: [["Apple", "Banana"]] });
    expect(n.violations).toEqual(["allowed"]);
    const f = frame([["fruit", "string", ["Apple", "Banana"]]]);
    n.data({ in: [f], allowed: [["Apple", "Banana"]] });
    expect(n.violations).toEqual([]);
  });

  it("uses the comma-separated literal when the socket is unwired, matching by string form", () => {
    const n = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    n.stringLiterals.allowed = "1, 2, 3";
    // Numbers match by their rendered token.
    expect(run(n, [1, 2, 4])).toEqual(["allowed"]);
    expect(run(n, [1, 2, 3])).toEqual([]);
  });

  it("skips the check when the allowlist is empty (unwired + blank literal)", () => {
    const n = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    expect(run(n, ["anything"])).toEqual([]);
  });

  it("ignores null cells (that's not-null's job)", () => {
    const n = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    n.stringLiterals.allowed = "A, B";
    expect(run(n, ["A", null, "B"])).toEqual([]);
  });
});

describe("Expect over lists/scalars (unchanged behavior)", () => {
  it("unique still works on a plain list", () => {
    const n = new ExpectNode({ checkNotNull: false, checkUnique: true });
    expect(run(n, [1, 2, 2])).toEqual(["unique"]);
    expect(run(n, [1, 2, 3])).toEqual([]);
  });

  it("notNull on a scalar null", () => {
    const n = new ExpectNode({ checkNotNull: true });
    expect(run(n, null)).toEqual(["notNull"]);
    expect(run(n, 5)).toEqual([]);
  });
});

// The alert edge-detects on the SET of failing CHECK KINDS (violations.join),
// NOT on which cells failed or how many — a "failure signature". So a different
// cell failing the SAME check does not re-fire; a new check joining the set does;
// recovery re-arms the edge. This is the intended coarse-grained design (quality.ts
// comments; the alertStore "edge-detect on STATUS, not a boolean" invariant), pinned
// here so a future change to the firing rule is a conscious one.
describe("Expect alert edge-detect (fires on a NEW failure signature, not per bad cell)", () => {
  const alertsFor = (id: string) => alertStore.list().filter((e) => e.nodeId === id).length;

  it("re-fires only when the set of failing checks changes", () => {
    alertStore.clear();
    const n = new ExpectNode({ checkNotNull: false, checkRange: true, checkRegex: true, label: "Q" });
    n.literals.min = 0;
    n.literals.max = 10;
    n.stringLiterals.pattern = "^[a-z]+$";

    // First failure — range only → one alert.
    n.data({ in: [[99, "ok"]] });
    expect(n.violations).toEqual(["range"]);
    expect(alertsFor(n.id)).toBe(1);

    // A DIFFERENT cell fails the SAME check → same signature → no new alert.
    n.data({ in: [[20, "ok"]] });
    expect(n.violations).toEqual(["range"]);
    expect(alertsFor(n.id)).toBe(1);

    // A NEW check joins the failing set → signature changed → fires.
    n.data({ in: [[20, "BAD"]] });
    expect(n.violations).toEqual(["range", "regex"]);
    expect(alertsFor(n.id)).toBe(2);

    // Recovery — no failure fires nothing, and re-arms the edge.
    n.data({ in: [[5, "ok"]] });
    expect(n.violations).toEqual([]);
    expect(alertsFor(n.id)).toBe(2);

    // Failing again after recovery fires (the edge re-armed on recovery).
    n.data({ in: [[99, "ok"]] });
    expect(n.violations).toEqual(["range"]);
    expect(alertsFor(n.id)).toBe(3);
  });
});

describe("Expect reads values as they're shown: units, Cubes and the allowlist by meaning", () => {
  it("range checks a unit value in its display unit, scalar or list", () => {
    const n = new ExpectNode({ checkNotNull: false, checkRange: true });
    n.literals.min = 0;
    n.literals.max = 100;
    expect(run(n, applyFcUnit(500, "m"))).toEqual(["range"]);
    expect(run(n, applyFcUnit([5, 500], "m"))).toEqual(["range"]);
    expect(run(n, applyFcUnit(50, "m"))).toEqual([]);
  });

  it("matches the allowlist by meaning: unit magnitudes, numbers, TRUE/FALSE, dates, text without case", () => {
    const n = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    n.stringLiterals.allowed = "5, 10";
    expect(run(n, applyFcUnit(5, "m"))).toEqual([]);
    n.stringLiterals.allowed = "1.0, 2";
    expect(run(n, 1)).toEqual([]);
    n.stringLiterals.allowed = "TRUE";
    expect(run(n, true)).toEqual([]);
    expect(run(n, false)).toEqual(["allowed"]);
    n.stringLiterals.allowed = "15-Mar-2026";
    expect(run(n, 46096)).toEqual([]);
    n.stringLiterals.allowed = "apple, banana";
    expect(run(n, ["Apple", "BANANA"])).toEqual([]);
    expect(run(n, "cherry")).toEqual(["allowed"]);
  });

  it("matches a wired allowlist of mixed types", () => {
    const n = new ExpectNode({ checkNotNull: false, checkAllowed: true });
    n.data({ in: [[1, "a", true]], allowed: [[1, "A", true]] });
    expect(n.violations).toEqual([]);
  });

  it("unique treats the same quantity in two units as a duplicate, and text by case", () => {
    const n = new ExpectNode({ checkNotNull: false, checkUnique: true });
    const fiveM = applyFcUnit(5, "m");
    const fiveHundredCm = applyFcUnit(500, "cm");
    expect(run(n, [fiveM, fiveHundredCm])).toEqual(["unique"]);
    expect(run(n, ["Apple", "apple"])).toEqual([]);
  });

  it("checks a Cube's cells, nested tables included, and its rows for unique", () => {
    const cube = (cols: [string, unknown[]][]) => ({ __cube: true, depth: 1, columns: cols.map(([name, cells]) => ({ name, cells })) });
    const nn = new ExpectNode({ checkNotNull: true });
    expect(run(nn, cube([["a", [1, null]]]))).toEqual(["notNull"]);
    expect(run(nn, cube([["a", [1, 2]], ["kids", [frame([["x", "number", [1, null]]]), frame([["x", "number", [3]]])]]]))).toEqual(["notNull"]);
    expect(run(nn, cube([["a", [1, 2]]]))).toEqual([]);
    const u = new ExpectNode({ checkNotNull: false, checkUnique: true });
    expect(run(u, cube([["a", [1, 1]], ["b", ["x", "x"]]]))).toEqual(["unique"]);
    expect(run(u, cube([["a", [1, 1]], ["b", ["x", "y"]]]))).toEqual([]);
  });
});
