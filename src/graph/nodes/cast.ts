import { ClassicPreset } from "rete";
import { isDateType, type SocketDataType } from "../sockets";
import { trueAnyIn, numListOut, strComboOut, dateComboOut, complexOut, logicalComboOut } from "./shared";
import { coerceLogical } from "../valueKinds";
import { formatDateSerial, parseDateToSerial, DEFAULT_DATE_FORMAT } from "./date";
import { formatCx, type Cx } from "./complex";
import { formatNumberPattern } from "./text";
import { getEditor } from "../process";
import { solError, isSolError, type SolError } from "../errorValue";

// ─── Cast — universal data-type conversion ────────────────────────────────────
// One node that coerces any scalar or list value to a chosen target type:
// number, text, date (Excel serial), or complex. Element-wise over lists.
// Supersedes the deprecated single-purpose coercers (TEXT, VALUE, Format Date —
// hidden in the catalog but still loadable).
//
// The optional `format` applies when casting TO text: a number pattern
// ("0.00", "0.00%") for numeric sources, a date pattern (YYYY-MM-DD …) for
// date sources.
//
// The output socket follows the selected target (numlist / strcombo /
// datecombo / complex) — swapped in place by applyCastTarget like the frame
// nodes' read-as toggle, so downstream type checking stays honest.

export type CastTarget = "number" | "text" | "date" | "complex" | "logical";

export const CAST_TARGET_META: Record<CastTarget, { label: string; title: string }> = {
  number:  { label: "Number",  title: "Parse text, a logical's 1/0, or a complex value's real part; pass numbers through" },
  text:    { label: "Text",    title: "Format numbers and dates (with the format pattern) or complex values as text" },
  date:    { label: "Date",    title: "Parse date text to an Excel serial; numbers pass through as serials" },
  complex: { label: "Complex", title: "Parse \"a+bi\" text; numbers become re+0i" },
  logical: { label: "Boolean", title: "Parse TRUE/FALSE text (or a nonzero number) to a logical TRUE/FALSE" },
};

/** Output port for a cast target — combo sockets so scalar and list both fit. */
export function castOutput(target: CastTarget) {
  switch (target) {
    case "number":  return numListOut("Number");
    case "text":    return strComboOut("Text");
    case "date":    return dateComboOut("Date");
    case "complex": return complexOut("Complex");
    case "logical": return logicalComboOut("Boolean");
  }
}

// Parse "a", "bi", "a+bi", "a-bi", "i", "-i" (also j) → [re, im].
export function parseCx(s: string): Cx {
  const t = s.trim().replace(/\s+/g, "");
  if (t === "") return [NaN, NaN];
  const NUM = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  let m = new RegExp(`^(${NUM})$`).exec(t);
  if (m) return [Number(m[1]), 0];
  m = new RegExp(`^([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)?)[ij]$`).exec(t);
  if (m) return [0, m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1])];
  m = new RegExp(`^(${NUM})([+-](?:\\d+(?:\\.\\d*)?|\\.\\d+)?)[ij]$`).exec(t);
  if (m) return [Number(m[1]), m[2] === "+" ? 1 : m[2] === "-" ? -1 : Number(m[2])];
  return [NaN, NaN];
}

type CastScalar = number | string | Cx | boolean | null;

// Cast one scalar. `cx` marks x as a complex tuple (a Cx IS a 2-number array,
// indistinguishable from a 2-element list by value alone — the caller decides
// from the source socket type). `dateish` makes "to text" use the date
// formatter for numeric serials.
function castOne(x: unknown, target: CastTarget, format: string, dateish: boolean, cx: boolean): CastScalar {
  if (x == null) return null;
  switch (target) {
    case "number": {
      if (cx) return (x as Cx)[0]; // real part
      if (typeof x === "number") return x;
      // logical↔number is the one cross-family bridge (TRUE→1, FALSE→0, Excel
      // N(TRUE)=1) — Cast already does number→logical, so honour the reverse too.
      if (typeof x === "boolean") return x ? 1 : 0;
      if (typeof x === "string") { const n = Number(x.trim()); return Number.isNaN(n) ? NaN : n; }
      return NaN;
    }
    case "text": {
      if (cx) return formatCx(x as Cx);
      if (typeof x === "string") return x;
      if (typeof x === "number") {
        return dateish ? formatDateSerial(x, format || DEFAULT_DATE_FORMAT) : formatNumberPattern(x, format);
      }
      return String(x);
    }
    case "date": {
      if (typeof x === "number") return x; // already a serial
      if (typeof x === "string") return parseDateToSerial(x);
      return NaN;
    }
    case "complex": {
      if (cx) return x as Cx;
      if (typeof x === "number") return [x, 0] as Cx;
      if (typeof x === "string") return parseCx(x);
      return [NaN, NaN] as Cx;
    }
    case "logical": {
      // x is non-null here (the top guard returned null for a blank). A SUCCESS is a
      // real boolean; an unparseable value → NaN, the failure sentinel castFailed
      // already recognises (a boolean is not a number, so success never reads as a
      // failure). Shares coerceLogical with Get Column's read-as so both parse alike.
      const b = coerceLogical(x);
      return b === null ? NaN : b;
    }
  }
}

// Did a SCALAR cast fail to produce a usable value? `castOne` signals failure
// with NaN (number/date targets) or [NaN, NaN] (complex). A `null` result means
// the input itself was blank — that's not a failure, it stays a blank.
function castFailed(v: CastScalar, target: CastTarget): boolean {
  if (v === null) return false;
  if (target === "complex") {
    return Array.isArray(v) && (Number.isNaN(v[0]) || Number.isNaN(v[1]));
  }
  return typeof v === "number" && Number.isNaN(v);
}

// ─── Display ──────────────────────────────────────────────────────────────────
// Shape the cast result for ValueDisplay so it renders like every other node: a
// LIST becomes a chip, never a pre-joined "[a, b, c]" string (the bug this
// fixes). Number AND date targets stay numeric serials — ValueDisplay formats
// the date ones for us, since the output socket is a date type (datecombo); the
// complex target renders formatted "a+bi" strings (ValueDisplay can't format a
// complex tuple). A blank/failed cell is "" in a string list / NaN in a numeric
// one, keeping the array homogeneous for ValueDisplay's number-vs-text detection.
function displayScalar(v: CastScalar, target: CastTarget): number | string | boolean | null {
  if (v === null) return null;
  switch (target) {
    case "number":  return v as number;
    case "date":    return v as number; // a serial; ValueDisplay formats it as a date
    case "complex": return formatCx(v as Cx);
    case "text":    return v as string;
    case "logical": return v as boolean; // ValueDisplay renders a boolean as TRUE/FALSE
  }
}

function displayList(out: (CastScalar | SolError)[], target: CastTarget): (number | null | SolError)[] | (string | null)[] | (boolean | null | SolError)[] {
  if (target === "number" || target === "date") {
    // Numeric/date list: keep `null` (blank) and per-cell `SolError`; ValueDisplay's
    // formatListCell renders both (null → "null", error → its code).
    return out.map((v) => (v === null || isSolError(v) ? v : (v as number))) as (number | null | SolError)[];
  }
  if (target === "logical") {
    // Logical list: keep `null` (blank) + per-cell `SolError`; ValueDisplay renders a
    // boolean cell as TRUE/FALSE (formatListCell), so no stringifying here.
    return out.map((v) => (v === null || isSolError(v) ? v : (v as boolean))) as (boolean | null | SolError)[];
  }
  // Text / complex render as strings: a per-cell error shows its code, a blank → null.
  return out.map((v) =>
    v === null ? null : isSolError(v) ? v.code : (displayScalar(v as CastScalar, target) as string),
  );
}

export class CastNode extends ClassicPreset.Node {
  label: string;
  target: CastTarget;
  // ValueDisplay-compatible: a number/string scalar, a number[]/string[] list
  // (→ chip), an error, or null. NOT a pre-joined string (see displayList).
  cachedResult: number | (number | null | SolError)[] | string | (string | null)[] | boolean | (boolean | null | SolError)[] | SolError | null = null;
  width = 252; height = 190; // 252 fits the 5-segment type SegToggle (see .solenoid-node--cast)

  constructor(init?: { label?: string; target?: CastTarget }) {
    super("Cast");
    this.label = init?.label ?? "Cast";
    this.target = init?.target ?? "text";
    this.addInput("value",  trueAnyIn("Value"));
    this.addOutput("result", castOutput(this.target));
  }

  // dataType of the socket feeding `value` — distinguishes a complex [re, im]
  // tuple from a 2-number list, and a date serial from a plain number.
  private sourceKind(): SocketDataType | null {
    const editor = getEditor();
    if (!editor) return null;
    const conn = editor.getConnections().find(
      (c) => c.target === this.id && c.targetInput === "value",
    );
    if (!conn) return null;
    const sock = editor.getNode(conn.source)?.outputs[conn.sourceOutput]?.socket;
    return sock && "dataType" in sock ? (sock as { dataType: SocketDataType }).dataType : null;
  }

  data(inputs: { value?: unknown[] }): { result: CastScalar | (CastScalar | SolError)[] | SolError } {
    const raw = inputs.value?.[0];
    // No custom format code for now — text casts use the default representation.
    const format = "";
    const kind = this.sourceKind();
    const isCxValue = kind === "complex" && Array.isArray(raw) && raw.length === 2 && typeof raw[0] === "number";
    const dateish = kind != null && isDateType(kind);

    // A Cx input is itself an array — `mapped` (not Array.isArray of the
    // result) is what distinguishes "a list of results" from "one complex".
    const mapped = !isCxValue && Array.isArray(raw);
    if (mapped) {
      // List path (relaxed invariant): a per-element parse FAILURE → per-cell
      // #VALUE! error (propagates); a blank input element → null (missing).
      const raw2 = (raw as unknown[]).map((el) => castOne(el, this.target, format, dateish, false));
      const out: (CastScalar | SolError)[] = raw2.map((v) =>
        v === null ? null
        : castFailed(v, this.target) ? solError("#VALUE!", `Could not convert the value to ${this.target}`)
        : v,
      );
      this.cachedResult = displayList(out, this.target);
      return { result: out };
    }

    const scalar = castOne(raw, this.target, format, dateish, isCxValue);
    // A genuine scalar parse failure (text that isn't a number/date, an
    // unparseable complex literal) is a #VALUE! error — not a blank. `null`
    // (the input was itself blank/unwired) stays null.
    if (castFailed(scalar, this.target)) {
      const err = solError("#VALUE!", `Could not convert the value to ${this.target}`);
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = displayScalar(scalar, this.target);
    return { result: scalar };
  }
}
