import { ClassicPreset } from "rete";
import { anyIn, strIn, strListIn, frameIn, cubeOut } from "./shared";
import { cubeFromColumns, relateFramesToCube, relateCubeToFrame, cubeColumnFromValue, isCubeValue, isFrameValue, type CubeValue, type CubeCell, type FrameValue } from "../frame";
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
    this.addInput(key, anyIn(key));
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
// Parent + child frame + the key column they share → a Cube: the parent's columns
// flow through flat, plus one nested column whose every cell is the sub-frame of
// child rows matching that parent row's key (tidyr's nest_join — the dual of a flat
// Join, which fans out instead of nesting). The Parent socket is `any`, so it also
// takes a CUBE: feeding a previous Nest Join's output deepens the hierarchy by one
// level (Customer → Order → LineItem), nest-joining the child into each leaf frame.

export class NestJoinNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CubeValue | SolError | null = null;
  stringLiterals: Record<string, string> = { key: "", name: "" };
  width = 210;
  height = 230;

  constructor(init?: { label?: string }) {
    super("NestJoin");
    this.label = init?.label ?? "Nest Join";
    // `any` so the parent can be a Frame (depth-1 nest) OR a Cube (deepen one level).
    this.addInput("parent", anyIn("Parent"));
    this.addInput("child", frameIn("Child"));
    this.addInput("key", strIn("Key column"));
    this.addInput("name", strIn("Nested name"));
    this.addOutput("cube", cubeOut("Cube"));
  }

  data(inputs: { parent?: unknown[]; child?: (FrameValue | null)[]; key?: string[]; name?: string[] }) {
    const parent = inputs.parent?.[0] ?? null;
    const child = inputs.child?.[0] ?? null;
    const key = (inputs.key?.[0] ?? this.stringLiterals.key ?? "").trim();
    const name = (inputs.name?.[0] ?? this.stringLiterals.name ?? "").trim();
    if (!child || key === "") { this.cachedResult = null; return { cube: null }; }
    // Cube parent → deepen one level into the nested sub-frames; Frame parent →
    // the original depth-1 nest join. A WIRED parent that's neither (a bare list /
    // scalar) is a type mistake → #TYPE!, not a silent blank (error-value rule);
    // an UNWIRED parent (null) stays blank, like any incomplete input.
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
    this.addInput(key, anyIn(key));
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
