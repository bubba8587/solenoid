// [[C10]] socketLattice (the Cube is the lattice supremum), [[C28]] literalsIffEditable
import { ClassicPreset } from "rete";
import { trueAnyIn, strIn, strListIn, cubeIn, cubeOut, frameOut, readInput } from "./shared";
import { parseCubeRecords, DEFAULT_CUBE_TEXT } from "../literalEditors";
import { cubeFromColumns, recordsToCube, relateFramesToCube, relateCubeToFrame, cubeColumnFromValue, cubeRowCount, inferColumn, typedColumn, makeHeaders, frameFromRows, isCubeValue, isFrameValue, type CubeValue, type CubeCell, type FrameValue, type FrameColumn, type FrameCell, type FrameColType } from "../frame";
import { aggregateGroup, aggUnitPlan, type AggOp } from "../frameVerbs";
import { matrixCellsFromList, tagFrameCellUnit } from "../unitColumn";
import type { ColumnUnit } from "../unitValue";
import { solError, isSolError, type SolError } from "../errorValue";

function literalCell(node: { literals: Record<string, number>; stringLiterals: Record<string, string> }, key: string): CubeCell {
  if (key in node.literals) return node.literals[key] as CubeCell;
  if (key in node.stringLiterals) return node.stringLiterals[key] as CubeCell;
  return null as CubeCell;
}

export class BuildCubeNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CubeValue | null = null;
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
    const nameRaw = readInput(inputs.name as string[] | undefined, this.stringLiterals.name ?? "");
    if (nameRaw === null) { this.cachedResult = null; return { cube: null }; }
    const name = nameRaw.trim() || "Items";
    this.cachedResult = cubeFromColumns([{ name, cells }]);
    return { cube: this.cachedResult };
  }
}

// trueany, not frame or cube: a Cube cannot narrow into a frame socket, and a cube socket would widen a Frame child into a Cube.
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
    this.addInput("parent", trueAnyIn("Parent"));
    this.addInput("child", trueAnyIn("Child"));
    this.addInput("key", strIn("Key column"));
    this.addInput("name", strIn("Nested name"));
    this.addOutput("cube", cubeOut("Cube"));
  }

  data(inputs: { parent?: unknown[]; child?: unknown[]; key?: string[]; name?: string[] }) {
    const parent = inputs.parent?.[0] ?? null;
    const child = asNestChild(inputs.child?.[0] ?? null);
    const keyRaw = readInput(inputs.key, this.stringLiterals.key ?? "");
    const nameRaw = readInput(inputs.name, this.stringLiterals.name ?? "");
    if (keyRaw === null || nameRaw === null) { this.cachedResult = null; return { cube: null }; }
    const key = keyRaw.trim();
    const name = nameRaw.trim();
    if (!child || key === "") { this.cachedResult = null; return { cube: null }; }
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

// Reuses aggregateGroup and aggUnitPlan so a roll-up and a GROUPBY agree on every op's edge cases and units.

/** The rows agree on one unit, or the column carries none ([[D43]] unitByGranularity). */
function rolledNumberColumn(name: string, rolled: readonly unknown[]): FrameColumn {
  const { mags, unit } = matrixCellsFromList(rolled);
  return { name, type: "number", values: mags as FrameCell[], ...(unit ? { unit } : {}) };
}

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
    const rolled: unknown[] = [];
    let textRolled = false;
    for (let i = 0; i < rows; i++) {
      flatCols.forEach((fc, k) => flatVals[k].push((fc.cells[i] ?? null) as FrameCell));
      const cell = nested.cells[i];
      let type: FrameColType | undefined;
      let unit: ColumnUnit | undefined;
      const values: FrameCell[] | SolError | null = isFrameValue(cell)
        ? (() => {
            const fc = cell.columns.find((c) => c.name === col);
            if (!fc) return solError("#REF!", `column "${col}" not found in nested frame`);
            type = fc.type;
            unit = fc.unit;
            return fc.values;
          })()
        : isCubeValue(cell)
          ? (() => {
              const cc = cell.columns.find((c) => c.name === col);
              if (!cc) return solError("#REF!", `column "${col}" not found in nested cube`);
              if (cc.cells.some((v) => isCubeValue(v) || isFrameValue(v) || Array.isArray(v))) return solError("#SHAPE!", `column "${col}" holds nested cells; roll up a flat column`);
              // A cube cell carries its own base-SI unit; read the column in one unit, as a Frame does.
              const { mags, unit: u } = matrixCellsFromList(cc.cells);
              unit = u;
              if (cc.type) { type = cc.type; return mags as FrameCell[]; }
              const read = inferColumn(col, mags);
              type = read.type;
              return read.values;
            })()
          : null;
      if (values === null) { rolled.push(null); continue; }
      const plan = aggUnitPlan(this.agg, unit);
      const r = isSolError(values) ? values : plan.cell(aggregateGroup(values, this.agg, type));
      if (typeof r === "string") textRolled = true;
      rolled.push(plan.unit ? tagFrameCellUnit(r, plan.unit) : r);
    }
    const names = makeHeaders([...flatCols.map((c) => c.name), outName], flatCols.length + 1);
    const result: FrameValue = {
      __frame: true,
      columns: [
        ...flatCols.map((_, k) => ({ ...inferColumn(names[k], flatVals[k]), name: names[k] })),
        textRolled
          ? typedColumn(names[flatCols.length], rolled, rolled.length, "string")
          : rolledNumberColumn(names[flatCols.length], rolled),
      ],
    };
    this.cachedResult = result;
    return { frame: result };
  }
}

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
