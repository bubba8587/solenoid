import { ClassicPreset } from "rete";
import { trueAnyIn, strIn, strListIn, cubeIn, cubeOut, frameOut, readInput } from "./shared";
import { cubeFromColumns, relateFramesToCube, relateCubeToFrame, cubeColumnFromValue, cubeRowCount, inferColumn, makeHeaders, frameFromRows, isCubeValue, isFrameValue, type CubeValue, type CubeCell, type FrameValue, type FrameCell } from "../frame";
import { aggregateGroup, type AggOp } from "../frameVerbs";
import { solError, type SolError } from "../errorValue";

// ─── Cube nodes (the recursive container) ─────────────────────────────────────
// A Cube is a Frame whose cells can each hold ANY value (a scalar, a list, a
// matrix, a nested Frame, or another Cube) — the lattice supremum (see frame.ts).
// Two producers, mirroring the two honest ways a cube can be made (see
// docs/cube-node-scope.md):
//   • Build Cube — the manual general constructor. Each extensible `any` input is
//     one cell of a single column, so a non-frame value (a scalar, a list, a
//     cube) gets in by being wired/typed into a row. This is the node that proves
//     "a cell holds any value" — without it the value model's promise is one the
//     node set can't keep.
//   • Nest Join — the data-driven relational path: nest two frames on a shared key.
// Reading a cell back out is the upgraded INDEX (frame/cube-aware, returns `any`).

// ─── BUILD CUBE ────────────────────────────────────────────────────────────────
// Extensible `any` cells → a single named cube column. The cube generalises a
// "list of frames": wire N frames into N rows and you get an N×1 cube whose cells
// are frames. An unwired row accepts a typed scalar (a number) as its cell.

export class BuildCubeNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CubeValue | null = null;
  // Unwired `any` rows accept a typed numeric scalar as their cell; `name` (the
  // column header) is a string input backed here.
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { name: "" };
  nextInputId = 0;
  width = 200;
  height = 250;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("BuildCube");
    this.label = init?.label ?? "Build Cube";
    this.addInput("name", strIn("Column"));
    // Rebuild the exact `v*` rows on load/paste; a fresh node starts with three.
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("v"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 3; i++) this.addValueInput();
    this.addOutput("cube", cubeOut("Cube"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, trueAnyIn(key));
    const n = parseInt(key.replace(/^v/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Ordered cell-input keys (the `v*` rows, in insertion order). */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("v"));
  }

  addValueInput(): string {
    const key = `v${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
    delete this.literals[key];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const cells: CubeCell[] = this.valueInputKeys().map((k) => {
      const wired = inputs[k];
      if (wired && wired.length) return wired[0] as CubeCell;
      return (k in this.literals ? this.literals[k] : null) as CubeCell;
    });
    const name = (inputs.name?.[0] as string | undefined)?.trim() || this.stringLiterals.name?.trim() || "Items";
    this.cachedResult = cubeFromColumns([{ name, cells }]);
    return { cube: this.cachedResult };
  }
}

// ─── NEST JOIN ───────────────────────────────────────────────────────────────────
// Parent + child + the key column they share → a Cube: the parent's columns flow
// through flat, plus one nested column whose every cell is the child rows matching
// that parent row's key (tidyr's nest_join — the dual of a flat Join, which fans out
// instead of nesting). BOTH sockets are `any`:
//   • Parent — a Frame (depth-1 nest) OR a Cube (feeding a previous Nest Join's output
//     deepens the hierarchy one level, nest-joining the child into each leaf frame).
//   • Child — a Frame (each cell nests a flat sub-frame) OR a pre-built Cube (each cell
//     nests a sub-CUBE, keeping the child's own nesting — so an Orders-with-LineItems
//     cube nests whole under Customers in one step, vs. the incremental parent-cube path
//     which adds a flat child one level at a time). Both build Customer→Order→LineItem.

// The child socket is `any` so it takes a Frame OR a Cube (a cube can't narrow into a
// frame socket; and a `cube` socket would wrongly widen a frame child TO a cube, turning
// depth-1 sub-frames into sub-cubes). A bare list/matrix/scalar still widens to a frame
// (coerceValue's frame case, mirrored here).
function asNestChild(v: unknown): FrameValue | CubeValue | null {
  if (v == null) return null;
  if (isCubeValue(v)) return v;
  if (isFrameValue(v)) return v;
  if (Array.isArray(v)) return Array.isArray(v[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
  return frameFromRows([[v]]);
}

export class NestJoinNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CubeValue | SolError | null = null;
  stringLiterals: Record<string, string> = { key: "", name: "" };
  width = 210;
  height = 230;

  constructor(init?: { label?: string }) {
    super("NestJoin");
    this.label = init?.label ?? "Nest Join";
    // `any` on both sides so parent/child can each be a Frame OR a Cube (see above).
    this.addInput("parent", trueAnyIn("Parent"));
    this.addInput("child", trueAnyIn("Child"));
    this.addInput("key", strIn("Key column"));
    this.addInput("name", strIn("Nested name"));
    this.addOutput("cube", cubeOut("Cube"));
  }

  data(inputs: { parent?: unknown[]; child?: unknown[]; key?: string[]; name?: string[] }) {
    const parent = inputs.parent?.[0] ?? null;
    const child = asNestChild(inputs.child?.[0] ?? null);
    const key = (readInput(inputs.key, this.stringLiterals.key ?? "") ?? "").trim();
    const name = (readInput(inputs.name, this.stringLiterals.name ?? "") ?? "").trim();
    if (!child || key === "") { this.cachedResult = null; return { cube: null }; }
    // Cube parent → deepen one level into the nested sub-frames; Frame parent →
    // the original nest join. A WIRED parent that's neither (a bare list / scalar) is
    // a type mistake → #TYPE!, not a silent blank (error-value rule); an UNWIRED
    // parent (null) stays blank, like any incomplete input.
    this.cachedResult = isCubeValue(parent)
      ? relateCubeToFrame(parent, child, key, name)
      : isFrameValue(parent)
        ? relateFramesToCube(parent, child, key, name)
        : parent != null
          ? solError("#TYPE!", "Nest Join parent must be a Frame or a Cube")
          : null;
    return { cube: this.cachedResult };
  }
}

// ─── CUBE COLUMNS ──────────────────────────────────────────────────────────────
// Assemble a MULTI-column cube from N column inputs (the columns-wise complement of
// the cell-wise Build Cube). Each extensible `any` input is one column: a wired list
// → its elements are the cells; a single-column cube (e.g. from Build Cube) → that
// column's cells; a frame/scalar → one cell. A `names` CSV labels the columns
// positionally. Build Cube wraps values into one nested column; Cube Columns lines
// several columns up side by side — together they make a Customers[id, name, orders]
// cube without a "list of frames" socket type.

export class CubeColumnsNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CubeValue | null = null;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { names: "" };
  nextInputId = 0;
  width = 210;
  height = 250;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("CubeColumns");
    this.label = init?.label ?? "Cube Columns";
    this.addInput("names", strListIn("Names"));
    const cKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("c"));
    if (cKeys.length) for (const k of cKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("cube", cubeOut("Cube"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, trueAnyIn(key));
    const n = parseInt(key.replace(/^c/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Ordered column-input keys (the `c*` rows, in insertion order). */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("c"));
  }

  addValueInput(): string {
    const key = `c${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
    delete this.literals[key];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const names = (inputs.names?.[0] as string[] | undefined) ?? [];
    const cols = this.valueInputKeys().map((k, i) => {
      const wired = inputs[k];
      const value = wired && wired.length ? wired[0] : (k in this.literals ? this.literals[k] : null);
      return { name: (names[i] ?? "").trim() || `Col${i + 1}`, cells: cubeColumnFromValue(value) };
    });
    const maxLen = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
    const padded = cols.map((c) => ({ name: c.name, cells: Array.from({ length: maxLen }, (_, r) => (c.cells[r] ?? null) as CubeCell) }));
    this.cachedResult = cubeFromColumns(padded);
    return { cube: this.cachedResult };
  }
}

// ─── CUBE ROLLUP ─────────────────────────────────────────────────────────────
// Aggregate one column INSIDE each row's nested sub-frame, flattening the cube
// back to a plain Frame with the roll-up appended as a new column — "cost of an
// assembly = SUM of its nested parts". The BOM/nested-costing vertical's one bit
// of new mechanics: everything else (parent/child → Cube, per-row extended-cost
// columns) is Nest Join + Join + Add Column, already built. Reuses `aggregateGroup`
// (the Group By aggregator) so a roll-up and a Group By agree on every op's edge
// cases (null-skip, error-propagate, empty-group values) — no new aggregation math.

export class CubeRollupNode extends ClassicPreset.Node {
  label: string;
  op: AggOp;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { nested: "", column: "", as: "Total" };
  width = 220;
  height = 260;

  constructor(init?: { label?: string; op?: AggOp }) {
    super("CubeRollup");
    this.label = init?.label ?? "Cube Rollup";
    this.op = init?.op ?? "sum";
    this.addInput("cube", cubeIn("Cube"));
    this.addInput("nested", strIn("Nested column"));
    this.addInput("column", strIn("Column to roll up"));
    this.addInput("as", strIn("Output name"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { cube?: (CubeValue | null)[]; nested?: string[]; column?: string[]; as?: string[] }) {
    const cube = inputs.cube?.[0] ?? null;
    if (!cube) { this.cachedResult = null; return { frame: null }; }
    const nestedName = (readInput(inputs.nested, this.stringLiterals.nested ?? "") ?? "").trim();
    const col = (readInput(inputs.column, this.stringLiterals.column ?? "") ?? "").trim();
    const outName = (readInput(inputs.as, this.stringLiterals.as ?? "Total") ?? "").trim() || "Total";
    const nestedIdx = cube.columns.findIndex((c) => c.name === nestedName);
    if (nestedName === "" || col === "") { this.cachedResult = null; return { frame: null }; }
    if (nestedIdx < 0) {
      this.cachedResult = solError("#REF!", `nested column "${nestedName}" not found`);
      return { frame: this.cachedResult };
    }

    const flatCols = cube.columns.filter((_, j) => j !== nestedIdx);
    const nested = cube.columns[nestedIdx];
    const rows = cubeRowCount(cube);
    const flatVals: FrameCell[][] = flatCols.map(() => []);
    const rolled: FrameCell[] = [];
    for (let i = 0; i < rows; i++) {
      flatCols.forEach((fc, k) => flatVals[k].push((fc.cells[i] ?? null) as FrameCell));
      const cell = nested.cells[i];
      const sub = isFrameValue(cell) ? cell : null;
      if (!sub) { rolled.push(null); continue; }
      const valueCol = sub.columns.find((c) => c.name === col);
      rolled.push(valueCol ? aggregateGroup(valueCol.values, this.op) : solError("#REF!", `column "${col}" not found in nested frame`));
    }
    const names = makeHeaders([...flatCols.map((c) => c.name), outName], flatCols.length + 1);
    const result: FrameValue = {
      __frame: true,
      columns: [
        ...flatCols.map((_, k) => ({ ...inferColumn(names[k], flatVals[k]), name: names[k] })),
        { name: names[flatCols.length], type: "number", values: rolled },
      ],
    };
    this.cachedResult = result;
    return { frame: result };
  }
}
