// [[C24]] arraySemantics
import { tablePopup, type Cell, type TablePopupState } from "./tablePopupStore";
import { cubePopup, type CubeEditBinding } from "./cubePopupStore";
import { frameToGrid, frameRowCount, isFrameValue, isCubeValue, type FrameValue, type CubeValue } from "./frame";
import { readFrame, type FrameRef } from "./frameBackend";
import { matrixUnitOf, isUnitCell } from "./unitValue";
import { isSolError } from "./errorValue";
import { isCx } from "./cxValue";

export type ElemFamily = "number" | "string" | "date" | "logical" | "complex";

type ArrayValue = Cell[] | Cell[][];

export function isArrayValue(v: unknown): v is ArrayValue {
  return Array.isArray(v) && v.length > 0;
}

export function is2D(v: ArrayValue): v is Cell[][] {
  return Array.isArray(v[0]);
}
function to2D(v: ArrayValue): Cell[][] {
  return is2D(v) ? v : [v];
}
/** A list of one kind shows as that kind; a mixed list has nothing to render as, so it shows its items as they are. */
function cellTypeOf(v: ArrayValue, family?: ElemFamily): "number" | "string" | "date" | "logical" {
  if (family) return family === "complex" ? "string" : family;
  const present = (is2D(v) ? (v as Cell[][]).flat() : v).some((c) => c !== null && c !== undefined && !isSolError(c));
  return present ? "string" : "number";
}

export function elemFamilyOfCells(v: ArrayValue): ElemFamily | undefined {
  let fam: ElemFamily | undefined;
  for (const cell of (is2D(v) ? (v as Cell[][]).flat() : v)) {
    if (cell === null || cell === undefined || isSolError(cell)) continue;
    const f: ElemFamily | undefined =
      typeof cell === "number" ? "number"
      : typeof cell === "string" ? "string"
      : typeof cell === "boolean" ? "logical"
      : isCx(cell) ? "complex"
      : isUnitCell(cell) ? "number"
      : undefined;
    if (!f) return undefined;
    if (fam && fam !== f) return undefined;
    fam = f;
  }
  return fam;
}

/** The chip tint's modifier: a list of one kind wears that kind's color, a mixed list the neutral "any" gray, and an empty one the default. */
export function elemChipClass(v: ArrayValue, table: boolean, family = elemFamilyOfCells(v)): string {
  if (family) return family === "number" ? "" : ` solenoid-array-chip--elem-${family}${table ? "-table" : ""}`;
  const present = (is2D(v) ? (v as Cell[][]).flat() : v).some((c) => c !== null && c !== undefined && !isSolError(c));
  return present ? " solenoid-array-chip--elem-any" : "";
}

export const POP_OUT_KINDS = ["frame", "cube", "table", "list"] as const;
export type PopOutKind = (typeof POP_OUT_KINDS)[number];
export function popOutKindFor(value: unknown): PopOutKind | null {
  if (isFrameValue(value)) return "frame";
  if (isCubeValue(value)) return "cube";
  if (isArrayValue(value)) return is2D(value) ? "table" : "list";
  return null;
}

export function accentFallbackVar(value: unknown): string | undefined {
  switch (popOutKindFor(value)) {
    case "frame": return "--sock-frame";
    case "cube":  return "--sock-cube";
    case "table":
    case "list":  return "--sock-list";
    default:      return undefined;
  }
}

export interface PopupStyle {
  label?: string;
  hostId?: string | null;
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
}

export async function openFramePopup(
  value: FrameValue,
  { label, hostId, accent, groupColor, groupColorDark }: PopupStyle,
): Promise<void> {
  let resolved = value;
  if (value.__totalRows != null && value.__ref) {
    const collected = await readFrame(value.__ref as FrameRef);
    if (isFrameValue(collected)) resolved = collected;
  }
  tablePopup.open({
    title: label || "Frame",
    data: frameToGrid(resolved),
    headers: resolved.columns.map((c) => c.name),
    columnTypes: resolved.columns.map((c) => c.type),
    sourceCells: !resolved.columns.some((c) => c.raw)
      ? undefined
      : Array.from({ length: frameRowCount(resolved) }, (_, r) => resolved.columns.map((c) => c.raw?.[r] ?? null)),
    cellType: "number",
    formatControls: "columns",
    columnUnits: resolved.columns.map((c) => c.unit),
    columnFormats: resolved.columns.map((c) => c.format),
    accent,
    groupColor,
    groupColorDark,
    pinNodeId: hostId ?? undefined,
  });
}

export function openArrayPopup(
  value: ArrayValue,
  { label, hostId, accent, groupColor, groupColorDark, elem, popupOverrides }: PopupStyle & {
    elem?: ElemFamily;
    popupOverrides?: Partial<TablePopupState>;
  },
): void {
  const table = is2D(value);
  const family = elem ?? elemFamilyOfCells(value);
  const matUnit = table ? matrixUnitOf(value) : undefined;
  tablePopup.open({
    title: label || (table ? "Table" : "List"),
    data: to2D(value),
    cellType: cellTypeOf(value, family),
    list: !table,
    formatControls: table && cellTypeOf(value, family) === "number" ? "matrix" : undefined,
    columnUnits: matUnit ? [matUnit] : undefined,
    accent,
    groupColor,
    groupColorDark,
    pinNodeId: hostId ?? undefined,
    ...popupOverrides,
  });
}

export function openCubePopup(
  value: CubeValue,
  { label, hostId, accent, groupColor, groupColorDark, edit }: PopupStyle & { edit?: CubeEditBinding },
): void {
  cubePopup.open(
    { kind: "cube", cube: value, label: label || "Cube", ...(edit ? { path: [] } : {}) },
    { accent, groupColor, groupColorDark, pinNodeId: hostId ?? undefined, edit },
  );
}

export function openValuePopup(value: unknown, opts: PopupStyle & { elem?: ElemFamily }): void {
  const kind = popOutKindFor(value);
  if (kind === "frame") { void openFramePopup(value as FrameValue, opts); return; }
  if (kind === "cube") { openCubePopup(value as CubeValue, opts); return; }
  if (kind === "table" || kind === "list") openArrayPopup(value as ArrayValue, opts);
}
