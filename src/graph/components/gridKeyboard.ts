// [[C43]] oneFlowSurface (.nokeys: the grid owns its keys), [[C54]] noPerCellFormulas (computed cells are skipped)
// `vi` is the visual row (an index into the sorted visibleOrder), never the source row; `skip(vi, c)` marks a cell Tab hops over.

export type GridKey =
  | "Enter" | "ShiftEnter"
  | "Tab" | "ShiftTab"
  | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"
  | "Home" | "End";

/** Null lets the browser have the key; Ctrl, Meta and Alt are not ours, and Shift only picks the Enter or Tab variant. */
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

/** Null falls through to the browser's Tab (off the last cell, Shift+Tab off the first); Enter, arrows, Home and End clamp at the edges, and Tab wraps rows and skips `skip()` cells. */
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
