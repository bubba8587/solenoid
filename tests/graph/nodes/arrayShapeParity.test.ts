import { describe, it, expect } from "vitest";
import { SeriesNode } from "../../../src/graph/nodes/list";
import { TableReshapeNode } from "../../../src/graph/nodes/matrix";
import { resolveExcelFunction } from "../../../src/graph/excelFunctions";

// ─── BEHAVIOURAL node↔formula parity — the SHAPE-PARAMETRIC family ──────────────
//
// The arity guard (nodeFormulaArgParity.test.ts) only sees nodes that dispatch THROUGH
// resolveExcelFunction; a node on its OWN kernel is invisible to it, and its own header
// says those "are guarded by per-function BEHAVIOURAL node↔formula agreement tests
// instead." This is that backstop for the class where the two surfaces most easily drift
// on CAPABILITY: functions whose result SHAPE (rank, dimensions) is an argument —
// generators and reshapers. SEQUENCE is here because the node once produced only a 1-D
// list while the formula produced 2-D (a real, shipped divergence). Each case runs the
// NODE's data() and the =FORMULA on the SAME arguments and asserts identical output.

const fx = (name: string) => resolveExcelFunction(name)!;

/** Run a Series node's data() for a given op with wired inputs. */
function series(op: "sequence", inputs: Record<string, number[]>): unknown {
  const n = new SeriesNode({ op });
  return (n.data(inputs as never) as { list: unknown }).list;
}

/** Run a TableReshape node's data() for a given op. */
function reshape(op: "wraprows" | "wrapcols" | "tocol" | "torow", inputs: Record<string, unknown[]>): unknown {
  const n = new TableReshapeNode({ op });
  return (n.data(inputs as never) as { result: unknown }).result;
}

describe("shape-parametric node ↔ formula parity", () => {
  it("SEQUENCE — Rows × Columns, 1-D and 2-D, match =SEQUENCE", () => {
    // [count(rows), cols, start, step] at the node ↔ SEQUENCE(rows, cols, start, step)
    const cases: [number, number, number, number][] = [
      [5, 1, 1, 1],   // the classic 1-D list
      [5, 1, 10, 2],  // start/step
      [3, 4, 1, 1],   // 2-D grid — the capability the node used to lack
      [9, 9, 1, 0],   // constant fill (the sudoku ones matrix)
      [1, 81, 0, 1],  // a single wide row
    ];
    for (const [rows, cols, start, step] of cases) {
      const node = series("sequence", { count: [rows], cols: [cols], start: [start], step: [step] });
      const formula = fx("SEQUENCE")(rows, cols, start, step);
      expect(node, `SEQUENCE(${rows},${cols},${start},${step})`).toEqual(formula);
    }
  });

  it("WRAPROWS / WRAPCOLS — node matches the formula", () => {
    const list = [1, 2, 3, 4, 5, 6, 7];
    for (const count of [2, 3, 4]) {
      expect(reshape("wraprows", { list: [list], wrapCount: [count] }), `WRAPROWS/${count}`)
        .toEqual(fx("WRAPROWS")(list, count));
      expect(reshape("wrapcols", { list: [list], wrapCount: [count] }), `WRAPCOLS/${count}`)
        .toEqual(fx("WRAPCOLS")(list, count));
    }
  });

  it("TOCOL / TOROW — node matches the formula", () => {
    const matrix = [[1, 2, 3], [4, 5, 6]];
    expect(reshape("tocol", { matrix: [matrix] })).toEqual(fx("TOCOL")(matrix));
    expect(reshape("torow", { matrix: [matrix] })).toEqual(fx("TOROW")(matrix));
  });
});
