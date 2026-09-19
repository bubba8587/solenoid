import { useRef } from "react";
import { CalendarIcon } from "./CalendarIcon";

/** The Form view's date picker / checkbox, on the right edge of the ONE grid cell being
 *  edited (never on every cell of the column). The cell's text input keeps focus: a
 *  press here must not blur it, or the edit would commit and unmount this control
 *  before the click lands. A pick writes the cell's raw text, like typing it. */
export function CellEditAffix({ type, iso, checked, onPick }: {
  type: "date" | "logical";
  /** date: the cell as an ISO day ("" when blank or unparseable). */
  iso?: string;
  /** logical: true / false, or null for a blank cell (shown indeterminate). */
  checked?: boolean | null;
  onPick: (raw: string) => void;
}) {
  const nativeRef = useRef<HTMLInputElement>(null);
  const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault();

  if (type === "logical") {
    return (
      <span className="table-popup__affix" onMouseDown={keepFocus}>
        <input
          type="checkbox"
          className="table-popup__form-box-check"
          tabIndex={-1}
          checked={checked === true}
          ref={(el) => { if (el) el.indeterminate = checked == null; }}
          onChange={(e) => onPick(e.target.checked ? "TRUE" : "FALSE")}
        />
      </span>
    );
  }
  return (
    <span className="table-popup__affix" onMouseDown={keepFocus}>
      <button
        type="button"
        className="table-popup__affix-btn"
        title="Pick a date"
        aria-label="Open the calendar"
        tabIndex={-1}
        onClick={() => {
          const el = nativeRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
          if (!el) return;
          try { el.showPicker?.(); } catch { /* no picker on this platform: the cell still types */ }
        }}
      >
        <CalendarIcon />
      </button>
      {/* The native picker's anchor: invisible, never focusable. Clearing it writes a
          blank cell (missing), never a fabricated date. */}
      <input
        ref={nativeRef}
        type="date"
        className="table-popup__affix-native"
        value={iso ?? ""}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onPick(e.target.value)}
      />
    </span>
  );
}
