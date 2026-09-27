// [[C68]] knapIsTheDocumentSyntax
import { type FrameValue, type CubeValue, type CubeCell, type FrameColType, isFrameValue, isCubeValue, frameRowCount } from "./frame";
import { isDocumentValue } from "./documentValue";
import { isMermaidValue } from "./mermaidValue";
import { isLambdaValue } from "./lambdaValue";
import { isUnitCell } from "./unitValue";
import { displayMagnitudeOf } from "./unitBridge";
import { isSolError } from "./errorValue";
import { formatDateSerial } from "./nodes/dateSerial";
import { mermaidToMarkdown, lambdaToMarkdown } from "./obsidianMarkdown";
import { isDateType, type SocketDataType } from "./sockets";

function serialToIso(serial: number): string {
  const whole = Number.isInteger(serial);
  return formatDateSerial(serial, whole ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
}

function cellValue(v: unknown, type?: FrameColType): unknown {
  if (isSolError(v)) return v.code;
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) return serialToIso(v);
  return v ?? null;
}

export function frameToTemplateRows(f: FrameValue): Record<string, unknown>[] {
  const n = frameRowCount(f);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const c of f.columns) r[c.name] = cellValue(c.values[i], c.type);
    rows.push(r);
  }
  return rows;
}

function cubeCell(cell: CubeCell, type?: FrameColType): unknown {
  if (cell == null) return null;
  if (isCubeValue(cell)) return cubeToTemplateRows(cell);
  if (isFrameValue(cell)) return frameToTemplateRows(cell);
  if (isUnitCell(cell)) return displayMagnitudeOf(cell);
  if (Array.isArray(cell)) return cell.map((c) => cubeCell(c));
  return cellValue(cell, type);
}

export function cubeToTemplateRows(c: CubeValue): Record<string, unknown>[] {
  const n = c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const col of c.columns) r[col.name] = cubeCell(col.cells[i] ?? null, col.type);
    rows.push(r);
  }
  return rows;
}

export function toTemplateValue(v: unknown, type?: SocketDataType | null): unknown {
  if (v === undefined || v === null) return null;
  if (isSolError(v)) return v.code;
  if (isFrameValue(v)) return frameToTemplateRows(v);
  if (isCubeValue(v)) return cubeToTemplateRows(v);
  if (isDocumentValue(v)) return v.body;
  if (isMermaidValue(v)) return mermaidToMarkdown(v);
  if (isLambdaValue(v)) return lambdaToMarkdown(v);
  if (isUnitCell(v)) return displayMagnitudeOf(v);
  if (Array.isArray(v)) {
    const date = !!type && isDateType(type);
    return v.map((x) => toTemplateValue(x, date ? "date" : null));
  }
  if (typeof v === "number") return type && isDateType(type) && Number.isFinite(v) ? serialToIso(v) : v;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object" && ("__chart" in v || "__svg" in v || "__image" in v)) return null;
  return v;
}
