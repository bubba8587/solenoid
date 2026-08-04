import { tablePopup, type Cell, type TablePopupState } from "../tablePopupStore";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import { isSolError } from "../errorValue";
import { matrixUnitOf } from "../unitValue";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";

type ArrayValue = Cell[] | Cell[][];

function is2D(v: ArrayValue): v is Cell[][] {
  return Array.isArray(v[0]);
}
function to2D(v: ArrayValue): Cell[][] {
  // A list is orientation-less; a single ROW matches the result box and CSV line.
  return is2D(v) ? v : [v as Cell[]];
}
// The declared socket FAMILY decides this when known; the fallback reads the FIRST
// cell only, so a leading `null` misreads a text list as numeric.
function cellTypeOf(v: ArrayValue, family?: ElemFamily): "number" | "string" | "date" | "logical" {
  if (family) return family;
  const first = is2D(v) ? (v[0] as Cell[])[0] : (v as Cell[])[0];
  return typeof first === "string" ? "string" : "number";
}

export type ElemFamily = "number" | "string" | "date" | "logical";

/** Mirrors the `--elem-*` classes in ArrayChip.css; `undefined` (a genuine wildcard)
 *  falls back to the plain list/table color. */
export function arrayAccentFor(family: ElemFamily | undefined, twoD: boolean): string {
  const suffix = twoD ? "table" : "list";
  switch (family) {
    case "string":  return `var(--sock-str${suffix})`;
    case "date":    return `var(--sock-date${suffix})`;
    case "logical": return `var(--sock-logical${suffix})`;
    default:        return twoD ? "var(--sock-table)" : "var(--sock-list)";
  }
}

/** Only answers for a HOMOGENEOUS container; mixed/unknown → undefined, since a chip
 *  must not guess (dates are indistinguishable from numbers by value). */
function elemFamilyOfCells(v: ArrayValue): ElemFamily | undefined {
  let fam: ElemFamily | undefined;
  for (const cell of (is2D(v) ? (v as Cell[][]).flat() : (v as Cell[]))) {
    if (cell === null || cell === undefined || isSolError(cell)) continue; // blanks/errors don't vote
    const f: ElemFamily | undefined =
      typeof cell === "number" ? "number"
      : typeof cell === "string" ? "string"
      : typeof cell === "boolean" ? "logical"
      : undefined;
    if (!f) return undefined;
    if (fam && fam !== f) return undefined; // mixed — no tint
    fam = f;
  }
  return fam;
}

/** A clickable chip that opens the full grid in the table popup; `label` titles it. */
export function ArrayChip({ value, label, size = "md", accent, onSave, pinNodeId, elem, popupOverrides }: {
  value: ArrayValue;
  label?: string;
  /** `"sm"` is the compact chip for node result boxes; `"md"` the default. */
  size?: "sm" | "md";
  /** Popup-header accent; defaults to the host's sniffed `--node-accent`. Pass it
   *  when the chip itself is recolored, so the popup still gets a TYPE accent. */
  accent?: string;
  /** When set, the popup opens editable and Save writes the grid back through this. */
  onSave?: (next: (number | null)[][]) => void;
  /** The node the popup's Pin action targets; defaults to the host node from context. */
  pinNodeId?: string;
  /** Tint override for when the caller KNOWS the socket family; otherwise derived
   *  from homogeneous cells. */
  elem?: ElemFamily;
  /** Merged into the popup open() — Table Input passes raw literal cells + onSaveRaw
   *  so the grid edits source text, never derived values. */
  popupOverrides?: Partial<TablePopupState>;
}) {
  // The hook must run every render (Rules of Hooks), so read it, then prefer the prop.
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  const table = is2D(value);
  const rows = value.length;
  const cols = table ? (value[0] as number[]).length : 1;
  // Explicit socket knowledge wins; numeric keeps the container default.
  const family = elem ?? elemFamilyOfCells(value);
  const famClass = family && family !== "number"
    ? ` solenoid-array-chip--elem-${family}${table ? "-table" : ""}`
    : "";

  // A homogeneous numeric matrix carries ONE unit for the whole grid (D20).
  const matUnit = table ? matrixUnitOf(value) : undefined;
  const chipLabel = table ? `${rows}×${cols} Table` : "List";
  const verb = onSave ? "Edit" : "View";
  const titleText = table ? `${rows}×${cols} table. ${verb}.` : `${rows}-item list. ${verb}.`;

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--array${famClass}${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={titleText}
      onClick={(e) => {
        e.stopPropagation();
        const st = readChipPopupStyle(e.currentTarget, "--sock-list");
        tablePopup.open({
          title: label || (table ? "Table" : "List"),
          data: to2D(value),
          cellType: cellTypeOf(value, family),
          list: !table,
          // A homogeneous matrix gets ONE format+unit pair; the popup renders it only
          // when the grid isn't editable.
          formatControls: table && cellTypeOf(value, family) === "number" ? "matrix" : undefined,
          columnUnits: matUnit ? [matUnit] : undefined,
          accent: accent || st.accent,
          groupColor: st.groupColor,
          groupColorDark: st.groupColorDark,
          pinNodeId: hostId ?? undefined,
          onSave,
          ...popupOverrides,
        });
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{chipLabel}]
    </button>
  );
}

/** True for any value the ArrayChip handles (a non-empty list or table). */
export function isArrayValue(v: unknown): v is ArrayValue {
  return Array.isArray(v) && v.length > 0;
}
