import { describe, it, expect } from "vitest";
import { ClassicPreset } from "rete";
import * as M from "../../../src/graph/nodes/matrix";
import { ListIndexNode } from "../../../src/graph/nodes/list";
import { InterpolateNode } from "../../../src/graph/nodes/stats";
import { NODE_COMPONENTS } from "../../../src/graph/nodeRegistry";
import { wrapNodeData } from "../../../src/graph/coerceInputs";
import { MutableSocket, SolenoidSocket, AdoptiveSocket } from "../../../src/graph/sockets";
import { withMatrixUnit, matrixUnitOf, fromUnit, isUnitCell, type UnitCell } from "../../../src/graph/unitValue";
import { fcUnitToUnit } from "../../../src/graph/unitBridge";

// ─── The matrix-unit POLICY guard (unitGranularity) ──────────────────────────────────────
// A matrix carries ONE whole-grid unit as a non-enumerable Symbol tag (unitValue.ts).
// That tag is dropped by any array rebuild, so EVERY node that transforms a matrix
// must make a deliberate choice about the unit. This file is the machine-checked
// register of those choices: the policy table below plus a COMPLETENESS sweep that
// fails if a new matrix.ts node ships without a declared policy. It's the structural
// guard that turns "did you remember to carry the unit?" from a silent runtime bug
// (the 2026-07-15 INDEX/reshape whack-a-mole) into a red test.
//
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
  HeatmapCellNode: "na",
  TableInputNode: "author",       // a literal source that tags its own output
};

// A km-tagged 2×2 grid (dim length, display "km"), cells as-typed per unitGranularity.
const kmGrid = () => withMatrixUnit([[1, 2], [3, 4]], { dim: { length: 1 }, display: "km" });
const plainGrid = () => [[1, 2], [3, 4]];

// Matrix-family socket types (declared or adoptive-base) — a node with one of these
// on an input takes a matrix and therefore needs a policy.
const MATRIX_INPUT = new Set(["table", "strtable", "datetable", "logicaltable", "anytable"]);
function takesMatrix(node: ClassicPreset.Node): boolean {
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
      let node: ClassicPreset.Node;
      try { node = new (ctor as unknown as new () => ClassicPreset.Node)(); } catch { continue; }
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
  it("carry: INTERPOLATE grid mode fills blanks in the input's unit", () => {
    const n = new InterpolateNode({ mode: "grid" });
    // A plain Z table (coordinates ride beside it; unwired axes = index) carrying a unit.
    const z = withMatrixUnit([[5, null], [null, 9]], { dim: { length: 1 }, display: "km" });
    const out = (n.data({ z: [z] }) as { result: unknown }).result;
    expect(matrixUnitOf(out)).toMatchObject({ display: "km" });
  });

  it("carry: the whole-grid unit rides a structural reshape", () => {
    expect(matrixUnitOf(new M.TableTransposeNode().data({ matrix: [kmGrid()] }).result)).toMatchObject({ display: "km" });
    expect(matrixUnitOf(new M.TableSelectNode({ op: "chooserows" }).data({ matrix: [kmGrid()], indices: [[1]] }).result)).toMatchObject({ display: "km" });
    expect(matrixUnitOf(new M.TakeDropNode({ op: "take" }).data({ data: [kmGrid()], rows: [1], cols: [0] }).result)).toMatchObject({ display: "km" });
    expect(matrixUnitOf(new M.ExpandNode().data({ matrix: [kmGrid()], rows: [3], cols: [2], fill: [0] }).result)).toMatchObject({ display: "km" });
    expect(matrixUnitOf(new M.SetCellNode().data({ matrix: [kmGrid()], value0: [9], row0: [1], col0: [1] }).result)).toMatchObject({ display: "km" });
    // The grid unit rides a shaped write too — a list (row segment) or a matrix (block).
    expect(matrixUnitOf(new M.SetCellNode().data({ matrix: [kmGrid()], value0: [[10, 20]], row0: [1], col0: [1] }).result)).toMatchObject({ display: "km" });
    expect(matrixUnitOf(new M.SetCellNode().data({ matrix: [kmGrid()], value0: [[[10, 20], [30, 40]]], row0: [1], col0: [1] }).result)).toMatchObject({ display: "km" });
  });

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
    wrapNodeData(v);
    const out = (v.data({ t0: [kmList()], t1: [kmList()] }) as { result: unknown }).result;
    expect(matrixUnitOf(out)).toMatchObject({ display: "km" });
    expect((out as number[][])[0][0]).toBe(1);              // as-typed magnitude, never a UnitCell
    expect((out as unknown[][]).flat().some(isUnitCell)).toBe(false);
    // A km list stacked on a km GRID still agrees — both sides reduce to the same tag.
    const mixedRank = new M.StackNode({ op: "vstack",  valueKeys: ["t0", "t1"] });
    wrapNodeData(mixedRank);
    expect(matrixUnitOf((mixedRank.data({ t0: [kmList()], t1: [kmGrid()] }) as { result: unknown }).result))
      .toMatchObject({ display: "km" });
    // Disagreeing units strip, same uniform-or-nothing rule as the grid case.
    const h = new M.StackNode({ op: "hstack",  valueKeys: ["t0", "t1"] });
    wrapNodeData(h);
    expect(matrixUnitOf((h.data({ t0: [kmList()], t1: [[fromUnit(3, kg, "kg")]] }) as { result: unknown }).result))
      .toBeUndefined();
  });

  it("convert-to-list: TOCOL / TOROW flatten a grid unit into per-cell list tags", () => {
    const col = new M.TableReshapeNode({ op: "tocol" }).data({ matrix: [kmGrid()] }).result as unknown[];
    expect(col.every((c) => isUnitCell(c) && (c as UnitCell).display === "km")).toBe(true);
    const row = new M.TableReshapeNode({ op: "torow" }).data({ matrix: [kmGrid()] }).result as unknown[];
    expect(row.every((c) => isUnitCell(c) && (c as UnitCell).display === "km")).toBe(true);
  });

  it("convert-to-matrix: WRAPROWS lifts a uniform-unit list into a grid unit (through the real boundary)", () => {
    // A list of km UnitCells (base-SI values, display km) wraps into a km grid whose
    // cells are bare as-typed magnitudes. Run through wrapNodeData because the list
    // input would otherwise be unit-stripped at the boundary (the node is unitAware).
    const n = new M.TableReshapeNode({ op: "wraprows" });
    wrapNodeData(n);
    const km = fcUnitToUnit("km")!, kg = fcUnitToUnit("kg")!;
    const kmList = [fromUnit(1, km, "km"), fromUnit(2, km, "km"), fromUnit(3, km, "km"), fromUnit(4, km, "km")];
    const out = (n.data({ list: [kmList], wrapCount: [2] }) as { result: unknown }).result;
    expect(matrixUnitOf(out)).toMatchObject({ display: "km" });
    expect((out as number[][])[0][0]).toBe(1); // as-typed magnitude, not base-SI 1000
    // A mixed-unit list can't claim one grid unit → strips.
    const mixed = [fromUnit(1, km, "km"), fromUnit(2, kg, "kg")];
    const m2 = new M.TableReshapeNode({ op: "wraprows" });
    wrapNodeData(m2);
    expect(matrixUnitOf((m2.data({ list: [mixed], wrapCount: [2] }) as { result: unknown }).result)).toBeUndefined();
  });

  it("strip: linear algebra drops the unit (documented)", () => {
    // Identity × a km grid: the product is a fresh array with no tag.
    const id = [[1, 0], [0, 1]];
    expect(matrixUnitOf(new M.TableMultNode().data({ a: [kmGrid()], b: [id] }).result)).toBeUndefined();
    expect(matrixUnitOf(new M.MatDetNode({ op: "minverse" }).data({ matrix: [kmGrid()] }).result)).toBeUndefined();
    expect(matrixUnitOf(new M.MatEigenNode().data({ matrix: [kmGrid().map((r, i) => r.map((_, j) => (i === j ? 2 : 1)))] }).vectors)).toBeUndefined();
    const x = new M.MatSolveNode().data({ matrix: [kmGrid()], b: [[1, 1]] }).result;
    expect(Array.isArray(x) && x.every((v) => typeof v === "number")).toBe(true);
  });

  it("na: dimension info / a generated matrix carry no unit", () => {
    const info = new M.TableInfoNode().data({ matrix: [kmGrid()] });
    expect(typeof info.rows === "number" || info.rows === null).toBe(true); // a number, not a tagged value
    expect(matrixUnitOf(new M.TableUnitNode().data({ n: [3] }).result)).toBeUndefined();
  });

  it("author: a NUMBER Table Input tags its own output", () => {
    expect(matrixUnitOf(new M.TableInputNode({ tableText: "1, 2\n3, 4", dataType: "number", unit: "km" }).data().table)).toMatchObject({ display: "km" });
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
    wrapNodeData(n);
    const cell = (n.data({ list: [kmGrid()], index: [1], column: [2] }) as { result: unknown }).result;
    expect(isUnitCell(cell)).toBe(true);
    expect((cell as UnitCell).display).toBe("km");
  });
});

// Guard the guard: keep the imports honest (unused-import trip if a helper is dropped).
void SolenoidSocket; void AdoptiveSocket;
