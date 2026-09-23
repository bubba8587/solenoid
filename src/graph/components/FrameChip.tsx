// [[C16]] polarsEngine (a lazy frame ref, head-N preview)
import { useEffect, useState } from "react";
import { tablePopup, type SourceCommitRefresh, type TablePopupState } from "../tablePopupStore";
import { frameRowCount, isFrameValue, type FrameValue, type FrameSourceColumn } from "../frame";
import { collectPreview, type FrameRef } from "../frameBackend";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import { openFramePopup } from "../valuePopup";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";

export function FrameRefChip({ frameRef, label, size = "sm", accent }: {
  frameRef: FrameRef; label?: string; size?: "sm" | "md"; accent?: string;
}) {
  const [value, setValue] = useState<FrameValue | null>(null);
  useEffect(() => {
    let live = true;
    void collectPreview(frameRef).then((r) => { if (live && isFrameValue(r)) setValue(r); });
    return () => { live = false; };
  }, [frameRef]);
  if (!value) return <span className="array-chip array-chip--placeholder" style={accent ? { color: accent } : undefined}>{label ? `${label}: ` : ""}table…</span>;
  return <FrameChip value={value} label={label} size={size} accent={accent} />;
}

export function FrameChip({ value, label, size = "md", accent, source, onSaveSource, onCommitSource, pinNodeId, lambdaOptions, formLayout, popupOverrides }: {
  value: FrameValue;
  label?: string;
  size?: "sm" | "md";
  accent?: string;
  source?: FrameSourceColumn[];
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  onCommitSource?: (columns: FrameSourceColumn[]) => Promise<SourceCommitRefresh | null>;
  pinNodeId?: string;
  lambdaOptions?: string[];
  formLayout?: string;
  popupOverrides?: Partial<TablePopupState>;
}) {
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  const rows = frameRowCount(value);
  const cols = value.columns.length;
  const totalRows = value.__totalRows ?? rows;
  const approx = value.__approx != null;
  const computedCols = source?.filter((c) => c.expr).length ?? 0;

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--frame${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={`${approx ? "≈ " : ""}${totalRows}×${cols} frame${approx ? ", extrapolated from a sketch-mode sample" : ""}${computedCols ? `, ${computedCols} computed column${computedCols === 1 ? "" : "s"}` : ""}. ${onSaveSource ? "Edit" : "View"}.`}
      onClick={(e) => {
        e.stopPropagation();
        const st = readChipPopupStyle(e.currentTarget, "--sock-frame");
        const isSource = !!source && !!onSaveSource;
        if (!isSource) {
          void openFramePopup(value, {
            label, hostId,
            accent: accent || st.accent, groupColor: st.groupColor, groupColorDark: st.groupColorDark,
          });
          return;
        }
        const rowCount = source.reduce((m, c) => Math.max(m, c.cells.length), 0);
        tablePopup.open({
          title: label || "Frame",
          data: Array.from({ length: rowCount }, (_, r) => source.map((c) => c.cells[r] ?? "")),
          headers: source.map((c) => c.name),
          columnTypes: source.map((c, j) => (c.expr ? (value.columns[j]?.type ?? "number") : c.type)),
          cellType: "number",
          formatControls: "columns",
          columnUnits: value.columns.map((c) => c.unit),
          columnFormats: value.columns.map((c) => c.format),
          unitTaggable: true,
          editableHeaders: true,
          onSaveSource,
          onCommitSource,
          accent: accent || st.accent,
          groupColor: st.groupColor,
          groupColorDark: st.groupColorDark,
          pinNodeId: hostId ?? undefined,
          formLayout,
          lambdaOptions: lambdaOptions ?? [],
          sourceExprs: source.map((c) => c.expr),
          computedCells: Array.from(
            { length: Math.max(rowCount, frameRowCount(value)) },
            (_, r) => source.map((c, j) =>
              c.expr ? (value.columns[j]?.values[r] ?? null) : null),
          ),
          ...popupOverrides,
        });
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{approx ? "≈" : ""}{totalRows}×{cols} Frame{computedCols ? " ƒ" : ""}]
    </button>
  );
}
