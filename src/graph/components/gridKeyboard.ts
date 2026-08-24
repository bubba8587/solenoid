// The table popup grid's keyboard MOVEMENT, pure so it can be tested in the node env (the
// component only wires focus). `vi` is the VISUAL row position (index into the sorted
// visibleOrder), never the source row — movement follows what the user sees. Columns are
// plain indices. `skip(vi, c)` marks a cell Tab hops over (computed columns are read-only);
// arrows and Home/End can still land on them.

export type GridKey =
  | "Enter" | "ShiftEnter"
  | "Tab" | "ShiftTab"
  | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
  | "Home" | "End";

/** Classify a keydown into a grid move, or null to let the browser have it. Any modifier
 *  other than Shift (Ctrl/Meta/Alt) is not ours; Shift only picks the Enter/Tab variant. */
export function gridKeyOf(e: {
  key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean;
}): GridKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case "Enter": return e.shiftKey ? "ShiftEnter" : "Enter";
    case "Tab": return e.shiftKey ? "ShiftTab" : "Tab";
    case "ArrowUp": return "ArrowUp";
    case "ArrowDown": return "ArrowDown";
    case "ArrowLeft": return "ArrowLeft";
    case "ArrowRight": return "ArrowRight";
    case "Home": return "Home";
    case "End": return "End";
    default: return null;
  }
}

export type CellPos = { vi: number; c: number };

/** The target cell for a move, or null to fall through to the browser's default (Tab off
 *  the last cell / Shift+Tab off the first). Enter/arrows/Home/End never return null — they
 *  clamp at the edges. Tab wraps across rows and skips `skip()` cells. */
export function nextCell(
  key: GridKey,
  pos: CellPos,
  dims: { rows: number; cols: number },
  skip: (vi: number, c: number) => boolean,
): CellPos | null {
  const { rows, cols } = dims;
  if (rows <= 0 || cols <= 0) return null;
  const { vi, c } = pos;
  switch (key) {
    case "Enter":
    case "ArrowDown": return { vi: Math.min(rows - 1, vi + 1), c };
    case "ShiftEnter":
    case "ArrowUp": return { vi: Math.max(0, vi - 1), c };
    case "ArrowRight": return { vi, c: Math.min(cols - 1, c + 1) };
    case "ArrowLeft": return { vi, c: Math.max(0, c - 1) };
    case "Home": return { vi, c: 0 };
    case "End": return { vi, c: cols - 1 };
    case "Tab":
    case "ShiftTab": {
      const dir = key === "Tab" ? 1 : -1;
      let nvi = vi, nc = c;
      // Step one cell at a time, wrapping to the next/prev row, until a non-skip cell or
      // off either end (null → the browser's default Tab moves focus out of the grid).
      for (;;) {
        nc += dir;
        if (nc >= cols) { nc = 0; nvi += 1; }
        else if (nc < 0) { nc = cols - 1; nvi -= 1; }
        if (nvi < 0 || nvi >= rows) return null;
        if (!skip(nvi, nc)) return { vi: nvi, c: nc };
      }
    }
  }
}
