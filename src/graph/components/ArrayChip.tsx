import { tablePopup, type Cell, type TablePopupState } from "../tablePopupStore";
import { useHostNodeId } from "./nodeContext";
import { isSolError } from "../errorValue";
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
// Cell kind drives the popup's alignment / coercion / CSV-quoting (see
// TablePopup). A list of strings is text; everything else is numeric.
function cellTypeOf(v: ArrayValue): "number" | "string" {
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
        // Inherit the host node's (or group's) accent + group color so the popup
        // header and (when grouped) its border + corner triangle match the node,
        // like the Formula popup. These vars are set on the card / group root and
        // cascade to this chip.
        const cs = getComputedStyle(e.currentTarget);
        // Accent: explicit prop, else the host node's accent, else the list TYPE
        // colour — so a chip opened with no node context (e.g. inline in a Report)
        // still gets the standard coloured header instead of a bare one.
        const popupAccent =
          accent ||
          cs.getPropertyValue("--node-accent").trim() ||
          cs.getPropertyValue("--sock-list").trim() ||
          undefined;
        const groupColor = cs.getPropertyValue("--group-color").trim();
        const groupColorDark = cs.getPropertyValue("--group-color-dark").trim();
        tablePopup.open({
          title: label || (table ? "Table" : "List"),
          data: to2D(value),
          cellType: cellTypeOf(value),
          list: !table,
          accent: popupAccent,
          groupColor: groupColor || undefined,
          groupColorDark: groupColorDark || undefined,
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
