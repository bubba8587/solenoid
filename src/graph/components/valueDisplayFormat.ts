// [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream. Mechanics: tree/specs/values/unit-flow.md.

import { isCx, formatCxDisplay, type Cx } from "../cxValue";
import { getOwningEditor } from "../activeGraph";
import { sharedAnnotationResolver } from "../unitFlow";
import { SolenoidSocket, isDateType, elementFamilyOf, type SocketDataType } from "../sockets";
import type { ElemFamily } from "./ArrayChip";
import { formatDateSerial, DEFAULT_DATE_FORMAT, DEFAULT_DATETIME_FORMAT } from "../nodes/dateSerial";
import { isSolError, type SolError } from "../errorValue";
import { isUnitCell, formatUnitCell, type UnitCell } from "../unitValue";
import { fcUnitToUnit } from "../unitBridge";
import { dimEqual } from "../dimension";
import { formatScalar } from "./format";
import { formatAnnotationStore, formatNumberWithAnnotation, formatCxWithAnnotation, applyTextCase, applyLogicalStyle, type FormatAnnotation } from "../formatAnnotationStore";

export function resolveDisplayAnnotation(nodeId: string | null, socketKey?: string): FormatAnnotation | undefined {
  if (!nodeId) return undefined;
  const direct = socketKey
    ? formatAnnotationStore.get(nodeId, socketKey)
    : formatAnnotationStore.getForNode(nodeId);
  if (direct) return direct;
  // Owning editor, so a node inside a drill-in resolves its FC there.
  const editor = getOwningEditor(nodeId);
  const node = editor?.getNode(nodeId) as
    (Record<string, unknown> & { outputs?: Record<string, unknown> }) | undefined;
  if (!editor || !node) return undefined;
  // Memoized per microtask, so a card pays one graph walk per commit.
  const resolver = sharedAnnotationResolver(editor);
  for (const k of socketKey ? [socketKey] : Object.keys(node.outputs ?? {})) {
    const a = resolver.outAnnotation(nodeId, k) ?? resolver.downstreamAnnotation(nodeId, k);
    if (a) return a;
  }
  return undefined;
}

export type RowCell = number | boolean | string | Cx | SolError | null;
export function formatRowCell(v: RowCell, ann?: FormatAnnotation): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return applyLogicalStyle(v, ann?.logicalStyle);
  if (typeof v === "string") return ann ? applyTextCase(v, ann.textCase) : v;
  if (isCx(v)) return ann ? formatCxWithAnnotation(v, ann) : formatCxDisplay(v);
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
  // A complex rides raw: pre-formatting it in a component would give a string no FC can touch.
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

export function formatListCell(
  v: number | string | boolean | null | SolError | UnitCell | Cx,
  fmtNum: (n: number) => string,
  ann?: FormatAnnotation,
): string {
  if (v === null) return "null";
  if (isUnitCell(v)) {
    const a = annotationForValue(v, ann);
    return a ? formatNumberWithAnnotation(displayMagnitude(v, a), a) : formatCellWithDisplay(v, fmtNum);
  }
  if (isCx(v)) return ann ? formatCxWithAnnotation(v, ann) : formatCxDisplay(v);
  if (typeof v === "boolean") return applyLogicalStyle(v, ann?.logicalStyle);
  if (isSolError(v)) return v.code;
  if (typeof v === "string") return ann ? applyTextCase(v, ann.textCase) : v;
  return fmtNum(v);
}

function annotationCarriesNoUnit(ann: FormatAnnotation): boolean {
  return ann.unit === "none" || (ann.unit === "custom" && !ann.customUnit);
}

export function annotationForValue(value: unknown, ann: FormatAnnotation | undefined): FormatAnnotation | undefined {
  if (!ann || !annotationCarriesNoUnit(ann)) return ann;
  const cell = isUnitCell(value)
    ? value
    : Array.isArray(value) ? (value as unknown[]).find((c) => isUnitCell(c)) : undefined;
  return cell?.display ? { ...ann, unit: cell.display, customUnit: "" } : ann;
}


/** Falls back to the raw base-SI magnitude when the units aren't commensurable. */
function displayMagnitude(cell: UnitCell, ann: FormatAnnotation | undefined): number {
  const id = cell.display ?? (ann && ann.unit !== "none" && ann.unit !== "custom" ? ann.unit : undefined);
  if (id) {
    const u = fcUnitToUnit(id);
    if (u && dimEqual(u.dim, cell.dim)) return (cell.value - (u.offset ?? 0)) / u.scale;
  }
  return cell.value;
}

/** Only the display layer reaches the FC unit registry, so the pure formatter can't do this. */
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

export function unwrapUnitCells(value: DisplayValue, ann: FormatAnnotation | undefined): DisplayValue {
  if (isUnitCell(value)) {
    return ann ? displayMagnitude(value, ann) : formatCellWithDisplay(value, formatScalar);
  }
  if (Array.isArray(value) && value.some((c) => isUnitCell(c))) {
    if (ann) {
      return (value as (number | UnitCell | null | SolError)[]).map((c) =>
        isUnitCell(c) ? displayMagnitude(c, ann) : c);
    }
    return (value as (number | UnitCell | boolean | string | null | SolError)[])
      .map((c) => formatListCell(c, formatScalar));
  }
  return value;
}

function fmtSerial(v: number): string {
  if (!Number.isFinite(v)) return "";
  const hasTime = Math.abs(v - Math.round(v)) > 1e-4;
  return formatDateSerial(v, hasTime ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATE_FORMAT);
}

/** A wildcard still on the socket after adoption means unknown, and is honored rather than guessed past. */
function displayedType(nodeId: string, outKey?: string): SocketDataType | undefined {
  const editor = getOwningEditor(nodeId);
  const node = editor?.getNode(nodeId) as
    (Record<string, unknown> & { outputs?: Record<string, { socket?: unknown } | undefined> }) | undefined;
  if (!node) return undefined;
  const out = outKey ? node.outputs?.[outKey] : (node.outputs?.result ?? Object.values(node.outputs ?? {})[0]);
  const sock = out?.socket;
  return sock instanceof SolenoidSocket ? sock.dataType : undefined;
}

export function nodeOutputIsDate(nodeId: string | null): boolean {
  return nodeOutputElemFamily(nodeId) === "date";
}

/** `undefined` (a wildcard or no family) is the only case where a caller may scan cells. */
export function nodeOutputElemFamily(nodeId: string | null, outKey?: string): ElemFamily | undefined {
  if (!nodeId) return undefined;
  const t = displayedType(nodeId, outKey);
  if (t === undefined) return undefined;
  if (isDateType(t)) return "date";
  const fam = elementFamilyOf(t);
  return fam === "number" || fam === "string" || fam === "logical" || fam === "complex" ? fam : undefined;
}

export function dateFormatDisplay(value: DisplayValue, dateLike: boolean, hasAnnotation: boolean): DisplayValue {
  if (!dateLike || hasAnnotation) return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? fmtSerial(value) : value;
  }
  // Per cell, never decided from cell 0: a leading valid date must not turn a later error or blank into an empty cell.
  if (Array.isArray(value)) {
    return (value as (number | string | boolean | null | SolError)[]).map((v) => {
      if (isSolError(v)) return v.code;
      if (v === null) return "";
      // A non-finite serial is dirty data with no date to show, so it is blank.
      if (typeof v === "number") return Number.isFinite(v) ? fmtSerial(v) : "";
      return v;
    });
  }
  return value;
}

export function shouldRenderListInline(full: boolean | undefined, hasAnnotation: boolean): boolean {
  return full === true || (full === undefined && hasAnnotation);
}
