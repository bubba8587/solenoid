// [[D41]] formatFlowsDownstream, [[E9]] errorsKeepOrigin
import { useSyncExternalStore } from "react";
import { FrameChip } from "./FrameChip";
import { CategoryChip } from "./CategoryChip";
import { categoryColorIndex } from "../categoryColor";
import { frameRowCount, formatFrameCell, type FrameCell, type FrameColType, type FrameValue, type FrameSourceColumn } from "../frame";
import type { FramePopupColumn, SourceCommitRefresh } from "../tablePopupStore";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { useHostNodeId } from "./nodeContext";
import { frameFormatStore } from "../frameFormatStore";
import { formatNumberWithAnnotation, applyLogicalStyle, applyTextCase, isDateStyle, type FormatAnnotation } from "../formatAnnotationStore";

function isNanCell(v: FrameCell): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

export function fmtCell(v: FrameCell, type: FrameColType = "number", ann?: FormatAnnotation): string {
  if (ann) {
    if (type === "logical" && typeof v === "boolean") return applyLogicalStyle(v, ann.logicalStyle);
    if (typeof v === "number" && Number.isFinite(v) && (type === "date") === isDateStyle(ann.format)) {
      return formatNumberWithAnnotation(v, { ...ann, unit: "none" });
    }
  }
  const c = formatFrameCell(type, v);
  if (c === null || c === undefined || c === "") return "";
  if (typeof c === "string") return type === "string" ? applyTextCase(c, ann?.textCase) : c;
  if (Number.isNaN(c)) return "NaN";
  if (!Number.isFinite(c)) return c > 0 ? "∞" : "-∞";
  return Number.isInteger(c) ? String(c) : c.toFixed(3).replace(/\.?0+$/, "");
}

export function FrameDisplay({ frame, label, onSave, source, onSaveSource, onCommitSource, full, previewRows, previewCols, scroll, formatNodeId, lambdaOptions, formLayout, peek }: {
  frame: FrameValue | SolError | null;
  label?: string;
  peek?: boolean;
  formatNodeId?: string;
  onSave?: (columns: FramePopupColumn[]) => void;
  source?: FrameSourceColumn[];
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  onCommitSource?: (columns: FrameSourceColumn[]) => Promise<SourceCommitRefresh | null>;
  full?: boolean;
  previewRows?: number;
  previewCols?: number;
  scroll?: boolean;
  lambdaOptions?: string[];
  formLayout?: string;
}) {
  const ctxNodeId = useHostNodeId();
  const hostNodeId = formatNodeId ?? ctxNodeId;
  useSyncExternalStore(frameFormatStore.subscribe, frameFormatStore.version);
  const annFor = (col: { name: string; format?: FormatAnnotation }): FormatAnnotation | undefined =>
    (hostNodeId ? frameFormatStore.get(hostNodeId, col.name) : undefined) ?? col.format;

  if (isSolError(frame)) {
    return (
      <div
        className={`solenoid-node__display-value solenoid-node__display-value--error${frame.origin ? " sol-error-chip--clickable" : ""}`}
        title={errorTip(frame)}
        onClick={frame.origin ? () => flyToNode(frame.origin!.nodeId) : undefined}
        onPointerDown={frame.origin ? (e) => e.stopPropagation() : undefined}
        onMouseDown={frame.origin ? (e) => e.stopPropagation() : undefined}
      >
        {frame.code}
      </div>
    );
  }
  if (!frame || frame.columns.length === 0) {
    if (onSave || source || onSaveSource || onCommitSource) {
      const stub: FrameValue = frame ?? { __frame: true, columns: [] };
      return (
        <div className="solenoid-node__display-value solenoid-table-display" style={{ padding: "4px 8px", userSelect: "text" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>empty</div>
          <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
            <FrameChip value={stub} label={label} size="sm" onSave={onSave} source={source} onSaveSource={onSaveSource} onCommitSource={onCommitSource} lambdaOptions={lambdaOptions} formLayout={formLayout} />
          </div>
        </div>
      );
    }
    return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  }
  const rows = frameRowCount(frame);
  const maxR = full ? Math.min(rows, 100) : Math.min(rows, previewRows ?? 3);
  const maxC = full ? frame.columns.length : Math.min(frame.columns.length, previewCols ?? 3);
  const extraCols = !full && frame.columns.length > maxC;
  const chipCols = new Map<number, Map<string, number>>();
  frame.columns.forEach((c, j) => {
    if (c.type === "string" && annFor(c)?.chip) chipCols.set(j, categoryColorIndex(c.values as (string | null)[]));
  });

  return (
    <div
      className="solenoid-node__display-value solenoid-table-display"
      style={{ padding: "4px 8px", userSelect: "text", ...(scroll ? { overflowX: "auto" } : null) }}
    >
      <table className="solenoid-table-display__grid" style={{ borderCollapse: "collapse", width: "100%", tableLayout: full ? "auto" : "fixed" }}>
        <thead>
          <tr>
            {frame.columns.slice(0, maxC).map((c, j) => (
              <th key={j} title={c.name} style={{ padding: full ? "2px 8px" : "1px 4px", textAlign: "left", fontSize: full ? 13 : 11, fontWeight: 600, color: "var(--node-accent, var(--text-dim))", borderRight: "1px solid var(--border)", whiteSpace: "nowrap", ...(full ? {} : { overflow: "hidden", textOverflow: "ellipsis" }) }}>
                {c.name}
              </th>
            ))}
            {extraCols && <th style={{ fontSize: 10, color: "var(--text-muted)", width: 14 }}>…</th>}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxR }, (_, i) => (
            <tr key={i}>
              {frame.columns.slice(0, maxC).map((c, j) => {
                const cell = c.values[i] ?? null;
                const nan = isNanCell(cell);
                return (
                <td key={j} className={nan ? "solenoid-nan-cell" : undefined} title={nan ? "Not a number: an undefined value in the data" : undefined} style={{ padding: full ? "2px 8px" : "1px 4px", textAlign: c.type === "string" ? "left" : "right", fontSize: full ? 13 : 12, fontFamily: "var(--font-mono)", color: "var(--text)", borderRight: "1px solid var(--border)", whiteSpace: full ? "nowrap" : undefined, ...(full ? {} : { overflow: "hidden", textOverflow: "ellipsis" }) }}>
                  {cell !== null && chipCols.has(j)
                    ? <CategoryChip value={String(cell)} index={chipCols.get(j)!.get(String(cell)) ?? 0} />
                    : fmtCell(cell, c.type, annFor(c))}
                </td>
                );
              })}
              {extraCols && <td style={{ color: "var(--text-muted)", fontSize: 10 }}>…</td>}
            </tr>
          ))}
          {rows > maxR && (
            <tr>
              <td colSpan={maxC + (extraCols ? 1 : 0)} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>…</td>
            </tr>
          )}
        </tbody>
      </table>
      {!full && !peek && (
        <div className="solenoid-table-display__chip" style={{ display: "flex", justifyContent: "flex-end", marginTop: 3 }}>
          <FrameChip value={frame} label={label} size="sm" onSave={onSave} source={source} onSaveSource={onSaveSource} onCommitSource={onCommitSource} lambdaOptions={lambdaOptions} formLayout={formLayout} />
        </div>
      )}
    </div>
  );
}
