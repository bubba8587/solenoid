// Date-aware display helpers for ValueDisplay; a value is a DATE when the host node's
// OUTPUT SOCKET is a date type, never because its cells look like serials.

import { isCx, formatCx, type Cx } from "../cxValue";
import { getOwningEditor } from "../activeGraph";
import { SolenoidSocket, isDateType, elementFamilyOf, type SocketDataType } from "../sockets";
import type { ElemFamily } from "./ArrayChip";
import { formatDateSerial, DEFAULT_DATE_FORMAT, DEFAULT_DATETIME_FORMAT } from "../nodes/date";
import { isSolError, type SolError } from "../errorValue";
import { isUnitCell, formatUnitCell, type UnitCell } from "../unitValue";
import { fcUnitToUnit } from "../unitBridge";
import { dimEqual } from "../dimension";
import { formatScalar } from "./format";
import { formatNumberWithAnnotation, formatCxWithAnnotation, applyTextCase, applyLogicalStyle, type FormatAnnotation } from "../formatAnnotationStore";

/** One inline-output-row cell, honouring a resolved FC annotation: numbers via the
 *  annotation formatter, Cx likewise, text case and logical style applied; errors
 *  and null untouched. Multi-row cards resolve the annotation per SOCKET. */
export type RowCell = number | boolean | string | Cx | SolError | null;
export function formatRowCell(v: RowCell, ann?: FormatAnnotation): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return applyLogicalStyle(v, ann?.logicalStyle);
  if (typeof v === "string") return ann ? applyTextCase(v, ann.textCase) : v;
  if (isCx(v)) return ann ? formatCxWithAnnotation(v, ann) : formatCx(v);
  if (isSolError(v)) return v.code;
  return ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v);
}

export function formatRowValue(v: RowCell | RowCell[], ann?: FormatAnnotation): string {
  if (Array.isArray(v)) {
    const head = v.slice(0, 3).map((c) => formatRowCell(c, ann)).join(", ");
    return v.length > 3 ? `${head}, …` : head || "—";
  }
  return formatRowCell(v, ann);
}

export type DisplayValue =
  | number
  // A tagged complex rides RAW into the value box — pre-formatting in a component would
  // produce a fixed string no FC annotation can touch.
  | Cx
  | (Cx | null | SolError)[]
  | UnitCell
  | (number | UnitCell | null | SolError)[]
  | (number | null | SolError)[]
  | string
  | (string | null)[]
  | boolean
  | (boolean | null)[]
  | (number | string | boolean | null | SolError)[]
  | (number | string | boolean | null | SolError)[][]
  | SolError
  | null;

/** Format ONE list element for the value box / clipboard: `null` for a missing cell,
 *  `TRUE`/`FALSE` (Excel form) for a logical, `#CODE!` for an error. */
export function formatListCell(v: number | string | boolean | null | SolError | UnitCell | Cx, fmtNum: (n: number) => string): string {
  if (v === null) return "null";
  if (isUnitCell(v)) return formatCellWithDisplay(v, fmtNum);
  if (isCx(v)) return formatCx(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isSolError(v)) return v.code;
  if (typeof v === "string") return v;
  return fmtNum(v);
}

// A `UnitCell` must be unwrapped before ValueDisplay's number/string branches: with an FC
// docked, to the magnitude in its display unit; without one, to a "magnitude symbol" string.

/** The magnitude of a dimensioned cell in `ann`'s display unit when commensurable, else the
 *  raw base-SI magnitude; the UNannotated case goes through `formatCellWithDisplay`. */
function displayMagnitude(cell: UnitCell, ann: FormatAnnotation | undefined): number {
  const id = cell.display ?? (ann && ann.unit !== "none" && ann.unit !== "custom" ? ann.unit : undefined);
  if (id) {
    const u = fcUnitToUnit(id);
    if (u && dimEqual(u.dim, cell.dim)) return (cell.value - (u.offset ?? 0)) / u.scale;
  }
  return cell.value;
}

/** Render a dimensioned cell as "magnitude unit", preferring its authored `display` unit;
 *  the pure formatter can't do this — only the display layer reaches the FC unit registry. */
function formatCellWithDisplay(cell: UnitCell, fmtNum: (n: number) => string): string {
  if (cell.display) {
    const u = fcUnitToUnit(cell.display);
    if (u && dimEqual(u.dim, cell.dim)) {
      const mag = (cell.value - (u.offset ?? 0)) / u.scale;
      const ann = { format: "auto", unit: cell.display } as FormatAnnotation;
      return formatNumberWithAnnotation(mag, ann);
    }
  }
  return formatUnitCell(cell, fmtNum);
}

/** Replace any `UnitCell` in a display value with its render form; a no-op otherwise. */
export function unwrapUnitCells(value: DisplayValue, ann: FormatAnnotation | undefined): DisplayValue {
  if (isUnitCell(value)) {
    return ann ? displayMagnitude(value, ann) : formatCellWithDisplay(value, formatScalar);
  }
  if (Array.isArray(value) && value.some((c) => isUnitCell(c))) {
    if (ann) {
      return (value as (number | UnitCell | null | SolError)[]).map((c) =>
        isUnitCell(c) ? displayMagnitude(c, ann) : c) as DisplayValue;
    }
    return (value as (number | UnitCell | boolean | string | null | SolError)[])
      .map((c) => formatListCell(c, formatScalar)) as unknown as DisplayValue;
  }
  return value;
}

/** Date only, or date + time when the serial carries a time fraction (e.g. NOW()). */
function fmtSerial(v: number): string {
  if (!Number.isFinite(v)) return "";
  const hasTime = Math.abs(v - Math.round(v)) > 1e-4;
  return formatDateSerial(v, hasTime ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATE_FORMAT);
}

/** The concrete data type of the value a node DISPLAYS. A wildcard still on the socket
 *  after adoption means genuinely unknown, and is honoured rather than guessed past. */
function displayedType(nodeId: string, outKey?: string): SocketDataType | undefined {
  // An internal drill-in node lives in the internal editor, not main.
  const editor = getOwningEditor(nodeId);
  const node = editor?.getNode(nodeId) as
    (Record<string, unknown> & { outputs?: Record<string, { socket?: unknown } | undefined> }) | undefined;
  if (!node) return undefined;
  // `outKey` names WHICH socket to read on a multi-output card; never a traversal.
  const out = outKey ? node.outputs?.[outKey] : (node.outputs?.result ?? Object.values(node.outputs ?? {})[0]);
  const sock = out?.socket;
  return sock instanceof SolenoidSocket ? sock.dataType : undefined;
}

export function nodeOutputIsDate(nodeId: string | null): boolean {
  return nodeOutputElemFamily(nodeId) === "date";
}

/** The ELEMENT FAMILY the node's output socket DECLARES — the socket is the truth, never
 *  the cells; `undefined` (wildcard / non-family) is where a caller may scan cells. */
export function nodeOutputElemFamily(nodeId: string | null, outKey?: string): ElemFamily | undefined {
  if (!nodeId) return undefined;
  const t = displayedType(nodeId, outKey);
  if (t === undefined) return undefined;
  if (isDateType(t)) return "date";
  const fam = elementFamilyOf(t);
  return fam === "number" || fam === "string" || fam === "logical" || fam === "complex" ? fam : undefined;
}

/** Turn numeric serials into date strings when the output socket is a date; a no-op once an
 *  FC annotation is present, since the FC formats dates itself. */
export function dateFormatDisplay(value: DisplayValue, dateLike: boolean, hasAnnotation: boolean): DisplayValue {
  if (!dateLike || hasAnnotation) return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? fmtSerial(value) : value;
  }
  // PER CELL, and never gated on cell 0. `dateLike` is the DECLARED family, so every
  // cell here is a date cell; deciding the whole list's treatment from the first one
  // meant a leading valid date turned every error and blank after it into "" — an
  // #AMBIGUOUS! cell rendered as an empty cell, which is the one thing it must not do.
  if (Array.isArray(value)) {
    return (value as (number | string | boolean | null | SolError)[]).map((v) => {
      if (isSolError(v)) return v.code;   // an error cell keeps its #CODE!
      if (v === null) return "";          // a blank stays blank
      // A non-finite SERIAL is dirty data with no date to show — blank, per the pin.
      if (typeof v === "number") return Number.isFinite(v) ? fmtSerial(v) : "";
      return v;                           // text/logical cells pass through
    }) as unknown as DisplayValue;
  }
  return value;
}

/**
 * Should a list render INLINE (joined text) rather than as a chip?
 *  • expanded Display (`full === true`) → inline, so a resized box shows the list;
 *  • a normal node with an FC annotation (`full === undefined`) → inline, so the
 *    formatting is visible (the chip can't show it);
 *  • COLLAPSED Display (`full === false`) → NEVER inline (always a chip) — the
 *    collapse-to-chip behavior must win even when an FC is docked. Non-Display
 *    nodes never pass `full`, so it's `undefined` there.
 */
export function shouldRenderListInline(full: boolean | undefined, hasAnnotation: boolean): boolean {
  return full === true || (full === undefined && hasAnnotation);
}
