// The ONE home for opening a value's data pop-up — the read-only affordance shared by
// the collapsed chips (ArrayChip/FrameChip/CubeChip) and the Display's corner expand
// button. Lives beside the popup stores, not in a chip file, so a new opener (or the
// button) never re-derives a payload the chip already built. Frames/tables/lists open
// the tablePopup; cubes their own cubePopup (drill stack). displayPopupCoverage.test.ts
// pins that every Display value kind resolves to one of these.
import { tablePopup, type Cell, type TablePopupState, type FramePopupColumn } from "./tablePopupStore";
import { cubePopup } from "./cubePopupStore";
import { frameToGrid, frameRowCount, isFrameValue, isCubeValue, type FrameValue, type CubeValue } from "./frame";
import { readFrame, type FrameRef } from "./frameBackend";
import { matrixUnitOf, isUnitCell } from "./unitValue";
import { isSolError } from "./errorValue";
import { isCx } from "./cxValue";

export type ElemFamily = "number" | "string" | "date" | "logical" | "complex";

type ArrayValue = Cell[] | Cell[][];

/** True for any value the array pop-out handles (a non-empty list or table). */
export function isArrayValue(v: unknown): v is ArrayValue {
  return Array.isArray(v) && v.length > 0;
}

export function is2D(v: ArrayValue): v is Cell[][] {
  return Array.isArray(v[0]);
}
function to2D(v: ArrayValue): Cell[][] {
  // A list is orientation-less; a single ROW matches the result box and CSV line.
  return is2D(v) ? v : [v as Cell[]];
}
// The declared socket FAMILY decides this when known; the fallback reads the FIRST
// cell only, so a leading `null` misreads a text list as numeric.
function cellTypeOf(v: ArrayValue, family?: ElemFamily): "number" | "string" | "date" | "logical" {
  if (family) return family === "complex" ? "string" : family; // Cx cells arrive pre-stringified
  const first = is2D(v) ? (v[0] as Cell[])[0] : (v as Cell[])[0];
  return typeof first === "string" ? "string" : typeof first === "boolean" ? "logical" : "number";
}

/** Only answers for a HOMOGENEOUS container; mixed/unknown → undefined, since a chip
 *  must not guess (dates are indistinguishable from numbers by value). */
export function elemFamilyOfCells(v: ArrayValue): ElemFamily | undefined {
  let fam: ElemFamily | undefined;
  for (const cell of (is2D(v) ? (v as Cell[][]).flat() : (v as Cell[]))) {
    if (cell === null || cell === undefined || isSolError(cell)) continue; // blanks/errors don't vote
    const f: ElemFamily | undefined =
      typeof cell === "number" ? "number"
      : typeof cell === "string" ? "string"
      : typeof cell === "boolean" ? "logical"
      : isCx(cell) ? "complex"
      : isUnitCell(cell) ? "number" // a united number is still numeric
      : undefined;
    if (!f) return undefined;
    if (fam && fam !== f) return undefined; // mixed — no tint
    fam = f;
  }
  return fam;
}

/** The value kinds with a data pop-out; `null` means this value has none (a scalar,
 *  a chart — charts have their OWN popup/guard). The button and the coverage guard
 *  both read this, so a new pop-out kind can't ship without joining the sweep. */
export const POP_OUT_KINDS = ["frame", "cube", "table", "list"] as const;
export type PopOutKind = (typeof POP_OUT_KINDS)[number];
export function popOutKindFor(value: unknown): PopOutKind | null {
  if (isFrameValue(value)) return "frame";
  if (isCubeValue(value)) return "cube";
  if (isArrayValue(value)) return is2D(value) ? "table" : "list";
  return null;
}

/** The value TYPE's socket color, used as the popup accent when there is no node
 *  context — mirrors the fallback each chip passes to readChipPopupStyle. */
export function accentFallbackVar(value: unknown): string | undefined {
  switch (popOutKindFor(value)) {
    case "frame": return "--sock-frame";
    case "cube":  return "--sock-cube";
    case "table":
    case "list":  return "--sock-list"; // ArrayChip uses --sock-list for both
    default:      return undefined;
  }
}

/** Style resolved off the host card (chipStyle.readChipPopupStyle) plus the host id. */
export interface PopupStyle {
  label?: string;
  hostId?: string | null;
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
}

/** Open a frame in the table popup. Read-only unless `onSave` is given (Frame Input's
 *  typed-grid edit). Resolves the FULL frame through its handle first, so a head-N
 *  preview expands to the whole table rather than the truncated sample. */
export async function openFramePopup(
  value: FrameValue,
  { label, hostId, accent, groupColor, groupColorDark, onSave }: PopupStyle & { onSave?: (columns: FramePopupColumn[]) => void },
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
    // Read-only frame: the Source view shows the INPUTTED text, not the value.
    sourceCells: !resolved.columns.some((c) => c.raw)
      ? undefined
      : Array.from({ length: frameRowCount(resolved) }, (_, r) => resolved.columns.map((c) => c.raw?.[r] ?? null)),
    cellType: "number",
    // A derived frame gets the display-only per-column format dropdown.
    formatControls: "columns",
    columnUnits: resolved.columns.map((c) => c.unit),
    columnFormats: resolved.columns.map((c) => c.format),
    editableHeaders: !!onSave,
    onSaveFrame: onSave,
    accent,
    groupColor,
    groupColorDark,
    pinNodeId: hostId ?? undefined,
  });
}

/** Open a list/matrix in the table popup. Editable when `onSave` is given (Table Input);
 *  `popupOverrides` lets a literal source swap in raw cells + onSaveRaw. */
export function openArrayPopup(
  value: ArrayValue,
  { label, hostId, accent, groupColor, groupColorDark, elem, onSave, popupOverrides }: PopupStyle & {
    elem?: ElemFamily;
    onSave?: (next: (number | null)[][]) => void;
    popupOverrides?: Partial<TablePopupState>;
  },
): void {
  const table = is2D(value);
  const family = elem ?? elemFamilyOfCells(value);
  // A homogeneous numeric matrix carries ONE unit for the whole grid (unitGranularity).
  const matUnit = table ? matrixUnitOf(value) : undefined;
  tablePopup.open({
    title: label || (table ? "Table" : "List"),
    data: to2D(value),
    cellType: cellTypeOf(value, family),
    list: !table,
    // A homogeneous matrix gets ONE format+unit pair; the popup renders it only
    // when the grid isn't editable.
    formatControls: table && cellTypeOf(value, family) === "number" ? "matrix" : undefined,
    columnUnits: matUnit ? [matUnit] : undefined,
    accent,
    groupColor,
    groupColorDark,
    pinNodeId: hostId ?? undefined,
    onSave,
    ...popupOverrides,
  });
}

/** Open a cube in its own drill-stack popup. */
export function openCubePopup(
  value: CubeValue,
  { label, hostId, accent, groupColor, groupColorDark }: PopupStyle,
): void {
  cubePopup.open(
    { kind: "cube", cube: value, label: label || "Cube" },
    { accent, groupColor, groupColorDark, pinNodeId: hostId ?? undefined },
  );
}

/** Read-only dispatcher: open whatever pop-out this value has, or nothing. The corner
 *  expand button calls this; editing chips call the typed opener directly so their
 *  Save callback keeps its shape. */
export function openValuePopup(value: unknown, opts: PopupStyle & { elem?: ElemFamily }): void {
  const kind = popOutKindFor(value);
  if (kind === "frame") { void openFramePopup(value as FrameValue, opts); return; }
  if (kind === "cube") { openCubePopup(value as CubeValue, opts); return; }
  if (kind === "table" || kind === "list") openArrayPopup(value as ArrayValue, opts);
}
