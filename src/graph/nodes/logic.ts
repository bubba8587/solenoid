import { ClassicPreset } from "rete";
import { numListIn, logicalComboOut, logicalComboIn, logicalIn, numIn, anyIn, trueAnyIn, trueAnyOut, staticTrueAnyOut, readInput } from "./shared";
import type { PassthroughSpec } from "./passthrough";
import { isSolError, isNaError, solError, type SolError } from "../errorValue";
import { kleeneAnd, kleeneOr, kleeneNot, isMissing, cellError, type Tri } from "../valueKinds";
import { compareUnits } from "../unitValue";
import { isFrameValue, frameRowCount, type FrameValue } from "../frame";

/** A Frame's cells in row-major order, raw (null preserved) — lets the IS-check
 *  family test a frame per cell, the same way it tests a matrix. */
function frameCells(f: FrameValue): unknown[][] {
  const rows = frameRowCount(f);
  return Array.from({ length: rows }, (_, i) => f.columns.map((c) => c.values[i] ?? null));
}

// Element-wise over up to N args (each a number, a `null`, or a list of those),
// broadcasting scalars against any list arg; the per-element fn returns T. This
// is the logic family's null-aware broadcaster — a `null` operand flows through
// to the fn (Kleene / comparison / IF-propagation) rather than being coerced to 0
// (which would silently turn `null > 2` into FALSE). Unlike `broadcast`, it never
// NaN-collapses a null the fn returns. Ragged lists zip to the LONGEST length,
// the shorter padded with `null` INTO the fn — the fn's own null semantics
// decide the cell (Kleene: null AND FALSE is FALSE, not null), unlike the
// numeric broadcasters where a padded position is null outright.
// A per-cell SolError short-circuits UNMORPHED (first in arg order), matching the
// numeric broadcasters and applyOp — an error operand in a comparison / boolean /
// IF-branch propagates as that error rather than being coerced. `null` is NOT
// short-circuited here: it flows into `fn`, whose own Kleene rule decides the cell
// (null AND FALSE is FALSE, not null). See valueKinds `cellError`.
function broadcastEl<A, T>(
  fn: (...xs: A[]) => T,
  ...args: Array<A | A[]>
): T | T[] {
  const lists = args.filter((a): a is A[] => Array.isArray(a));
  if (lists.length === 0) {
    const err = cellError(args);
    return (err !== undefined ? err : fn(...(args as A[]))) as T;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: T[] = [];
  for (let i = 0; i < len; i++) {
    const ops = args.map((a) => (Array.isArray(a) ? (i < a.length ? a[i] : null) : a));
    const err = cellError(ops);
    out.push((err !== undefined ? err : fn(...(ops as A[]))) as T);
  }
  return out;
}
// After coerceInputs a WIRED logical operand is a real boolean (`numsToBools`),
// while a typed literal stays a raw 0/1 number — so a bare `x !== 0` reads a wired
// FALSE as true (`false !== 0`). Same trap `truthy` documents below; accept both
// encodings here too.
const triBool = (x: number | boolean | null): Tri =>
  isMissing(x) ? null : x === true || (typeof x === "number" && x !== 0);

// Truthiness of a CONDITION for the value-selectors (IF / IFS). After coerceInputs,
// a logical socket delivers a real boolean — so a bare `x !== 0` is wrong
// (`false !== 0` is true). Accept the coerced boolean AND a raw 0/1 literal.
const truthy = (x: unknown): boolean => x === true || (typeof x === "number" && x !== 0);

/** A fallback/branch slot is SET when a cable feeds it OR the user typed a literal.
 *  UNSET (no cable AND no literal) is distinct from a slot deliberately set to a
 *  value (incl. null/0). An unmatched IFS/SWITCH with an UNSET fallback is a logic
 *  hole → a loud #N/A, not a silent null. */
function isSet(inputs: Record<string, unknown[] | undefined>, literals: Record<string, number>, key: string): boolean {
  return inputs[key] !== undefined || literals[key] !== undefined;
}

// Pair-key helpers for the variadic paired nodes (IFS / SWITCH). A pair `i` owns
// the two input keys `${prefixA}${i}` / `${prefixB}${i}`. On load/paste the node
// rebuilds the exact pair ids present in the captured input keys (so literals +
// cables line up); `default`/`expr` and the like are ignored by the prefix match.
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

// Single source of truth for the six comparisons. Shared by Comparison
// (→ 0/1, broadcast element-wise) and Filter (→ keep/drop predicate) so
// the operator set and semantics can never drift between them.
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

// The six comparisons, named once. `symbol` is the operator glyph — the dropdown
// prefixes it to the name, because on the card the glyph is the faster read; `label`
// is the name alone, which is what an Add-menu search row needs ("Comparison: Greater
// or equal", where a bare "≥" would carry nothing).
export const COMPARISON_OP_META = {
  gt:  { symbol: ">", label: "Greater than",     description: "TRUE when A is greater than B. Excel: A>B." },
  gte: { symbol: "≥", label: "Greater or equal", description: "TRUE when A is greater than or equal to B. Excel: A>=B." },
  lt:  { symbol: "<", label: "Less than",        description: "TRUE when A is less than B. Excel: A<B." },
  lte: { symbol: "≤", label: "Less or equal",    description: "TRUE when A is less than or equal to B. Excel: A<=B." },
  eq:  { symbol: "=", label: "Equal",            description: "TRUE when A equals B. Excel: A=B." },
  neq: { symbol: "≠", label: "Not equal",        description: "TRUE when A differs from B. Excel: A<>B." },
} satisfies Record<ComparisonOp, { symbol: string; label: string; description: string }>;

export class ComparisonNode extends ClassicPreset.Node {
  /** Keeps `UnitCell` tags on its inputs so the comparison runs on BASE-SI
   *  magnitudes (5 km = 5000 m reads TRUE) and enforces commensurability — two
   *  different dimensions (or two currencies with no FX) never compare equal. */
  unitAware = true;
  label: string;
  op: ComparisonOp;
  cachedResult: Tri | Tri[] | SolError = null; // a real logical (renders TRUE/FALSE); null when missing
  literals: Record<string, number> = { a: 0, b: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string; op?: ComparisonOp }) {
    super("Comparison");
    this.label = init?.label ?? "Compare";
    this.op = init?.op ?? "gt";
    this.addInput("a", numListIn("A"));
    this.addInput("b", numListIn("B"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: { a?: unknown[]; b?: unknown[] }) {
    const a = (inputs.a?.length ? inputs.a[0] : this.literals.a) ?? null;
    const b = (inputs.b?.length ? inputs.b[0] : this.literals.b) ?? null;
    // A null (missing) operand → null per element (Kleene: a comparison with an
    // unknown is unknown). Both unwired/blank → null result.
    const result: Tri | Tri[] | SolError =
      a === null && b === null ? null
        : broadcastEl<unknown, Tri | SolError>(
            (x, y) => compareCell(this.op, x, y),
            a, b,
          ) as Tri | Tri[] | SolError;
    this.cachedResult = result;
    return { result };
  }
}

/** One element-wise comparison cell, unit-aware. A missing operand → null (Kleene:
 *  comparing with an unknown is unknown). Otherwise route through `compareUnits`,
 *  which yields the base-SI magnitude pair when the operands are commensurable, or a
 *  `#UNIT!` when they aren't (different dimensions, or two currencies). For an
 *  INCOMMENSURABLE pair, equality is still answerable — different things simply
 *  aren't equal (`=` → FALSE, `≠` → TRUE) — but ORDERING is meaningless, so `<`/`>`
 *  propagate the `#UNIT!`. */
function compareCell(op: ComparisonOp, x: unknown, y: unknown): Tri | SolError {
  if (isMissing(x) || isMissing(y)) return null;
  const cmp = compareUnits(x as number, y as number);
  if (isSolError(cmp)) {
    if (op === "eq") return false;
    if (op === "neq") return true;
    return cmp; // ordering incommensurable values → #UNIT!
  }
  return compareOp(op, cmp.l, cmp.r);
}

// ─── IF (value passthrough) ──────────────────────────────────────────────────
// A standalone IF: the condition picks one of two values. This is a VALUE
// passthrough (it returns whichever branch — NOT a logical). Boolean COMBINING
// (AND/OR/…) lives in BooleanOpNode; comparisons/parity emit the logical type.

export class IfNode extends ClassicPreset.Node {
  label: string;
  cachedResult: unknown = null;
  literals: Record<string, number> = { cond: 0, then: 0, else: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("If");
    this.label = init?.label ?? "IF";
    // Condition is a LOGICAL (purple). The logical↔number bridge still lets a 0/1
    // number (or a comparison) drive it — coerceInputs turns it into a real boolean.
    this.addInput("cond", logicalComboIn("Condition"));
    // then/else just PASS A VALUE THROUGH — IF selects, it doesn't transform — so
    // they're `trueany` (a number, list, frame, … flows unchanged to the output).
    this.addInput("then", trueAnyIn("Value if true"));
    this.addInput("else", trueAnyIn("Value if false"));
    this.addOutput("result", trueAnyOut("Result"));
  }

  /** IF SELECTS a value branch (the condition is not a value branch), following its
   *  actually-chosen branch for units — IF(true, km, mi) is km; a LIST condition picks
   *  per-element → null (indeterminate → the branches must agree). ONE declaration for
   *  type adoption + unit flow (passthrough.ts). */
  _selectedUnitKey: string | null = null;
  passthrough(): PassthroughSpec[] {
    return [{ output: "result", inputs: ["then", "else"], combine: "agree", selected: () => this._selectedUnitKey }];
  }

  data(inputs: { cond?: unknown[]; then?: unknown[]; else?: unknown[] }) {
    // Connection-presence (not `??`) so a WIRED null/false survives: an unwired input
    // falls back to its literal, a wired one keeps its actual value.
    const cond = inputs.cond?.length ? inputs.cond[0] : this.literals.cond;
    const then = inputs.then?.length ? inputs.then[0] : this.literals.then;
    const els  = inputs.else?.length ? inputs.else[0] : this.literals.else;
    this._selectedUnitKey = Array.isArray(cond) || isMissing(cond) ? null : truthy(cond) ? "then" : "else";
    // A missing condition → null (can't pick a branch); otherwise pass the chosen
    // value through (element-wise when any operand is a list).
    const result = broadcastEl<unknown, unknown>(
      (x, y, z) => (isMissing(x) ? null : truthy(x) ? y : z),
      cond, then, els,
    );
    this.cachedResult = result;
    return { result };
  }
}

// ─── Boolean ops (variadic reducers) ─────────────────────────────────────────
// AND/OR/XOR/NAND/NOR/XNOR fold N truth inputs to one truth; NOT flips a single
// input per element. All emit the first-class logical type (purple, TRUE/FALSE).

export type BooleanOp = "and" | "or" | "xor" | "nand" | "nor" | "xnor";

export const BOOLEAN_OP_META = {
  and:  { label: "AND",  description: "TRUE if ALL inputs are true. Excel: AND(…)." },
  or:   { label: "OR",   description: "TRUE if ANY input is true. Excel: OR(…)." },
  xor:  { label: "XOR",  description: "TRUE if an ODD number of inputs are true. Excel: XOR(…)." },
  nand: { label: "NAND", description: "Negated AND: FALSE only when every input is true. Excel: NOT(AND(…))." },
  nor:  { label: "NOR",  description: "Negated OR: TRUE only when every input is false. Excel: NOT(OR(…))." },
  xnor: { label: "XNOR", description: "TRUE if an EVEN number of inputs are true; the negation of XOR" },
} satisfies Record<BooleanOp, { label: string; description: string }>;

/** Fold N tri-valued operands per the op (Kleene three-valued logic). NOT is a
 *  separate unary node (NotNode) — every op here is a true N-ary reducer. */
function foldBoolean(op: BooleanOp, xs: (number | boolean | null)[]): Tri {
  const tris = xs.map(triBool);
  switch (op) {
    case "and":  return tris.reduce<Tri>((a, t) => kleeneAnd(a, t), true);
    case "or":   return tris.reduce<Tri>((a, t) => kleeneOr(a, t), false);
    case "nand": return kleeneNot(tris.reduce<Tri>((a, t) => kleeneAnd(a, t), true));
    case "nor":  return kleeneNot(tris.reduce<Tri>((a, t) => kleeneOr(a, t), false));
    case "xor":
    case "xnor": {
      // Parity is undefined if any operand is missing (it could flip either way).
      if (tris.some(isMissing)) return null;
      const odd = tris.filter((t) => t === true).length % 2 === 1;
      return op === "xor" ? odd : !odd;
    }
  }
}

export class BooleanOpNode extends ClassicPreset.Node {
  label: string;
  op: BooleanOp;
  cachedResult: Tri | Tri[] = null;
  // Extensible operand rows `a*` (sparse literals).
  literals: Record<string, number> = {};
  nextInputId = 0;
  width = 180;
  height = 210;

  constructor(init?: { label?: string; op?: BooleanOp; valueKeys?: string[] }) {
    super("BooleanOp");
    this.op = init?.op ?? "and";
    this.label = init?.label ?? BOOLEAN_OP_META[this.op].label;
    const vKeys = (init?.valueKeys ?? []).filter((k) => k.startsWith("a"));
    if (vKeys.length) for (const k of vKeys) this.addInputWithKey(k);
    else for (let i = 0; i < 2; i++) this.addValueInput();
    this.addOutput("result", logicalComboOut("Result"));
  }

  private addInputWithKey(key: string): void {
    // Logical operands (purple). A number still connects via the logical↔number
    // bridge (0/1 ⟷ FALSE/TRUE), so an unwired numeric literal is honored too.
    this.addInput(key, logicalComboIn(key));
    const n = parseInt(key.replace(/^a/, ""), 10);
    if (Number.isFinite(n)) this.nextInputId = Math.max(this.nextInputId, n + 1);
  }

  /** Ordered operand-input keys (the `a*` inputs, in insertion order). */
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

  data(inputs: Record<string, (number | null | (number | null)[])[] | undefined>) {
    // `readInput`, not `?? 0`: a WIRED blank is UNKNOWN, and `?? 0` collapsed it to
    // FALSE — a wrong answer under Kleene, where AND(unknown, TRUE) is unknown but
    // AND(false, TRUE) is FALSE. `foldBoolean` already reasons about null.
    const operands = this.valueInputKeys().map((k) => readInput(inputs[k], this.literals[k] ?? 0));
    const result = broadcastEl((...xs) => foldBoolean(this.op, xs), ...operands);
    this.cachedResult = result;
    return { result };
  }
}

// ─── NOT (unary logical flip) ────────────────────────────────────────────────
// Its own node — NOT is a per-element flip (a map), not an N-ary reducer like the
// BooleanOpNode family, so it doesn't share their extensible operand layout.

export class NotNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Tri | Tri[] = null;
  literals: Record<string, number> = { in: 0 };
  width = 180;
  height = 200;

  constructor(init?: { label?: string }) {
    super("Not");
    this.label = init?.label ?? "NOT";
    this.addInput("in", logicalComboIn("In")); // logical (a number bridges 0/1 ⟷ FALSE/TRUE)
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: { in?: (number | null | (number | null)[])[] }) {
    // A wired blank is unknown; `?? 0` made it FALSE, so NOT(blank) answered TRUE.
    const v = readInput(inputs.in, this.literals.in ?? 0);
    const result = broadcastEl((x) => kleeneNot(triBool(x)), v);
    this.cachedResult = result;
    return { result };
  }
}

// ─── IFERROR ──────────────────────────────────────────────────────────────────

export type IFErrorMode = "iferror" | "ifna";

export class IFErrorNode extends ClassicPreset.Node {
  label: string;
  op: IFErrorMode;
  // A list now carries per-cell errors + null, so the result can too (caught
  // cells → fallback; uncaught errors/nulls pass through).
  // IFERROR/IFNA pass a value THROUGH, swapping only caught error cells for the
  // fallback — a selector, not a transform — so value / fallback / result are `any`.
  cachedResult: unknown = null;
  literals: Record<string, number> = { value: 0, fallback: 0 };
  width = 180;
  height = 200;
  // IFERROR/IFNA SELECT value-or-fallback unchanged → both branches' type + unit ride
  // through when they agree (passthrough.ts). Now carries units (it didn't before —
  // the same drift Expect / Cable Switch had: in the type set, missing from units).
  passthrough(): PassthroughSpec[] { return [{ output: "result", inputs: ["value", "fallback"], combine: "agree" }]; }

  constructor(init?: { label?: string; op?: IFErrorMode }) {
    super("IFError");
    this.label = init?.label ?? "IFERROR";
    this.op = init?.op ?? "iferror";
    this.addInput("value",    trueAnyIn("Value"));
    this.addInput("fallback", trueAnyIn("Fallback"));
    this.addOutput("result",  trueAnyOut("Result"));
  }

  data(inputs: { value?: unknown[]; fallback?: unknown[] }) {
    // A WIRED input delivers its value even when that value is `null` (missing) —
    // so test for the connection's presence, NOT `?? literal` (which would treat a
    // real null as absent and substitute the literal, hiding the missing cell).
    const rawValue = inputs.value && inputs.value.length ? inputs.value[0] : (this.literals.value ?? null);
    const fallback = inputs.fallback && inputs.fallback.length ? inputs.fallback[0] : (this.literals.fallback ?? 0);
    // Tagged error values (errorValue.ts) reach this node raw — it's an error
    // consumer — both as a whole-value error AND per cell inside a list. A `null`
    // (missing) is NOT an error (null is a first-class value), so it ALWAYS
    // passes through — a real not-found is a tagged #N/A, e.g. XLOOKUP.
    //  IFERROR catches any tagged error; IFNA only a #N/A error. Mirrors Test's
    //  ISERROR / ISNA exactly (shared via isNaError) — a tagged failure is the ONE
    //  notion of "error" across this family. Producers tag domain failures or
    //  collapse non-finite to null, so a bare NaN never reaches here untagged.
    const caught = (v: unknown): boolean =>
      this.op === "iferror" ? isSolError(v) : isNaError(v);
    const result = replaceCaught(rawValue, fallback, caught);
    this.cachedResult = result as IFErrorNode["cachedResult"];
    return { result };
  }
}

/** Element-wise (recursing into lists/matrices): replace each cell the predicate
 *  catches with the fallback (broadcast — a scalar fallback fills every caught
 *  cell; a list fallback pairs by index), leaving every other cell untouched. */
function replaceCaught(value: unknown, fallback: unknown, caught: (v: unknown) => boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => replaceCaught(v, Array.isArray(fallback) ? fallback[i] : fallback, caught));
  }
  return caught(value) ? fallback : value;
}

// ─── IS.TEST (type / blank / error predicates) ───────────────────────────────

export type IsTestOp = "isnumber" | "isblank" | "isnull" | "iserror" | "isna" | "islogical" | "istext" | "isnontext";

// Short Excel-style names, not the full explanation — the value box and the wired-error
// panel carry the meaning. ISBOOLEAN is our name for Excel's ISLOGICAL (Solenoid calls
// the type logical, but the card says what the user is testing FOR); the `islogical` op
// value stays because saves are keyed on it.
export const IS_TEST_OP_META = {
  isnumber:  { label: "ISNUMBER",  description: "TRUE when the value is a number. Excel: ISNUMBER." },
  isblank:   { label: "ISBLANK",   description: "TRUE when the cell is empty. Excel: ISBLANK." },
  isnull:    { label: "ISNULL",    description: "TRUE when the value is missing (null)." },
  iserror:   { label: "ISERROR",   description: "TRUE when the value is any error. Excel: ISERROR." },
  isna:      { label: "ISNA",      description: "TRUE when the value is #N/A. Excel: ISNA." },
  islogical: { label: "ISBOOLEAN", description: "TRUE when the value is a logical. Excel: ISLOGICAL." },
  istext:    { label: "ISTEXT",    description: "TRUE when the value is text. Excel: ISTEXT." },
  isnontext: { label: "ISNONTEXT", description: "TRUE when the value is anything but text. Excel: ISNONTEXT." },
} satisfies Record<IsTestOp, { label: string; description: string }>;

// 0/1 (or per-element) → a real logical that renders TRUE/FALSE.
function toLogical(r: number | number[] | null): boolean | boolean[] | null {
  return r === null ? null : Array.isArray(r) ? r.map((n) => n === 1) : r === 1;
}

export class IsTestNode extends ClassicPreset.Node {
  label: string;
  op: IsTestOp;
  cachedResult: boolean | boolean[] | boolean[][] | null = null;
  // The error value observed on the last recompute, if any — the component
  // renders its code + the long ERROR_EXPLANATIONS text under the result, so
  // this node doubles as the place to READ an error, not just test for one.
  seenError: SolError | null = null;
  literals: Record<string, number> = { value: 0 };
  width = 180;
  height = 180;

  constructor(init?: { label?: string; op?: IsTestOp }) {
    super("IsTest");
    this.label = init?.label ?? "IS.TEST";
    this.op = init?.op ?? "isnumber";
    this.addInput("value", trueAnyIn("Value"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: { value?: unknown[] }) {
    const raw = inputs.value?.[0];
    // Unwired ≠ a wired null. With no operand the node has nothing to test, so it
    // outputs a blank (null) — NOT `true`. A wired `null` VALUE is `[null]` here
    // (raw === null), distinct from unwired (raw === undefined), and still reads
    // as null by ISNULL below.
    if (raw === undefined) { this.seenError = null; this.cachedResult = null; return { result: null }; }
    const input = raw;
    let result: number | number[] | null = null;
    this.seenError = isSolError(input) ? input : null;
    // Tagged error values reach this node raw (error consumer): ISERROR is 1
    // for any code, ISNA only for #N/A; every other check is 0 — an error is
    // not a number, not blank, not text. Excel semantics.
    if (isSolError(input)) {
      result =
        this.op === "iserror" ? 1 :
        this.op === "isna"    ? (isNaError(input) ? 1 : 0) :
        0;
      this.cachedResult = toLogical(result);
      return { result: this.cachedResult };
    }
    // A Frame (named columns) isn't an array, so the per-cell maps below would test
    // the WHOLE frame as one cell (→ a single bool). Flatten it to its row-major raw
    // cells first, so a frame tests per cell like a matrix — ISNULL flags each gap in
    // the table, ISNUMBER each numeric cell, etc.
    const value = isFrameValue(input) ? frameCells(input) : input;
    if (this.op === "isnull") {
      // Per-CELL missing test for the first-class `null`, to any depth: over a list
      // it flags each gap, over a matrix/frame each cell (pairs with the Coalesce/Fill
      // workflow). A whole blank scalar → TRUE. Distinct from ISBLANK (whole input).
      const deepNull = (v: unknown): unknown => (Array.isArray(v) ? v.map(deepNull) : isMissing(v));
      this.cachedResult = deepNull(value) as boolean | boolean[] | boolean[][] | null;
      return { result: this.cachedResult };
    }
    if (this.op === "isblank") {
      // ISBLANK tests the WHOLE input as one cell (a populated list/frame is not
      // blank); per-cell missing is ISNULL's job (deep map above).
      this.cachedResult = input === null;
      return { result: this.cachedResult };
    }
    // Every remaining check is per-CELL to any depth (scalar / list / matrix / frame),
    // so a 2-D table tests each cell instead of mis-mapping over its rows (the bug
    // ISNULL already fixed). Each cell's own type answers — a mixed list resolves per
    // element, a per-cell `null` is not a number/error, a per-cell SolError flags ISERROR.
    const test = (x: unknown): boolean => {
      switch (this.op) {
        case "istext":    return typeof x === "string";
        case "isnontext": return typeof x !== "string";
        case "isnumber":  return typeof x === "number" && Number.isFinite(x);
        // Pure TYPE test (Excel ISLOGICAL): only a real boolean passes. NOT 0/1 (those
        // are numbers — ISNUMBER's) and NOT "TRUE"/"FALSE" (text — ISTEXT's). The IS-
        // checks partition by actual runtime type with no overlap; bool↔number coercion
        // is a separate, socket-boundary concern.
        case "islogical": return typeof x === "boolean";
        case "iserror":   return isSolError(x);
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
  /** This output only ever carries a tagged error, which formats as an error under
   *  ANY branch type — so it deliberately ABSTAINS in a selector's `agree` vote
   *  (trueAnyAdopt), unlike XLOOKUP/Get Cell whose trueany is a real unknown and
   *  vetoes. `IFERROR(aDate, NA())` keeps the date's type because of this flag. */
  errorOnlyOutput = true;
  width = 140;
  height = 80;

  constructor(init?: { label?: string }) {
    super("Na");
    this.label = init?.label ?? "NA";
    this.cachedResult = solError("#N/A", "Not available");
    // TYPE-NEUTRAL (2026-07-25), not `number`. NA emits a tagged #N/A SolError, which
    // is not a number — an error rides through every socket regardless of type
    // (coerceValue passes it untouched, installErrorGuards propagates it). Declaring
    // `number` made it VOTE in a selector's `agree`: `IFERROR(aDate, NA())` had
    // branches date + number, which disagree, so the result resolved to "unknown" and
    // the date lost its formatting downstream. The abstention now rides on
    // `errorOnlyOutput` above (a wired trueany otherwise VETOES the agreement);
    // `trueany` also connects everywhere #N/A is legal, which is anywhere.
    this.addOutput("result", staticTrueAnyOut("N/A"));
  }

  data() {
    // The TAGGED #N/A (Excel =NA()): the catalog promises "catch it with
    // IFERROR / IFNA", which only works for a SolError — a bare null/NaN reads
    // FALSE to ISNA and passes through IFNA untouched (audit finding 13).
    return { result: this.cachedResult };
  }
}

// ─── Choose ───────────────────────────────────────────────────────────────────

export class ChooseNode extends ClassicPreset.Node {
  label: string;
  // CHOOSE returns one of its value rows unchanged (a selector) — so the values and
  // the result are `any`; only `index` stays a number.
  cachedResult: unknown = null;
  // `index` is the fixed selector; the `v*` value rows are extensible (added /
  // removed by the user — Excel CHOOSE takes up to 254 values). Sparse literals:
  // only typed/wired slots contribute.
  literals: Record<string, number> = { index: 1 };
  nextInputId = 0;
  width = 180;
  height = 250;

  constructor(init?: { label?: string; valueKeys?: string[] }) {
    super("Choose");
    this.label = init?.label ?? "CHOOSE";
    this.addInput("index", numIn("Index"));
    // Rebuild the exact `v*` keys on load/paste (so literals + cables line up);
    // ignore any non-value key extractInit captured (e.g. `index`). Fresh node
    // starts with four blank value rows.
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

  /** Ordered value-input keys (the `v*` inputs, in insertion order). */
  valueInputKeys(): string[] {
    return Object.keys(this.inputs).filter((k) => k.startsWith("v"));
  }

  /** CHOOSE selects a value row unchanged (the `index` is not a value branch),
   *  following the chosen row for units (passthrough.ts). */
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
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const idxRaw = readInput(inputs.index as (number | null)[] | undefined, this.literals.index ?? 1);
    // A blank index selects nothing — unknown, not an ERROR. #VALUE! below is for an
    // index that is known and out of range, which is a different thing.
    if (idxRaw === null) { this.cachedResult = null; return { result: null }; }
    const idx = Math.round(idxRaw);
    const keys = this.valueInputKeys();
    const key = idx >= 1 && idx <= keys.length ? keys[idx - 1] : undefined;
    this._selectedUnitKey = key ?? null; // the unit follows the chosen row
    // An index outside 1..N is a real error, not a blank → #VALUE! (Excel's code for
    // an out-of-range CHOOSE index), aligned with the tagged-error model.
    if (!key) {
      const err = solError("#VALUE!", `CHOOSE index ${idx} is outside the range 1–${keys.length}`);
      this.cachedResult = err;
      return { result: err };
    }
    // Pass the selected value through unchanged (wired wins; else its literal).
    const result = inputs[key]?.length ? inputs[key]![0] : (this.literals[key] ?? null);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Switch ───────────────────────────────────────────────────────────────────

export class SwitchNode extends ClassicPreset.Node {
  label: string;
  // SWITCH matches `expr` against each `when` and returns the paired `then` (or the
  // default) unchanged — a selector — so expr / when / then / default / result are
  // `any` (match text, dates, numbers; return any value type).
  cachedResult: unknown = null;
  // Fixed `expr` + `default`; extensible when/then PAIRS between (Excel SWITCH
  // takes up to 126). Pair `i` owns `when${i}` / `then${i}`.
  literals: Record<string, number> = { expr: 0, default: 0 };
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
      // Fresh node matches when0 (expr = 1 → then0 = 10) so it shows a real result;
      // the Default ships EMPTY (a muted N/A placeholder cues it) — no match with an
      // unset Default → #N/A.
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

  /** Ordered (whenKey, thenKey) pairs currently present, in insertion order. */
  valuePairKeys(): Array<[string, string]> {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("when"))
      .map((k) => { const id = k.slice(4); return [`when${id}`, `then${id}`] as [string, string]; });
  }

  /** SWITCH returns a `then` value (or the default) unchanged — a unit/format on the
   *  returned branch rides through (see unitFlow/passthrough.ts). `expr` / the `when`
   *  keys match, they aren't value branches. */
  _selectedUnitKey: string | null = null;
  passthrough(): PassthroughSpec[] {
    return [{ output: "result", inputs: [...this.valuePairKeys().map(([, then]) => then), "default"], combine: "agree", selected: () => this._selectedUnitKey }];
  }

  addValuePair(): void {
    this.addPairWithId(this.nextPairId);
  }

  removeValuePair(aKey: string): void {
    const id = aKey.slice(4);
    this.removeInput(`when${id}`);
    this.removeInput(`then${id}`);
    delete this.literals[`when${id}`];
    delete this.literals[`then${id}`];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const pick = (key: string): unknown =>
      inputs[key]?.length ? inputs[key]![0] : (this.literals[key] ?? null);
    // Exact equality across every type (Excel SWITCH is an exact match) — numbers,
    // text, dates, booleans all compare the same way. No number tolerance: dates are
    // a distinct type from numbers in this app, so there's no "serials are numbers"
    // special case here either.
    const expr = pick("expr");
    // An UNKNOWN expression can't be known equal to anything (Kleene): propagate,
    // instead of letting null === null "match" an unset When row's literal.
    if (isMissing(expr)) {
      this._selectedUnitKey = null;
      this.cachedResult = null;
      return { result: null };
    }
    for (const [whenKey, thenKey] of this.valuePairKeys()) {
      if (expr === pick(whenKey)) {
        const then = pick(thenKey);
        this._selectedUnitKey = thenKey; // the unit follows the matched branch
        this.cachedResult = then;
        return { result: then };
      }
    }
    // No case matched. An UNSET Default (no cable AND no literal) is a logic hole →
    // #N/A (catchable via IFNA); a SET default — even null/0 — is returned as-is.
    this._selectedUnitKey = "default";
    if (!isSet(inputs, this.literals, "default")) {
      const err = solError("#N/A", "No SWITCH case matched and no Default was set");
      this.cachedResult = err;
      return { result: err };
    }
    const def = pick("default");
    this.cachedResult = def;
    return { result: def };
  }
}

// ─── IFS ──────────────────────────────────────────────────────────────────────

export class IfsNode extends ClassicPreset.Node {
  label: string;
  // Each `cond` is a LOGICAL (purple); the paired `val` it returns — and the
  // Otherwise fallback + result — pass a value THROUGH unchanged, so they're `any`.
  cachedResult: unknown = null;
  // Extensible condition/value PAIRS (Excel IFS takes up to 127). Pair `i` owns
  // `cond${i}` / `val${i}`. Sparse literals: only typed/wired slots contribute.
  literals: Record<string, number> = {};
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
    // A differently-labeled fallback appended AFTER the pairs — returned when no
    // condition matched. Resolves the "fake a `TRUE, fallback` last pair" pattern
    // Excel forces; unset → null.
    this.addInput("otherwise", trueAnyIn("Otherwise"));
    this.addOutput("result", trueAnyOut("Result"));
  }

  private addPairWithId(id: number): void {
    this.addInput(`cond${id}`, logicalIn(`Condition ${id + 1}`));
    this.addInput(`val${id}`,  trueAnyIn(`Value ${id + 1}`));
    this.nextPairId = Math.max(this.nextPairId, id + 1);
  }

  /** Ordered (condKey, valKey) pairs currently present, in insertion order. */
  valuePairKeys(): Array<[string, string]> {
    return Object.keys(this.inputs)
      .filter((k) => k.startsWith("cond"))
      .map((k) => { const id = k.slice(4); return [`cond${id}`, `val${id}`] as [string, string]; });
  }

  /** IFS returns a matched `val` (or Otherwise) unchanged — a unit/format on the
   *  returned branch rides through (see unitFlow/passthrough.ts). The `cond` keys are
   *  tests, not value branches. */
  _selectedUnitKey: string | null = null;
  passthrough(): PassthroughSpec[] {
    return [{ output: "result", inputs: [...this.valuePairKeys().map(([, val]) => val), "otherwise"], combine: "agree", selected: () => this._selectedUnitKey }];
  }

  addValuePair(): void {
    this.addPairWithId(this.nextPairId);
  }

  removeValuePair(aKey: string): void {
    const id = aKey.slice(4);
    this.removeInput(`cond${id}`);
    this.removeInput(`val${id}`);
    delete this.literals[`cond${id}`];
    delete this.literals[`val${id}`];
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    const pick = (key: string): unknown =>
      inputs[key]?.length ? inputs[key]![0] : (this.literals[key] ?? null);
    for (const [condKey, valKey] of this.valuePairKeys()) {
      const cond = pick(condKey);
      // A WIRED blank condition is UNKNOWN, and an unknown at this row makes the
      // whole answer unknown (Kleene — the row might have matched): propagate.
      // An UNSET row (no cable, no literal) just falls through like FALSE.
      if (isMissing(cond) && (inputs[condKey]?.length ?? 0) > 0) {
        this._selectedUnitKey = null;
        this.cachedResult = null;
        return { result: null };
      }
      // First condition that's truthy (a real boolean after coercion, or a raw 1)
      // returns its paired value. A missing/false condition falls through.
      if (!isMissing(cond) && truthy(cond)) {
        const val = pick(valKey);
        this._selectedUnitKey = valKey; // the unit follows the matched branch
        this.cachedResult = val;
        return { result: val };
      }
    }
    // No condition matched. An UNSET Otherwise (no cable AND no literal) is a logic
    // hole → a loud, catchable #N/A (matches XLOOKUP's not-found), NOT a silent null
    // that aggregators skip. A SET fallback — even a deliberate null/0 — is returned.
    this._selectedUnitKey = "otherwise";
    if (!isSet(inputs, this.literals, "otherwise")) {
      const err = solError("#N/A", "No IFS condition matched and no Otherwise was set");
      this.cachedResult = err;
      return { result: err };
    }
    const els = pick("otherwise");
    this.cachedResult = els;
    return { result: els };
  }
}

// ─── ISEVEN / ISODD (parity test → logical) ──────────────────────────────────
// Extracted from the Math op-dropdown (which has one shared NUMBER output) so it
// can emit a real logical (TRUE/FALSE, purple socket) like its sibling predicates
// instead of 1/0. One node, even/odd toggle.

export type ParityOp = "iseven" | "isodd";

export const PARITY_OP_META = {
  iseven: { label: "ISEVEN", description: "TRUE if the integer part is even. Excel: ISEVEN(x)." },
  isodd:  { label: "ISODD",  description: "TRUE if the integer part is odd. Excel: ISODD(x)." },
} satisfies Record<ParityOp, { label: string; description: string }>;

export class IsEvenOddNode extends ClassicPreset.Node {
  label: string;
  op: ParityOp;
  cachedResult: Tri | Tri[] = null; // a real logical (renders TRUE/FALSE); null when missing
  literals: Record<string, number> = { in: 0 };
  width = 180;
  height = 160;

  constructor(init?: { label?: string; op?: ParityOp }) {
    super("IsEvenOdd");
    const op = init?.op ?? "iseven";
    this.op = op;
    this.label = init?.label ?? PARITY_OP_META[op].label;
    this.addInput("in", numListIn("In"));
    this.addOutput("result", logicalComboOut("Result"));
  }

  data(inputs: { in?: (number | null | (number | null)[])[] }) {
    const input = readInput(inputs.in, this.literals.in ?? null);
    // A null (missing) element stays unknown; a present value is even XOR odd by
    // its integer part. Broadcasts element-wise over a wired list.
    const result: Tri | Tri[] = input === null ? null
      : broadcastEl((x) => {
          if (isMissing(x)) return null;
          const even = Math.trunc(x as number) % 2 === 0;
          return this.op === "iseven" ? even : !even;
        }, input);
    this.cachedResult = result;
    return { result };
  }
}
