// [[D38]] kleeneLogic, [[D36]] nullSkippedNotZero
import { ClassicPreset } from "rete";
import { numListIn, logicalComboOut, logicalComboIn, logicalIn, numIn, anyIn, trueAnyIn, trueAnyOut, staticTrueAnyOut, keepInputLast } from "./shared";
import { rolesFrom } from "../inputRoles";
import type { PassthroughSpec } from "./passthrough";
import { isSolError, isNaError, solError, type SolError } from "../errorValue";
import { isMissing, type Tri } from "../valueKinds";
import { isUnitCell } from "../unitValue";
import { nodeOnCore } from "../nodeOnCore";
import { isFrameValue, isCubeValue, frameRowCount, type FrameValue, type FrameColType } from "../frame";

function frameCells(f: FrameValue): unknown[][] {
  const rows = frameRowCount(f);
  return Array.from({ length: rows }, (_, i) => f.columns.map((c) => c.values[i] ?? null));
}

type LiteralHost = { literals: Record<string, number>; stringLiterals: Record<string, string> };

function typedLiteral(node: LiteralHost, key: string): number | string | undefined {
  const text = node.stringLiterals[key];
  return text !== undefined ? text : node.literals[key];
}

/** The one reader for every `autoLiterals` wildcard slot: a connected cable wins even carrying null. */
export function pickSlot(node: LiteralHost, inputs: Record<string, unknown[] | undefined>, key: string): unknown {
  if (inputs[key]?.length) return inputs[key][0];
  return typedLiteral(node, key) ?? null;
}

// Load and paste must rebuild the exact pair ids, or literals and cables misalign.
export function pairIdsFromKeys(valueKeys: string[] | undefined, prefixA: string): number[] {
  if (!valueKeys) return [];
  const ids: number[] = [];
  for (const k of valueKeys) {
    if (k.startsWith(prefixA)) {
      const n = parseInt(k.slice(prefixA.length), 10);
      if (Number.isInteger(n)) ids.push(n);
    }
  }
  return ids.sort((a, b) => a - b);
}

// ─── Comparison ──────────────────────────────────────────────────────────────

export type ComparisonOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

export function compareOp(op: ComparisonOp, x: number, y: number): boolean {
  switch (op) {
    case "gt":  return x > y;
    case "gte": return x >= y;
    case "lt":  return x < y;
    case "lte": return x <= y;
    case "eq":  return x === y;
    case "neq": return x !== y;
  }
}

// `label` is the name alone because an Add-menu search row showing a bare ≥ says nothing.
export const COMPARISON_OP_META = {
  gt:  { symbol: ">", label: "Greater than",     description: "`TRUE` when A is greater than B. Excel: `A>B`." },
  gte: { symbol: "≥", label: "Greater or equal", description: "`TRUE` when A is greater than or equal to B. Excel: `A>=B`." },
  lt:  { symbol: "<", label: "Less than",        description: "`TRUE` when A is less than B. Excel: `A<B`." },
  lte: { symbol: "≤", label: "Less or equal",    description: "`TRUE` when A is less than or equal to B. Excel: `A<=B`." },
  eq:  { symbol: "=", label: "Equal",            description: "`TRUE` when A equals B. Excel: `A=B`." },
  neq: { symbol: "≠", label: "Not equal",        description: "`TRUE` when A differs from B. Excel: `A<>B`." },
} satisfies Record<ComparisonOp, { symbol: string; label: string; description: string }>;

export class ComparisonNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Ordering different dimensions is #UNIT!; equal is FALSE, not equal TRUE. A plain number against a unit value is read in that value's display unit.",
  };

  /** Keeps UnitCell tags so the comparison runs on base-SI magnitudes and checks commensurability. */
  unitAware = true;
  label: string;
  op: ComparisonOp;
  cachedResult: Tri | Tri[] | SolError = null;
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: ComparisonOp }) {
    super("Comparison");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "gt";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Tri | Tri[] | SolError };
  }
}

// ─── BETWEEN / IS CLOSE ───────────────────────────────────────────────────────
export class BetweenNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "TRUE when Low ≤ Value ≤ High (inclusive). Broadcasts over a list of Values. R between / pandas Series.between.",
  };
  label: string;
  cachedResult: Tri | Tri[] = null;
  literals: Record<string, number> = { value: 0, lo: 0, hi: 1 };
  width = 180;
  height = 235;

  constructor(init?: { label?: string }) {
    super("Between");
    this.label = init?.label ?? "Between";
    this.addInput("value", numListIn("Value"));
    this.addInput("lo", numIn("Low"));
    this.addInput("hi", numIn("High"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Tri | Tri[] };
  }
}

export class IsCloseNode extends ClassicPreset.Node {
  static inputRoles = rolesFrom("ISCLOSE", { tol: 2 });
  static socketDocs: Record<string, string> = {
    result: "TRUE when |A − B| ≤ tolerance: approximate equality for floats. Broadcasts element-wise. math.isclose.",
  };
  label: string;
  cachedResult: Tri | Tri[] = null;
  literals: Record<string, number> = { a: 0, b: 0, tol: 1e-9 };
  width = 180;
  height = 235;

  constructor(init?: { label?: string }) {
    super("IsClose");
    this.label = init?.label ?? "Is Close";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addInput("tol", numIn("Tolerance"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Tri | Tri[] };
  }
}

// ─── IF ───────────────────────────────────────────────────────────────────────

export class IfNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    cond: "A list condition picks element by element from the two branches. A blank condition gives a blank result.",
  };

  label: string;
  cachedResult: unknown = null;
  literals: Record<string, number> = { cond: 0, then: 0, else: 0 };
  stringLiterals: Record<string, string> = {};
  autoLiterals = true;
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("If");
    this.label = init?.label ?? "IF";
    this.addInput("cond", logicalComboIn("Condition"));
    this.addInput("then", trueAnyIn("Value if true"));
    this.addInput("else", trueAnyIn("Value if false"));
    this.addOutput("result", trueAnyOut("Result"));
  }

  /** The chosen branch's key for unit flow; a list condition picks per element, so it is null and the branches must agree. */
  _selectedUnitKey: string | null = null;
  passthrough(): PassthroughSpec[] {
    return [{ output: "result", inputs: ["then", "else"], combine: "agree", selected: () => this._selectedUnitKey }];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── Boolean ops (variadic reducers) ─────────────────────────────────────────

export type BooleanOp = "and" | "or" | "xor" | "nand" | "nor" | "xnor";

export const BOOLEAN_OP_META = {
  and:  { label: "AND",  description: "`TRUE` if all inputs are true. Excel: `AND`." },
  or:   { label: "OR",   description: "`TRUE` if any input is true. Excel: `OR`." },
  xor:  { label: "XOR",  description: "`TRUE` if an odd number of inputs are true. Excel: `XOR`." },
  nand: { label: "NAND", description: "Negated `AND`: `FALSE` only when every input is true. Excel: `NOT(AND(…))`." },
  nor:  { label: "NOR",  description: "Negated `OR`: `TRUE` only when every input is false. Excel: `NOT(OR(…))`." },
  xnor: { label: "XNOR", description: "`TRUE` if an even number of inputs are true. The negation of `XOR`." },
} satisfies Record<BooleanOp, { label: string; description: string }>;

export class BooleanOpNode extends ClassicPreset.Node {
  label: string;
  op: BooleanOp;
  cachedResult: Tri | Tri[] = null;
  literals: Record<string, number> = {};
  nextInputId = 0;
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: BooleanOp; valueKeys?: string[] }) {
    super("BooleanOp");
    this.op = init?.op ?? "and";
    this.label = init?.label ?? "";
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("a"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("result", logicalComboOut("Result"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, logicalComboIn(key));
    const n = parseInt(key.replace(/^a/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("a"));
  }

  addValueInput(): string {
    const key = `a${this.nextInputId}`;
    this.addInputWithKey(key);
    return key;
  }

  removeValueInput(key: string): void {
    this.removeInput(key);
    delete this.literals[key];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Tri | Tri[] };
  }
}

// ─── NOT ──────────────────────────────────────────────────────────────────────

export class NotNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    in: "A wired blank is unknown, so the result is blank rather than TRUE.",
  };

  label: string;
  cachedResult: Tri | Tri[] = null;
  literals: Record<string, number> = { in: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Not");
    this.label = init?.label ?? "NOT";
    this.addInput("in", logicalComboIn("In"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Tri | Tri[] };
  }
}

// ─── IFERROR ──────────────────────────────────────────────────────────────────

export type IFErrorMode = "iferror" | "ifna";

export class IFErrorNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "A blank is not an error and passes through untouched. A Frame or Cube is caught cell by cell.",
    fallback: "Replaces each caught cell. A list fallback pairs with the value by position; over a Frame or Cube it is one value that must suit each column's type.",
  };

  label: string;
  op: IFErrorMode;
  cachedResult: unknown = null;
  literals: Record<string, number> = { value: 0, fallback: 0 };
  width = 180;
  height = 200;
  passthrough(): PassthroughSpec[] { return [{ output: "result", inputs: ["value", "fallback"], combine: "agree" }]; }

  constructor(init?: { label?: string; op?: IFErrorMode }) {
    super("IFError");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "iferror";
    this.addInput("value",    trueAnyIn("Value"));
    this.addInput("fallback", trueAnyIn("Fallback"));
    this.addOutput("result",  trueAnyOut("Result"));
  }

  data(inputs: { value?: unknown[]; fallback?: unknown[] }) {
    // Test connection presence, not `?? literal`, which would hide a wired blank behind the literal.
    const rawValue = inputs.value && inputs.value.length ? inputs.value[0] : (this.literals.value ?? null);
    const fallback = inputs.fallback && inputs.fallback.length ? inputs.fallback[0] : (this.literals.fallback ?? 0);
    // Errors reach this node raw because it is an error consumer.
    const caught = (v: unknown): boolean =>
      this.op === "iferror" ? isSolError(v) : isNaError(v);
    const result = replaceCaught(rawValue, fallback, caught);
    this.cachedResult = result;
    return { result };
  }
}

/** Whether a fallback can sit in a column of this type without blending families ([[B17]] typedValueModel). */
function fitsColumn(fallback: unknown, type: FrameColType | undefined): boolean {
  if (fallback == null || isSolError(fallback) || type === undefined) return true;
  if (typeof fallback === "number" || isUnitCell(fallback)) return type === "number" || type === "date";
  if (typeof fallback === "string") return type === "string";
  if (typeof fallback === "boolean") return type === "logical";
  return false;
}

/** Each caught cell becomes the fallback: in a list item by item, in a Frame or Cube cell by cell, where a fallback
 *  that doesn't suit its column's type is that cell's #TYPE! instead. */
function replaceCaught(value: unknown, fallback: unknown, caught: (v: unknown) => boolean, type?: FrameColType): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => replaceCaught(v, Array.isArray(fallback) ? fallback[i] : fallback, caught, type));
  }
  if (isFrameValue(value) || isCubeValue(value)) {
    if (Array.isArray(fallback) || isFrameValue(fallback) || isCubeValue(fallback)) {
      return solError("#VALUE!", "Over a Frame or Cube the fallback is one value, used for every caught cell");
    }
    const cellFor = (cell: unknown, colName: string, colType: FrameColType | undefined): unknown => {
      if (isFrameValue(cell) || isCubeValue(cell) || Array.isArray(cell)) return replaceCaught(cell, fallback, caught, colType);
      if (!caught(cell)) return cell;
      return fitsColumn(fallback, colType)
        ? fallback
        : solError("#TYPE!", `The fallback doesn't fit column "${colName}", which holds ${colType} values`);
    };
    if (isFrameValue(value)) {
      const frame: FrameValue = {
        __frame: true,
        columns: value.columns.map(({ raw: _raw, ...c }) => ({ ...c, values: c.values.map((v) => cellFor(v, c.name, c.type)) as typeof c.values })),
      };
      return frame;
    }
    return { ...value, columns: value.columns.map((c) => ({ ...c, cells: c.cells.map((v) => cellFor(v, c.name, c.type)) as typeof c.cells })) };
  }
  if (!caught(value)) return value;
  return fitsColumn(fallback, type) ? fallback : solError("#TYPE!", `The fallback doesn't fit this column, which holds ${type} values`);
}

// ─── IS.TEST ──────────────────────────────────────────────────────────────────

export type IsTestOp = "isnumber" | "isblank" | "isnull" | "iserror" | "iserr" | "isna" | "islogical" | "istext" | "isnontext";

// ISBOOLEAN is Solenoid's name for ISLOGICAL (`formula-language.md` § Excel names on nodes); the `islogical` key stays because saves use it.
export const IS_TEST_OP_META = {
  isnumber:  { label: "ISNUMBER",  description: "`TRUE` when the value is a number. Excel: `ISNUMBER`." },
  isblank:   { label: "ISBLANK",   description: "`TRUE` when the cell is empty. Excel: `ISBLANK`." },
  isnull:    { label: "ISNULL",    description: "`TRUE` when the value is missing." },
  iserror:   { label: "ISERROR",   description: "`TRUE` when the value is any error. Excel: `ISERROR`." },
  iserr:     { label: "ISERR",     description: "`TRUE` when the value is any error but `#N/A`. Excel: `ISERR`." },
  isna:      { label: "ISNA",      description: "`TRUE` when the value is `#N/A`. Excel: `ISNA`." },
  islogical: { label: "ISBOOLEAN", description: "`TRUE` when the value is a Boolean. Excel: `ISLOGICAL`." },
  istext:    { label: "ISTEXT",    description: "`TRUE` when the value is text. Excel: `ISTEXT`." },
  isnontext: { label: "ISNONTEXT", description: "`TRUE` when the value is anything but text. Excel: `ISNONTEXT`." },
} satisfies Record<IsTestOp, { label: string; description: string }>;

function toLogical(r: number | number[] | null): boolean | boolean[] | null {
  return r === null ? null : Array.isArray(r) ? r.map((n) => n === 1) : r === 1;
}

export class IsTestNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "With nothing wired there is nothing to test, so the result is blank. ISBLANK answers TRUE only for a wired blank.",
  };

  label: string;
  op: IsTestOp;
  cachedResult: boolean | boolean[] | boolean[][] | null = null;
  // The card renders this error's code and explanation, so the node is also where an error is read.
  seenError: SolError | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180;
  height = 180;

  constructor(init?: { label?: string; op?: IsTestOp }) {
    super("IsTest");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "isnumber";
    this.addInput("value", trueAnyIn("Value"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: { value?: unknown[] }) {
    const raw = inputs.value?.[0];
    if (raw === undefined) { this.seenError = null; this.cachedResult = null; return { result: null }; }
    const input = raw;
    let result: number | number[] | null = null;
    this.seenError = isSolError(input) ? input : null;
    if (isSolError(input)) {
      result =
        this.op === "iserror" ? 1 :
        this.op === "iserr"   ? (isNaError(input) ? 0 : 1) :
        this.op === "isna"    ? (isNaError(input) ? 1 : 0) :
        0;
      this.cachedResult = toLogical(result);
      return { result: this.cachedResult };
    }
    // A Frame is not an array, so flatten it or the per-cell maps below test it as one cell.
    const value = isFrameValue(input) ? frameCells(input) : input;
    if (this.op === "isnull") {
      const deepNull = (v: unknown): unknown => (Array.isArray(v) ? v.map(deepNull) : isMissing(v));
      this.cachedResult = deepNull(value) as boolean | boolean[] | boolean[][] | null;
      return { result: this.cachedResult };
    }
    if (this.op === "isblank") {
      // ISBLANK tests the whole input as one cell; per-cell missing is ISNULL's job.
      this.cachedResult = input === null;
      return { result: this.cachedResult };
    }
    const test = (x: unknown): boolean => {
      switch (this.op) {
        case "istext":    return typeof x === "string";
        case "isnontext": return typeof x !== "string";
        case "isnumber":  return typeof x === "number" && Number.isFinite(x);
        // A pure type test: only a real boolean passes, so the IS checks partition by type with no overlap.
        case "islogical": return typeof x === "boolean";
        case "iserror":   return isSolError(x);
        case "iserr":     return isSolError(x) && !isNaError(x);
        case "isna":      return isNaError(x);
        default:          return false;
      }
    };
    const deepTest = (v: unknown): boolean | boolean[] | boolean[][] =>
      Array.isArray(v) ? (v.map(deepTest) as boolean[] | boolean[][]) : test(v);
    this.cachedResult = deepTest(value);
    return { result: this.cachedResult };
  }
}

// ─── NA ───────────────────────────────────────────────────────────────────────

export class NaNode extends ClassicPreset.Node {
  label: string;
  cachedResult: SolError;
  /** Abstains in a selector's `agree` vote instead of vetoing, so `IFERROR(aDate, NA())` keeps the date's type. */
  errorOnlyOutput = true;
  width = 140;
  height = 80;

  constructor(init?: { label?: string }) {
    super("Na");
    this.label = init?.label ?? "NA";
    this.cachedResult = solError("#N/A", "Not available");
    // Type-neutral, not `number`: a typed output would vote in a selector's `agree`.
    this.addOutput("result", staticTrueAnyOut("N/A"));
  }

  data() {
    // Must stay a tagged #N/A: only a SolError is catchable by IFERROR and IFNA.
    return { result: this.cachedResult };
  }
}

// ─── Choose ───────────────────────────────────────────────────────────────────

export class ChooseNode extends ClassicPreset.Node {
  static inputRoles = rolesFrom("CHOOSE", { index: 0 });
  static socketDocs: Record<string, string> = {
    index: "A fractional index drops its fraction, like Excel, and an out-of-range one is #VALUE! rather than blank.",
  };

  label: string;
  cachedResult: unknown = null;
  literals: Record<string, number> = { index: 1 };
  stringLiterals: Record<string, string> = {};
  autoLiterals = true;
  nextInputId = 0;
  width = 180;
  height = 250;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("Choose");
    this.label = init?.label ?? "CHOOSE";
    this.addInput("index", numIn("Index"));
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("v"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 4; i++) this.addValueInput();
    this.addOutput("result", trueAnyOut("Result"));
  }

  private addInputWithKey(key: string): void {
    this.addInput(key, trueAnyIn(key));
    const n = parseInt(key.replace(/^v/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("v"));
  }

  _selectedUnitKey: string | null = null;
  passthrough(): PassthroughSpec[] {
    return [{ output: "result", inputs: this.valueInputKeys(), combine: "agree", selected: () => this._selectedUnitKey }];
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
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── Switch ───────────────────────────────────────────────────────────────────

export class SwitchNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    expr: "Cases match by exact equality, with no numeric tolerance. A blank expression gives a blank result rather than matching a blank case.",
    default: "Left unset, an unmatched expression is #N/A. Any typed or wired value, even blank or zero, returns instead.",
  };

  label: string;
  cachedResult: unknown = null;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  autoLiterals = true;
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["When", "Then"];
  width = 180;
  height = 350;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("Switch");
    this.label = init?.label ?? "SWITCH";
    this.addInput("expr", anyIn("Expression"));
    const ids = pairIdsFromKeys(init?.valueKeys, "when");
    if (ids.length) {
      for (const id of ids) this.addPairWithId(id);
    } else {
      for (let i = 0; i < 3; i++) this.addValuePair();
      // A fresh card matches when0 so it shows a real result; Default ships empty.
      this.literals = { expr: 1, when0: 1, then0: 10, when1: 2, then1: 20, when2: 3, then2: 30 };
    }
    this.addInput("default", trueAnyIn("Default"));
    this.addOutput("result", trueAnyOut("Result"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`when${id}`, anyIn(`When ${id + 1}`));
    this.addInput(`then${id}`, trueAnyIn(`Then ${id + 1}`));
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

  valuePairKeys(): Array<[string, string]> {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("when"))
      .map((k) => { const id = k.slice(4); return [`when${id}`, `then${id}`] as [string, string]; });
  }

  _selectedUnitKey: string | null = null;
  passthrough(): PassthroughSpec[] {
    return [{ output: "result", inputs: [...this.valuePairKeys().map(([, then]) => then), "default"], combine: "agree", selected: () => this._selectedUnitKey }];
  }

  addValuePair(): void {
    this.addPairWithId(this.nextPairId);
    keepInputLast(this, "default");
  }

  removeValuePair(aKey: string): void {
    const id = aKey.slice(4);
    this.removeInput(`when${id}`);
    this.removeInput(`then${id}`);
    for (const k of [`when${id}`, `then${id}`]) {
      delete this.literals[k];
      delete this.stringLiterals[k];
    }
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── IFS ──────────────────────────────────────────────────────────────────────

export class IfsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    otherwise: "Left unset, falling through every condition is #N/A. Any typed or wired value, even blank or zero, returns instead.",
  };

  label: string;
  cachedResult: unknown = null;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  autoLiterals = true;
  nextPairId = 0;
  readonly pairLabels: [string, string] = ["If", "Then"];
  width = 180;
  height = 285;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("Ifs");
    this.label = init?.label ?? "IFS";
    const ids = pairIdsFromKeys(init?.valueKeys, "cond");
    if (ids.length) {
      for (const id of ids) this.addPairWithId(id);
    } else {
      for (let i = 0; i < 3; i++) this.addValuePair();
      this.literals = { cond0: 1, val0: 10, cond1: 0, val1: 20, cond2: 0, val2: 30 };
    }
    this.addInput("otherwise", trueAnyIn("Otherwise"));
    this.addOutput("result", trueAnyOut("Result"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`cond${id}`, logicalIn(`Condition ${id + 1}`));
    this.addInput(`val${id}`,  trueAnyIn(`Value ${id + 1}`));
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

  valuePairKeys(): Array<[string, string]> {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("cond"))
      .map((k) => { const id = k.slice(4); return [`cond${id}`, `val${id}`] as [string, string]; });
  }

  _selectedUnitKey: string | null = null;
  passthrough(): PassthroughSpec[] {
    return [{ output: "result", inputs: [...this.valuePairKeys().map(([, val]) => val), "otherwise"], combine: "agree", selected: () => this._selectedUnitKey }];
  }

  addValuePair(): void {
    this.addPairWithId(this.nextPairId);
    keepInputLast(this, "otherwise");
  }

  removeValuePair(aKey: string): void {
    const id = aKey.slice(4);
    this.removeInput(`cond${id}`);
    this.removeInput(`val${id}`);
    for (const k of [`cond${id}`, `val${id}`]) {
      delete this.literals[k];
      delete this.stringLiterals[k];
    }
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: unknown };
  }
}

// ─── ISEVEN / ISODD ───────────────────────────────────────────────────────────

export type ParityOp = "iseven" | "isodd";

export const PARITY_OP_META = {
  iseven: { label: "ISEVEN", description: "`TRUE` if the integer part is even. Excel: `ISEVEN`." },
  isodd:  { label: "ISODD",  description: "`TRUE` if the integer part is odd. Excel: `ISODD`." },
} satisfies Record<ParityOp, { label: string; description: string }>;

export class IsEvenOddNode extends ClassicPreset.Node {
  label: string;
  op: ParityOp;
  cachedResult: Tri | Tri[] = null;
  literals: Record<string, number> = { in: 0 };
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: ParityOp }) {
    super("IsEvenOdd");
    const op = init?.op ?? "iseven";
    this.op = op;
    this.label = init?.label ?? "";
    this.addInput("in", numListIn("In"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: Tri | Tri[] };
  }
}
