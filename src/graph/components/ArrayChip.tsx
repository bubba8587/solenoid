import { type Cell, type TablePopupState } from "../tablePopupStore";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import { openArrayPopup, isArrayValue, is2D, elemFamilyOfCells, type ElemFamily } from "../valuePopup";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";

// The popup openers and value classification live beside the popup store (valuePopup.ts);
// re-exported here so the chip's long-standing consumers keep their import path.
export { isArrayValue, type ElemFamily };

type ArrayValue = Cell[] | Cell[][];

/** Mirrors the `--elem-*` classes in ArrayChip.css; `undefined` (a genuine wildcard)
 *  falls back to the plain list/table color. */
export function arrayAccentFor(family: ElemFamily | undefined, twoD: boolean): string {
  const suffix = twoD ? "table" : "list";
  switch (family) {
    case "string":  return `var(--sock-str${suffix})`;
    case "date":    return `var(--sock-date${suffix})`;
    case "logical": return `var(--sock-logical${suffix})`;
    case "complex": return `var(--sock-complex${suffix})`;
    default:        return twoD ? "var(--sock-table)" : "var(--sock-list)";
  }
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
  /** The SOCKET-declared element family — every chip sits on a known output
   *  socket, so derive it there (`nodeOutputElemFamily`); REQUIRED so a new host
   *  can't silently fall back to cell-guessing (the recurring untinted-chip bug).
   *  Pass the derived value even when it's `undefined` — that means the socket is
   *  a genuinely unresolved wildcard rung, the one case cells are sniffed. */
  elem: ElemFamily | undefined;
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
        openArrayPopup(value, {
          label, hostId, elem: family, onSave, popupOverrides,
          accent: accent || st.accent, groupColor: st.groupColor, groupColorDark: st.groupColorDark,
        });
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{chipLabel}]
    </button>
  );
}
