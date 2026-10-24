// [[C10]] socketLattice (the Cube is the lattice supremum), [[C28]] literalsIffEditable
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { trueAnyIn, strIn, strListIn, cubeIn, cubeOut, frameOut } from "./shared";
import { parseCubeSource, recordKeys, sourcePicks, DEFAULT_CUBE_TEXT, type CubeSource } from "../literalEditors";
import { makeCube, recordsToCube, type CubeValue, type CubeColumn, type FrameValue } from "../frame";
import type { AggOp } from "../frameOps";
import { solError, type SolError } from "../errorValue";
import { volatileStamp } from "../volatileDates";

export class BuildCubeNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { cube: CubeValue | null } {
    return nodeOnCore(this, inputs) as { cube: CubeValue | null };
  }
}

export class NestJoinNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { cube: CubeValue | SolError | null } {
    return nodeOnCore(this, inputs) as { cube: CubeValue | SolError | null };
  }
}

export class CubeColumnsNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { cube: CubeValue | null } {
    return nodeOnCore(this, inputs) as { cube: CubeValue | null };
  }
}

export class CubeRollupNode extends GraphNode {
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

  data(inputs: Record<string, unknown[] | undefined>): { frame: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { frame: FrameValue | SolError | null };
  }
}

/** A Cube Input's records as its formula columns read them: the records' cube in the source's column order, each
 *  formula column empty, beside each column's formula (null for a data column). The text's key order and the
 *  records' reading are JS's, shared with the Cube popup's editor ([[D90]] cubeTypesAtDepth). */
function cubeSourceColumns(source: CubeSource): { cube: CubeValue; exprs: (string | null)[] } {
  const data = recordsToCube(source.rows, sourcePicks(source), source.nested);
  const keys = recordKeys(source.rows);
  const rows = source.rows.length;
  const cols: CubeColumn[] = source.columns.map((c) => {
    const k = c.expr === undefined ? keys.indexOf(c.name) : -1;
    return k >= 0 ? { ...data.columns[k], name: c.name } : { name: c.name, cells: Array.from({ length: rows }, () => null) };
  });
  return { cube: makeCube(cols), exprs: source.columns.map((c) => c.expr ?? null) };
}

export class CubeInputNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    cube: "One row per record. A list value is a list cell; a list of records nests a table or a cube.",
  };
  label: string;
  cubeText: string;
  cachedResult: CubeValue | SolError | null = null;
  width = 240; height = 200;
  private _builtFrom: string | undefined;
  private _builtStamp = -1;

  constructor(init?: { label?: string; cubeText?: string }) {
    super("CubeInput");
    this.label = init?.label ?? "Cube Input";
    this.cubeText = typeof init?.cubeText === "string" ? init.cubeText : DEFAULT_CUBE_TEXT;
    this.addOutput("cube", cubeOut("Cube"));
  }

  data(): { cube: CubeValue | SolError | null } {
    const stamp = volatileStamp(this.cubeText);
    if (this.cachedResult && this._builtFrom === this.cubeText && this._builtStamp === stamp) return { cube: this.cachedResult };
    const parsed = parseCubeSource(this.cubeText);
    if ("error" in parsed) this.cachedResult = solError("#VALUE!", parsed.error);
    else {
      const { cube, exprs } = cubeSourceColumns(parsed.source);
      this.cachedResult = this.body({ cube: [cube], exprs: [exprs] }).cube;
    }
    this._builtFrom = this.cubeText;
    this._builtStamp = stamp;
    return { cube: this.cachedResult };
  }

  /** The formula columns over the records' cube (`cubeSourceColumns`). */
  body(inputs: Record<string, unknown[] | undefined>): { cube: CubeValue } {
    return nodeOnCore(this, inputs) as { cube: CubeValue };
  }
}
