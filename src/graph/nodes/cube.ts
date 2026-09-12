import { ClassicPreset } from "rete";
import { trueAnyIn, strIn, strListIn, cubeIn, cubeOut, frameOut, readInput } from "./shared";
import { parseCubeRecords, DEFAULT_CUBE_TEXT } from "../literalEditors";
import { cubeFromColumns, recordsToCube, relateFramesToCube, relateCubeToFrame, cubeColumnFromValue, cubeRowCount, inferColumn, makeHeaders, frameFromRows, isCubeValue, isFrameValue, type CubeValue, type CubeCell, type FrameValue, type FrameCell } from "../frame";
import { aggregateGroup, type AggOp } from "../frameVerbs";
import { solError, isSolError, type SolError } from "../errorValue";

/** An unwired wildcard row's typed cell: exactly one of the two literal maps holds it. */
function literalCell(node: { literals: Record<string, number>; stringLiterals: Record<string, string> }, key: string): CubeCell {
  if (key in node.literals) return node.literals[key] as CubeCell;
  if (key in node.stringLiterals) return node.stringLiterals[key] as CubeCell;
  return null as CubeCell;
}

export class BuildCubeNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CubeValue | null = null;
  // Unwired `any` rows take a typed scalar cell, number or text (autoLiterals); `name`
  // is a string.
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { name: "" };
  autoLiterals = true;
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
    delete this.stringLiterals[key];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const cells: CubeCell[] = this.valueInputKeys().map((k) => {
      const wired = inputs[k];
      if (wired && wired.length) return wired[0] as CubeCell;
      return literalCell(this, k);
    });
    // Read raw, guard, THEN trim: a wired blank name is unknown, not "Items".
    const nameRaw = readInput(inputs.name as string[] | undefined, this.stringLiterals.name ?? "");
    if (nameRaw === null) { this.cachedResult = null; return { cube: null }; }
    const name = nameRaw.trim() || "Items";
    this.cachedResult = cubeFromColumns([{ name, cells }]);
    return { cube: this.cachedResult };
  }
}

// The child socket is `any` so it takes a Frame OR a Cube: a cube can't narrow into a
// frame socket, and a `cube` socket would widen a frame child TO a cube, turning depth-1
// sub-frames into sub-cubes.
function asNestChild(v: unknown): FrameValue | CubeValue | null {
  if (v == null) return null;
  if (isCubeValue(v)) return v;
  if (isFrameValue(v)) return v;
  if (Array.isArray(v)) return Array.isArray(v[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
  return frameFromRows([[v]]);
}

export class NestJoinNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    key: "A blank key cell never matches. A parent row without matches keeps an empty nested table, and a child row matching no parent is dropped.",
  };

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
    // Read raw, guard, THEN trim: `?? ""` would collapse a wired blank into the empty
    // literal's "not chosen" reading.
    const keyRaw = readInput(inputs.key, this.stringLiterals.key ?? "");
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "");
    if (keyRaw === null || nameRaw === null) { this.cachedResult = null; return { cube: null }; }
    const key = keyRaw.trim();
    const name = nameRaw.trim();
    if (!child || key === "") { this.cachedResult = null; return { cube: null }; }
    // Cube parent → deepen one level into the nested sub-frames; Frame parent → the
    // original nest join; a WIRED parent that is neither → #TYPE!, never a silent blank;
    // an UNWIRED parent stays blank.
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

// Each extensible `any` input is one COLUMN: a wired list → its elements are the cells;
// a single-column cube → that column's cells; a frame/scalar → one cell.

export class CubeColumnsNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CubeValue | null = null;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = { names: "" };
  autoLiterals = true;
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
    delete this.stringLiterals[key];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const names = (inputs.names?.[0] as string[] | undefined) ?? [];
    const cols = this.valueInputKeys().map((k, i) => {
      const wired = inputs[k];
      const value = wired && wired.length ? wired[0] : literalCell(this, k);
      return { name: (names[i] ?? "").trim() || `Col${i + 1}`, cells: cubeColumnFromValue(value) };
    });
    const maxLen = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
    const padded = cols.map((c) => ({ name: c.name, cells: Array.from({ length: maxLen }, (_, r) => (c.cells[r] ?? null) as CubeCell) }));
    this.cachedResult = cubeFromColumns(padded);
    return { cube: this.cachedResult };
  }
}

// Reuses `aggregateGroup` (the Group By aggregator) so a roll-up and a Group By agree
// on every op's edge cases.

export class CubeRollupNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "A row without a nested table rolls up to blank, and a nested table missing the column yields a #REF! cell.",
  };

  label: string;
  agg: AggOp;
  cachedResult: FrameValue | SolError | null = null;
  stringLiterals: Record<string, string> = { nested: "", column: "", as: "Total" };
  width = 220;
  height = 260;

  constructor(init?: { label?: string; agg?: AggOp }) {
    super("CubeRollup");
    this.label = init?.label ?? "Cube Rollup";
    this.agg = init?.agg ?? "sum";
    this.addInput("cube", cubeIn("Cube"));
    this.addInput("nested", strIn("Nested column"));
    this.addInput("column", strIn("Column to roll up"));
    this.addInput("as", strIn("Output name"));
    this.addOutput("frame", frameOut("Frame"));
  }

  data(inputs: { cube?: (CubeValue | null)[]; nested?: string[]; column?: string[]; as?: string[] }) {
    const cube = inputs.cube?.[0] ?? null;
    if (!cube) { this.cachedResult = null; return { frame: null }; }
    // Read raw, guard, THEN trim — a wired blank is unknown, never the default.
    const nestedRaw = readInput(inputs.nested, this.stringLiterals.nested ?? "");
    const colRaw = readInput(inputs.column, this.stringLiterals.column ?? "");
    const asRaw = readInput(inputs.as, this.stringLiterals.as ?? "Total");
    if (nestedRaw === null || colRaw === null || asRaw === null) { this.cachedResult = null; return { frame: null }; }
    const nestedName = nestedRaw.trim();
    const col = colRaw.trim();
    const outName = asRaw.trim() || "Total";
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
      // A child is a frame OR a cube (the readers nest cubes after A'); a cube's flat cells
      // roll up, a nested cell inside them is the loud #SHAPE!.
      const values: FrameCell[] | SolError | null = isFrameValue(cell)
        ? (cell.columns.find((c) => c.name === col)?.values ?? solError("#REF!", `column "${col}" not found in nested frame`))
        : isCubeValue(cell)
          ? (() => {
              const cc = cell.columns.find((c) => c.name === col);
              if (!cc) return solError("#REF!", `column "${col}" not found in nested cube`);
              if (cc.cells.some((v) => isCubeValue(v) || isFrameValue(v) || Array.isArray(v))) return solError("#SHAPE!", `column "${col}" holds nested cells; roll up a flat column`);
              return cc.cells as FrameCell[];
            })()
          : null;
      if (values === null) { rolled.push(null); continue; }
      rolled.push(isSolError(values) ? values : aggregateGroup(values, this.agg));
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

// ─── Cube Input: the literal cube source ──────────────────────────────────────────
// The fourth literal input beside Table / Frame / List Input. `cubeText` is the stored
// truth — JSON rows of records, a cell scalar | list | rows-of-records — and the cube
// derives at compute (recordsToCube: a list value is a LIST cell, never joined into text).
// Edited through the same popup surface as the others (cubePopup's edit binding).
export class CubeInputNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    cube: "One row per record. A list value is a list cell; a list of records nests a table or a cube.",
  };
  label: string;
  cubeText: string;
  cachedResult: CubeValue | SolError | null = null;
  width = 240; height = 200;

  constructor(init?: { label?: string; cubeText?: string }) {
    super("CubeInput");
    this.label = init?.label ?? "Cube Input";
    this.cubeText = typeof init?.cubeText === "string" ? init.cubeText : DEFAULT_CUBE_TEXT;
    this.addOutput("cube", cubeOut("Cube"));
  }

  data(): { cube: CubeValue | SolError | null } {
    const parsed = parseCubeRecords(this.cubeText);
    this.cachedResult = "error" in parsed ? solError("#VALUE!", parsed.error) : recordsToCube(parsed.records);
    return { cube: this.cachedResult };
  }
}
