// [[C58]] tableInputRawText
import { type Cell, type TablePopupState } from "../tablePopupStore";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import { openArrayPopup, isArrayValue, is2D, elemFamilyOfCells, elemChipClass, type ElemFamily } from "../valuePopup";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";
import { listLength, tableWidth, fullList } from "../listPreview";

export { isArrayValue, type ElemFamily };

type ArrayValue = Cell[] | Cell[][];

/** Mirrors the `--elem-*` classes in ArrayChip.css; `undefined`, a genuine wildcard, takes the plain list or table color. */
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

export function ArrayChip({ value, label, size = "md", accent, pinNodeId, elem, popupOverrides, twoD }: {
  value: ArrayValue;
  label?: string;
  size?: "sm" | "md";
  /** Pass it when the chip itself is recolored, so the popup still gets a type accent. */
  accent?: string;
  /** The node the popup's Pin action targets; defaults to the host node from context. */
  pinNodeId?: string;
  /** Required, so a host can't fall back to cell-guessing; `undefined` is an unresolved wildcard, the one case cells are sniffed. */
  elem: ElemFamily | undefined;
  /** Merged into the popup open() — Table Input passes raw cells + onSaveRaw ([[C58]] tableInputRawText). */
  popupOverrides?: Partial<TablePopupState>;
  /** For a host whose value may be empty: `[]` can't show whether it is a list or a matrix. */
  twoD?: boolean;
}) {
  // The hook runs every render (Rules of Hooks); the prop wins.
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  const table = twoD ?? is2D(value);
  // A big list a card's box shows is its first rows; the chip counts the whole and the popup opens on it.
  const rows = listLength(value);
  const cols = table ? tableWidth(value) : 1;
  const family = elem ?? elemFamilyOfCells(value);
  const famClass = elemChipClass(value, table, family);

  const chipLabel = table ? `${rows}×${cols} Table` : `${rows}× List`;
  const verb = popupOverrides?.onSaveRaw ? "Edit" : "View";
  const titleText = table ? `${rows}×${cols} table. ${verb}.` : `${rows}-item list. ${verb}.`;

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--array${famClass}${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={titleText}
      onClick={(e) => {
        e.stopPropagation();
        const st = readChipPopupStyle(e.currentTarget, "--sock-list");
        openArrayPopup(fullList(value), {
          label, hostId, elem: family, popupOverrides,
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
