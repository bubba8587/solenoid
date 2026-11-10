// [[C58]] tableInputRawText: Edit Frame's popup (`tree/specs/computation/edit-frame.md` § The popup)
import { tablePopup } from "../tablePopupStore";
import { frameRowCount, isFrameValue } from "../frame";
import { isSolError } from "../errorValue";
import { isUnitCell } from "../unitValue";
import { formatScalar } from "./format";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/dateSerial";
import { readChipPopupStyle } from "./chipStyle";
import { nodeDisplayName } from "../catalogUtils";
import { processGraph } from "../process";
import type { EditFrameNode, CellEdit } from "../nodes/frame";

/** A cell as the grid shows it to edit: a date as its date, a logical as TRUE or FALSE, a blank as empty text. */
function cellText(v: unknown, type: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isSolError(v)) return v.code;
  if (typeof v === "number") {
    if (type === "date" && Number.isFinite(v)) return formatDateSerial(v, DEFAULT_DATE_FORMAT);
    return type === "string" ? String(v) : formatScalar(v);
  }
  if (isUnitCell(v)) return formatScalar(v.value);
  return String(v);
}

/** The changes a save holds: every cell whose text differs from what the grid opened with. */
export function changedCells(seed: string[][], saved: string[][], rowKeys: readonly string[], headers: readonly string[]): CellEdit[] {
  const out: CellEdit[] = [];
  for (let r = 0; r < seed.length; r++) {
    const row = rowKeys[r];
    if (row === undefined) continue;
    for (let c = 0; c < headers.length; c++) {
      const was = seed[r]?.[c] ?? "";
      const now = saved[r]?.[c] ?? "";
      if (now !== was) out.push({ row, column: headers[c]!, value: now });
    }
  }
  return out;
}

/** Opens the card's table, its edits applied, for typing into; Save keeps each changed cell as an edit. */
export function openEditFramePopup(node: EditFrameNode, el: HTMLElement): void {
  const f = node.cachedResult;
  if (!isFrameValue(f)) return;
  const rows = frameRowCount(f);
  const headers = f.columns.map((c) => c.name);
  const seed = Array.from({ length: rows }, (_, r) => f.columns.map((c) => cellText(c.values[r], c.type)));
  const rowKeys = [...node.rowKeys];
  const st = readChipPopupStyle(el, "--sock-frame");
  tablePopup.open({
    title: nodeDisplayName(node),
    data: seed.map((row) => [...row]),
    headers,
    columnTypes: f.columns.map((c) => c.type),
    cellType: "number",
    columnUnits: f.columns.map((c) => c.unit),
    columnFormats: f.columns.map((c) => c.format),
    fixedCols: true,
    fixedRows: true,
    onSaveRaw: (cells) => {
      const changes = changedCells(seed, cells, rowKeys, headers);
      if (changes.length === 0) return;
      node.setCellEdits(changes);
      node.edited();
      void processGraph(node.id);
    },
    accent: st.accent,
    groupColor: st.groupColor,
    groupColorDark: st.groupColorDark,
    pinNodeId: node.id,
  });
}
