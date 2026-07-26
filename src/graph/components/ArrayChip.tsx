import { tablePopup, type Cell, type TablePopupState } from "../tablePopupStore";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import { isSolError } from "../errorValue";
import { matrixUnitOf } from "../unitValue";
import "./ArrayChip.css";

// A list or a table (2D), of numbers (number/list/table sockets) or text
// (strlist). A 1D list opens in the popup as a single row.
type ArrayValue = Cell[] | Cell[][];

function is2D(v: ArrayValue): v is Cell[][] {
  return Array.isArray(v[0]);
}
function to2D(v: ArrayValue): Cell[][] {
  // A list is orientation-less; present it as a single row so it reads and copies
  // horizontally — matching the comma-separated result box and CSV's one-line row.
  return is2D(v) ? v : [v as Cell[]];
}
// Cell kind drives the popup's alignment / coercion / CSV-quoting (see TablePopup,
// whose CellType has all four). The declared socket FAMILY decides it when the
// caller knows one — the cell scan below is only a fallback for a wildcard output,
// and it's a poor one: it reads the FIRST cell, so a leading `null` (an unparseable
// first entry) made a text list open as numeric, and a boolean list could never
// report "logical" at all.
function cellTypeOf(v: ArrayValue, family?: ElemFamily): "number" | "string" | "date" | "logical" {
  if (family) return family;
  const first = is2D(v) ? (v[0] as Cell[])[0] : (v as Cell[])[0];
  return typeof first === "string" ? "string" : "number";
}

export type ElemFamily = "number" | "string" | "date" | "logical";

/** The chip's element-family tint, when the container is HOMOGENEOUS and known.
 *  Dates are indistinguishable from numbers by value (serials) — a caller that
 *  knows the socket family passes `elem` instead. Mixed/unknown → undefined
 *  (the container-kind default color — a chip must not guess). */
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

/**
 * A clickable chip for an array value — `[List]` for a 1D list, `[R×C Table]` for
 * a 2D table — that opens the full grid in the CSV popup. Works for numeric and
 * text (string-list) arrays alike. Used in node value boxes and collapsed-group
 * readouts: result boxes are too narrow for an inline value preview, so the chip
 * stands alone. Pass a `label` to title the popup.
 */
export function ArrayChip({ value, label, size = "md", accent, onSave, pinNodeId, elem, popupOverrides }: {
  value: ArrayValue;
  label?: string;
  /** `"sm"` is the compact chip used in node result boxes (where a grid preview
   *  already sits above it); `"md"` is the default, used in collapsed groups. */
  size?: "sm" | "md";
  /** Accent for the opened popup header (any CSS color, e.g. `var(--sock-list)`).
   *  Defaults to the host's sniffed `--node-accent`; pass it explicitly when the
   *  chip itself is recolored (e.g. the neutral pin-HUD chips) so the popup still
   *  gets a real type accent instead of a body-matching one. */
  accent?: string;
  /** When set, the popup opens editable and Save writes the grid back through
   *  this. Used by input nodes (e.g. Table Input) whose result box *is* the
   *  editor — clicking the chip opens the grid to edit. */
  onSave?: (next: (number | null)[][]) => void;
  /** The node whose value the popup's Pin action pins. Defaults to the host node
   *  from context (a chip inside a node body). Pass it explicitly where there's no
   *  context but a known node — a collapsed-group readout passes its member id so
   *  the popup can still pin that member. Leave unset (and outside any node) for
   *  the HUD chips, which are already pinned. */
  pinNodeId?: string;
  /** Element-family tint override — pass when the caller KNOWS the socket family
   *  (a date list's serials are numbers by value). Otherwise the chip derives it
   *  from the cells when they're homogeneous, and stays the container color when
   *  mixed or empty. */
  elem?: ElemFamily;
  /** Extra fields merged into the popup open() — Table Input passes its raw
   *  literal cells + onSaveRaw so the grid edits source text, never derived
   *  values. */
  popupOverrides?: Partial<TablePopupState>;
}) {
  // The node the Pin action targets: an explicit prop wins (group readouts), else
  // the host node from context (a chip inside a node body), else null (HUD chips).
  // The hook must run every render (Rules of Hooks), so read it then prefer the prop.
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  const table = is2D(value);
  const rows = value.length;
  const cols = table ? (value[0] as number[]).length : 1;
  // Family tint class: explicit socket knowledge wins, else a homogeneous cell
  // scan; numeric keeps the container default (no visual churn).
  const family = elem ?? elemFamilyOfCells(value);
  const famClass = family && family !== "number"
    ? ` solenoid-array-chip--elem-${family}${table ? "-table" : ""}`
    : "";

  // A homogeneous numeric matrix carries ONE unit for the whole grid (D20). The chip
  // stays short (no unit on the label — the popup surfaces it); we still pass the tag
  // into the popup below.
  const matUnit = table ? matrixUnitOf(value) : undefined;
  // Lists are always 1D, so the chip just says "List" — only tables show R×C.
  const chipLabel = table ? `${rows}×${cols} Table` : "List";
  const verb = onSave ? "edit" : "view";
  const titleText = table ? `${rows}×${cols} table. Click to ${verb}.` : `${rows}-item list. Click to ${verb}.`;

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--array${famClass}${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={titleText}
      onClick={(e) => {
        e.stopPropagation();
        // Accent: explicit prop, else the inherited node/group style (list TYPE
        // colour when there's no node context).
        const st = readChipPopupStyle(e.currentTarget, "--sock-list");
        tablePopup.open({
          title: label || (table ? "Table" : "List"),
          data: to2D(value),
          cellType: cellTypeOf(value, family),
          list: !table,
          // A read-only numeric matrix gets one format+unit pair (homogeneous).
          // The popup only renders it when the grid isn't editable, so an editable
          // Table Input (onSaveRaw via popupOverrides) never shows it.
          formatControls: table && cellTypeOf(value, family) === "number" ? "matrix" : undefined,
          // Carry the matrix's homogeneous unit tag (D20) so the popup bar shows it
          // (as a static label when the matrix isn't a taggable source).
          columnUnits: matUnit ? [matUnit] : undefined,
          accent: accent || st.accent,
          groupColor: st.groupColor,
          groupColorDark: st.groupColorDark,
          pinNodeId: hostId ?? undefined,
          onSave,
          ...popupOverrides,
        });
      }}
      onPointerDown={(e) => e.stopPropagation()}
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
