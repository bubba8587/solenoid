// [[C25]] firstClassUnits, [[unit-flow#One idea, a carrier per rank]]
import { describe, it, expect } from "vitest";
import { GraphNode } from "../../../src/graph/graphModel";
import * as M from "../../../src/graph/nodes/matrix";
import { ListIndexNode } from "../../../src/graph/nodes/list";
import { NODE_COMPONENTS } from "../../../src/graph/nodeRegistry";
import { throughBoundary } from "../boundaryKit";
import { MutableSocket } from "../../../src/graph/sockets";
import { withMatrixUnit, matrixUnitOf, fromUnit, isUnitCell, type UnitCell } from "../../../src/graph/unitValue";
import { applyFcUnit } from "../../../src/graph/unitBridge";
import { fcUnitToUnit } from "../../../src/graph/dimension";

// ─── The matrix-unit POLICY guard (unitGranularity) ──────────────────────────────────────

//   carry            — structural reshape, same cells rearranged → the unit rides
//   carry-if-uniform — a combiner → the unit rides only if every part shares it
//   convert-to-list  — rank drop (matrix→list): the grid unit becomes per-cell tags
//   convert-to-matrix— rank lift (list→matrix): a uniform list gives the grid unit
//   strip            — a value transform (linear algebra) breaks the unit, by design
//   na               — no dimensioned output (dimension info, a generated matrix)
//   author           — a literal source that MINTS the unit

type Policy = "carry" | "carry-if-uniform" | "convert-to-list" | "convert-to-matrix" | "strip" | "na" | "author";

const POLICY: Record<string, Policy> = {
  TableTransposeNode: "carry",
  TableSelectNode: "carry",       // CHOOSEROWS / CHOOSECOLS
  TakeDropNode: "carry",          // TAKE / DROP — matrix branch; the `anydata` input hides
                                  // it from the structural sweep, so it is kept here by hand
  ExpandNode: "carry",
  SetCellNode: "carry",           // overwriting cells by address keeps the grid's unit
  InterpolateNode: "carry",       // grid mode fills blanks in the SAME unit (dynamic
                                  // socket, so the sweep can't see it — kept manually)
  ConnectedRegionsNode: "na",             // patch numbers, never in the grid's unit
  FindPeaksNode: "na",           // Grid mode: positions out, a frame, no dimensioned matrix
  DiffNode: "carry",              // Grid mode: a change or a slope is in the grid's unit; % is a plain ratio
  SmoothNode: "carry",            // Grid mode smooths in the grid's unit, List mode in its items' (a dynamic socket, kept here by hand)
  ConvolveNode: "strip",          // Grid mode: a convolution multiplies the two grids' units — documented-strip
  TrapzNode: "strip",             // Grid mode: a volume carries z·x·y — documented-strip
  StackNode: "carry-if-uniform",
  TableReshapeNode: "convert-to-matrix", // WRAPROWS/WRAPCOLS lift; TOCOL/TOROW drop (both checked below)
  TableMultNode: "strip",         // MMULT — dimensioned matrix products are out of scope (documented-strip)
  MatDetNode: "strip",            // MDETERM (unitⁿ) / MINVERSE (unit⁻¹) / TRACE / RANK / NORM — documented-strip
  MatSolveNode: "strip",          // A·x = b: x carries b's unit ÷ A's — dimensioned linear algebra is out of scope (same stance)
  MatEigenNode: "strip",          // eigenvalues carry A's unit, eigenvectors none — documented-strip
  MapTableNode: "strip",          // an arbitrary per-cell lambda breaks the unit, by design
  ByAxisNode: "strip",            // arbitrary per-row/col lambda reduction — same
  ReduceLambdaNode: "strip",
  ScanLambdaNode: "strip",
  BuildFrameNode: "strip",        // matrix → frame crosses into the per-COLUMN unit model;
                                  // lifting a unitGranularity grid unit into column units is future work
  TableInfoNode: "na",            // ROWS / COLUMNS → plain numbers
  TableUnitNode: "na",            // MUNIT → a freshly generated identity matrix
  ChartNode: "na",                // visuals: a chart value out, no dimensioned matrix output
  SurfaceNode: "na",
  QuiverNode: "na",
  HeatmapNode: "na",
  TableInputNode: "author",       // a literal source that tags its own output
};

// A km-tagged 2×2 grid (dim length, display "km"), cells as-typed per unitGranularity.
const kmGrid = () => withMatrixUnit([[1, 2], [3, 4]], { dim: { length: 1 }, display: "km" });
const plainGrid = () => [[1, 2], [3, 4]];

// Matrix-family socket types (declared or adoptive-base) — a node with one of these
// on an input takes a matrix and therefore needs a policy.
const MATRIX_INPUT = new Set(["table", "strtable", "datetable", "logicaltable", "anytable"]);
function takesMatrix(node: GraphNode): boolean {
  for (const inp of Object.values(node.inputs ?? {})) {
    const s = inp?.socket as { dataType?: string; base?: string } | undefined;
    if (s && (MATRIX_INPUT.has(s.dataType ?? "") || MATRIX_INPUT.has(s.base ?? ""))) return true;
  }
  return false;
}

describe("matrix-unit policy — completeness (a new matrix op must declare a policy)", () => {
  it("every REGISTERED node that takes a matrix is in the POLICY table", () => {
    // Sweep the whole node registry, not just matrix.ts — the first escape was
    // real (visuals, the 2-D lambda family, BuildFrame, and InterpolateNode's
    // dynamically-added grid socket all shipped outside the old matrix.ts-only
    // sweep). A node whose matrix socket appears only after a mode switch (like
    // InterpolateNode) still can't be seen structurally — keep those in POLICY by
    // hand when they ship.
    const missing = new Set<string>();
    let found = 0;
    for (const [ctor] of NODE_COMPONENTS) {
      let node: GraphNode;
      try { node = new (ctor as unknown as new () => GraphNode)(); } catch { continue; }
      if (!takesMatrix(node)) continue;
      found++;
      if (!(node.constructor.name in POLICY)) missing.add(node.constructor.name);
    }
    // If this fails: a new matrix-transforming node shipped without deciding what
    // happens to a unitGranularity unit tag. Add it to POLICY (and a case below) — carry / strip /
    // convert — don't let it silently drop the unit.
    expect([...missing]).toEqual([]);
    // Non-vacuous: the sweep must actually be finding matrix-taking nodes (guards
    // against a socket-detection change silently making this test pass on nothing).
    expect(found).toBeGreaterThanOrEqual(14);
  });
});

describe("matrix-unit policy — behavior matches the declared policy", () => {


  it("carry-if-uniform: a stack keeps the unit only when every part shares it", () => {
    const v = new M.StackNode({ op: "vstack",  valueKeys: ["t0", "t1"] });
    expect(matrixUnitOf(v.data({ t0: [kmGrid()], t1: [kmGrid()] }).result)).toMatchObject({ display: "km" });
    expect(matrixUnitOf(v.data({ t0: [kmGrid()], t1: [plainGrid()] }).result)).toBeUndefined(); // mixed → strip
    const h = new M.StackNode({ op: "hstack",  valueKeys: ["t0", "t1"] });
    expect(matrixUnitOf(h.data({ t0: [kmGrid()], t1: [kmGrid()] }).result)).toMatchObject({ display: "km" });
    expect(matrixUnitOf(h.data({ t0: [kmGrid()], t1: [plainGrid()] }).result)).toBeUndefined();
  });

  it("carry-if-uniform: a dimensioned LIST row lifts to the grid unit (through the real boundary)", () => {
    // A list widened into an `anytable` stack row arrives with PER-ELEMENT tags; the
    // stackers are unitAware, so they reach data() intact and get reduced to the unitGranularity
    // shape (bare magnitudes + one grid tag) exactly like WRAPROWS. Before this, the
    // boundary stripped them and a km list stacked into a plain, unitless grid.
    const km = fcUnitToUnit("km")!, kg = fcUnitToUnit("kg")!;
    const kmList = () => [fromUnit(1, km, "km"), fromUnit(2, km, "km")];
    const v = new M.StackNode({ op: "vstack",  valueKeys: ["t0", "t1"] });
    throughBoundary(v);
    const out = (v.data({ t0: [kmList()], t1: [kmList()] }) as { result: unknown }).result;
    expect(matrixUnitOf(out)).toMatchObject({ display: "km" });
    expect((out as number[][])[0][0]).toBe(1);              // as-typed magnitude, never a UnitCell
    expect((out as unknown[][]).flat().some(isUnitCell)).toBe(false);
    // A km list stacked on a km GRID still agrees — both sides reduce to the same tag.
    const mixedRank = new M.StackNode({ op: "vstack",  valueKeys: ["t0", "t1"] });
    throughBoundary(mixedRank);
    expect(matrixUnitOf((mixedRank.data({ t0: [kmList()], t1: [kmGrid()] }) as { result: unknown }).result))
      .toMatchObject({ display: "km" });
    // Disagreeing units strip, same uniform-or-nothing rule as the grid case.
    const h = new M.StackNode({ op: "hstack",  valueKeys: ["t0", "t1"] });
    throughBoundary(h);
    expect(matrixUnitOf((h.data({ t0: [kmList()], t1: [[fromUnit(3, kg, "kg")]] }) as { result: unknown }).result))
      .toBeUndefined();
  });


  it("convert-to-matrix: WRAPROWS lifts a uniform-unit list into a grid unit (through the real boundary)", () => {
    // A list of km UnitCells (base-SI values, display km) wraps into a km grid whose
    // cells are bare as-typed magnitudes. Run through throughBoundary because the list
    // input would otherwise be unit-stripped at the boundary (the node is unitAware).
    const n = new M.TableReshapeNode({ op: "wraprows" });
    throughBoundary(n);
    const km = fcUnitToUnit("km")!, kg = fcUnitToUnit("kg")!;
    const kmList = [fromUnit(1, km, "km"), fromUnit(2, km, "km"), fromUnit(3, km, "km"), fromUnit(4, km, "km")];
    const out = (n.data({ list: [kmList], wrapCount: [2] }) as { result: unknown }).result;
    expect(matrixUnitOf(out)).toMatchObject({ display: "km" });
    expect((out as number[][])[0][0]).toBe(1); // as-typed magnitude, not base-SI 1000
    // A mixed-unit list can't claim one grid unit → strips.
    const mixed = [fromUnit(1, km, "km"), fromUnit(2, kg, "kg")];
    const m2 = new M.TableReshapeNode({ op: "wraprows" });
    throughBoundary(m2);
    expect(matrixUnitOf((m2.data({ list: [mixed], wrapCount: [2] }) as { result: unknown }).result)).toBeUndefined();
  });



});

// INDEX lives in list.ts but is the other matrix-unit consumer (extraction). Pin it
// here too so the whole matrix-unit story is guarded in one place — through the REAL
// coercion boundary, where the adoptive trueany input adopts "table" (the 2026-07-15
// bug the direct-data() test missed).
describe("matrix-unit policy — INDEX extraction (list.ts) carries the unit out", () => {
  it("through the real boundary (socket adopts 'table')", () => {
    const n = new ListIndexNode();
    (n.inputs.list!.socket as MutableSocket).setType("table");
    throughBoundary(n);
    const cell = (n.data({ list: [kmGrid()], index: [1], column: [2] }) as { result: unknown }).result;
    expect(isUnitCell(cell)).toBe(true);
    expect((cell as UnitCell).display).toBe("km");
  });
});

describe("an FC on a matrix that already carries a unit never relabels it ([[C25]] firstClassUnits)", () => {
  const km = () => withMatrixUnit([[5, 2]], { dim: fcUnitToUnit("km")!.dim, display: "km" });

  it("an incommensurable unit is #UNIT!, not a new tag", () => {
    const out = applyFcUnit(km(), "s") as { code?: string };
    expect(out.code).toBe("#UNIT!");
  });
  it("a commensurable unit re-displays: the cells rescale, the value stands", () => {
    const out = applyFcUnit(km(), "m") as number[][];
    expect(out).toEqual([[5000, 2000]]);
    expect(matrixUnitOf(out)?.display).toBe("m");
  });
});
