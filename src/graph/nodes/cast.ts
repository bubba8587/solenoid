// [[D16]] retypeReconciles, [[E11]] controlDrivenRetype
import { ClassicPreset } from "rete";
import { isDateType, type SocketDataType } from "../sockets";
import { trueAnyIn, numListOut, strComboOut, dateComboOut, complexOut, logicalComboOut } from "./shared";
import { coerceLogical } from "../valueKinds";
import { formatDateSerial, parseDateToSerial, DEFAULT_DATE_FORMAT } from "./date";
import { formatCx, cx, isCx, type Cx } from "./complex";
import { formatNumberPattern } from "./text";

import { solError, isSolError, type SolError } from "../errorValue";
import { getOwningEditor } from "../activeGraph";

export type CastTarget = "number" | "text" | "date" | "complex" | "logical";

export const CAST_TARGET_META: Record<CastTarget, { label: string; title: string }> = {
  number:  { label: "Number",  title: "Parse text, a logical's 1/0, or a complex value's real part. Pass numbers through" },
  text:    { label: "Text",    title: "Format numbers and dates (with the format pattern) or complex values as text" },
  date:    { label: "Date",    title: "Parse date text to an Excel serial. Numbers pass through as serials" },
  complex: { label: "Complex", title: "Parse \"a+bi\" text. Numbers become re+0i" },
  logical: { label: "Boolean", title: "Parse TRUE/FALSE text (or a nonzero number) to a logical TRUE/FALSE" },
};

export function castOutput(target: CastTarget) {
  switch (target) {
    case "number":  return numListOut("Number");
    case "text":    return strComboOut("Text");
    case "date":    return dateComboOut("Date");
    case "complex": return complexOut("Complex");
    case "logical": return logicalComboOut("Boolean");
  }
}

// Accepts a, bi, a+bi, a-bi, i and -i, with j for i.
export function parseCx(s: string): Cx {
  const t = s.trim().replace(/\s+/g, "");
  if (t === "") return cx(NaN, NaN);
  const NUM = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  let m = new RegExp(`^(${NUM})$`).exec(t);
  if (m) return cx(Number(m[1]), 0);
  m = new RegExp(`^([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)?)[ij]$`).exec(t);
  if (m) return cx(0, m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]));
  m = new RegExp(`^(${NUM})([+-](?:\\d+(?:\\.\\d*)?|\\.\\d+)?)[ij]$`).exec(t);
  if (m) return cx(Number(m[1]), m[2] === "+" ? 1 : m[2] === "-" ? -1 : Number(m[2]));
  return cx(NaN, NaN);
}

type CastScalar = number | string | Cx | boolean | null;

// `dateish` makes a text cast use the date formatter for numeric serials.
function castOne(x: unknown, target: CastTarget, format: string, dateish: boolean): CastScalar {
  if (x == null) return null;
  switch (target) {
    case "number": {
      if (isCx(x)) return x.re;
      if (typeof x === "number") return x;
      if (typeof x === "boolean") return x ? 1 : 0;
      if (typeof x === "string") { const n = Number(x.trim()); return Number.isNaN(n) ? NaN : n; }
      return NaN;
    }
    case "text": {
      if (isCx(x)) return formatCx(x);
      if (typeof x === "string") return x;
      if (typeof x === "number") {
        return dateish ? formatDateSerial(x, format || DEFAULT_DATE_FORMAT) : formatNumberPattern(x, format);
      }
      return String(x);
    }
    case "date": {
      if (typeof x === "number") return x;
      if (typeof x === "string") return parseDateToSerial(x);
      return NaN;
    }
    case "complex": {
      if (isCx(x)) return x;
      if (typeof x === "number") return cx(x, 0);
      if (typeof x === "string") return parseCx(x);
      return cx(NaN, NaN);
    }
    case "logical": {
      // Unparseable gives NaN, the sentinel castFailed reads; a boolean is never a number, so a success cannot look like a failure.
      const b = coerceLogical(x);
      return b === null ? NaN : b;
    }
  }
}

// A null result means a blank input, which is not a failure.
function castFailed(v: CastScalar, target: CastTarget): boolean {
  if (v === null) return false;
  if (target === "complex") {
    return isCx(v) && (Number.isNaN(v.re) || Number.isNaN(v.im));
  }
  return typeof v === "number" && Number.isNaN(v);
}

// A list stays an array for ValueDisplay's chip, dates stay serials, and complex is pre-formatted because ValueDisplay cannot render a complex tuple.
function displayScalar(v: CastScalar, target: CastTarget): number | string | boolean | null {
  if (v === null) return null;
  switch (target) {
    case "number":  return v as number;
    case "date":    return v as number;
    case "complex": return formatCx(v as Cx);
    case "text":    return v as string;
    case "logical": return v as boolean;
  }
}

function displayList(out: (CastScalar | SolError)[], target: CastTarget): (number | null | SolError)[] | (string | null)[] | (boolean | null | SolError)[] {
  if (target === "number" || target === "date") {
    return out.map((v) => (v === null || isSolError(v) ? v : (v as number))) as (number | null | SolError)[];
  }
  if (target === "logical") {
    return out.map((v) => (v === null || isSolError(v) ? v : (v as boolean))) as (boolean | null | SolError)[];
  }
  return out.map((v) =>
    v === null ? null : isSolError(v) ? v.code : (displayScalar(v as CastScalar, target) as string),
  );
}

export class CastNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    value: "A date keeps its date type, so casting it to text formats it as a date.",
    result: "A blank input stays blank rather than failing. A value that will not parse becomes #VALUE!, per cell in a list.",
  };

  label: string;
  target: CastTarget;
  cachedResult: number | (number | null | SolError)[] | string | (string | null)[] | boolean | (boolean | null | SolError)[] | SolError | null = null;
  width = 252; height = 190; // 252 fits the five-segment type SegToggle (.solenoid-node--cast)

  constructor(init?: { label?: string; target?: CastTarget }) {
    super("Cast");
    this.label = init?.label ?? "Cast";
    this.target = init?.target ?? "text";
    this.addInput("value",  trueAnyIn("Value"));
    this.addOutput("result", castOutput(this.target));
  }

  // The source socket's type is the only witness telling a date serial from a number.
  private sourceKind(): SocketDataType | null {
    const editor = getOwningEditor(this.id);
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
    const format = "";
    const kind = this.sourceKind();
    const dateish = kind != null && isDateType(kind);

    if (Array.isArray(raw)) {
      const raw2 = raw.map((el) => castOne(el, this.target, format, dateish));
      const out: (CastScalar | SolError)[] = raw2.map((v) =>
        v === null ? null
        : castFailed(v, this.target) ? solError("#VALUE!", `Could not convert the value to ${this.target}`)
        : v,
      );
      this.cachedResult = displayList(out, this.target);
      return { result: out };
    }

    const scalar = castOne(raw, this.target, format, dateish);
    if (castFailed(scalar, this.target)) {
      const err = solError("#VALUE!", `Could not convert the value to ${this.target}`);
      this.cachedResult = err;
      return { result: err };
    }
    this.cachedResult = displayScalar(scalar, this.target);
    return { result: scalar };
  }
}
