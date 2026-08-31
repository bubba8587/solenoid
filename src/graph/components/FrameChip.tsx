import { useEffect, useState } from "react";
import { tablePopup, type FramePopupColumn, type SourceCommitRefresh } from "../tablePopupStore";
import { frameRowCount, frameToGrid, isFrameValue, type FrameValue, type FrameSourceColumn } from "../frame";
import { collectPreview, readFrame, type FrameRef } from "../frameBackend";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";

/** Collects a LAZY frame ref on mount and renders the resulting FrameChip; a dropped
 *  handle (a stale preview after a recompute) shows the placeholder. */
export function FrameRefChip({ frameRef, label, size = "sm", accent }: {
  frameRef: FrameRef; label?: string; size?: "sm" | "md"; accent?: string;
}) {
  const [value, setValue] = useState<FrameValue | null>(null);
  useEffect(() => {
    // Head-N preview, not a full collect — hovering a million-row output stays cheap.
    let live = true;
    void collectPreview(frameRef).then((r) => { if (live && isFrameValue(r)) setValue(r); });
    return () => { live = false; };
  }, [frameRef]);
  if (!value) return <span className="array-chip array-chip--placeholder" style={accent ? { color: accent } : undefined}>{label ? `${label}: ` : ""}table…</span>;
  return <FrameChip value={value} label={label} size={size} accent={accent} />;
}

/** A clickable `[R×C Frame]` chip opening the full grid in the popup; read-only
 *  unless `onSave` is given, but column types are passed either way. */
export function FrameChip({ value, label, size = "md", accent, onSave, source, onSaveSource, onCommitSource, pinNodeId, lambdaOptions, formLayout }: {
  value: FrameValue;
  label?: string;
  size?: "sm" | "md";
  /** Accent for the popup header; defaults to the host's sniffed `--node-accent`. */
  accent?: string;
  /** When set, the popup opens editable; Save returns the edited typed columns. */
  onSave?: (columns: FramePopupColumn[]) => void;
  /** Literal-source editing: seeds from and saves the RAW typed text, and takes
   *  precedence over `value` for the popup. */
  source?: FrameSourceColumn[];
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  /** LIVE write-through for the column-source model — see tablePopupStore. */
  onCommitSource?: (columns: FrameSourceColumn[]) => Promise<SourceCommitRefresh | null>;
  /** The node the popup's Pin action pins; defaults to the host node from context. */
  pinNodeId?: string;
  /** The host's λ input keys — enables the popup's per-column source select. */
  lambdaOptions?: string[];
  /** Form-view field placement (the Record layout text, authored on the card). */
  formLayout?: string;
}) {
  // Hook runs every render (Rules of Hooks); the explicit prop wins when given.
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  const rows = frameRowCount(value);
  const cols = value.columns.length;
  // A head-N preview carries the true count in `__totalRows`.
  const totalRows = value.__totalRows ?? rows;
  // A sketch-mode aggregate carries `__approx` — never show it as an exact total.
  const approx = value.__approx != null;
  // Computed columns mark the chip with a quiet ƒ: part of this table is DEFINED.
  const computedCols = source?.filter((c) => c.lambda || c.expr).length ?? 0;

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--frame${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={`${approx ? "≈ " : ""}${totalRows}×${cols} frame${approx ? ", extrapolated from a sketch-mode sample" : ""}${computedCols ? `, ${computedCols} computed column${computedCols === 1 ? "" : "s"}` : ""}. ${onSave || onSaveSource ? "Edit" : "View"}.`}
      onClick={async (e) => {
        e.stopPropagation();
        const st = readChipPopupStyle(e.currentTarget, "--sock-frame");
        // Seed from the RAW typed cells so editing never canonicalises "1" → "TRUE".
        const isSource = !!source && !!onSaveSource;
        const rowCount = isSource ? source!.reduce((m, c) => Math.max(m, c.cells.length), 0) : 0;
        // Fetch the FULL frame through the carried handle, or Copy CSV silently
        // exports the truncated preview; a dropped handle falls back to it.
        let full = value;
        if (!isSource && value.__totalRows != null && value.__ref) {
          const collected = await readFrame(value.__ref as FrameRef);
          if (isFrameValue(collected)) full = collected;
        }
        tablePopup.open({
          title: label || "Frame",
          data: isSource
            ? Array.from({ length: rowCount }, (_, r) => source!.map((c) => c.cells[r] ?? ""))
            : frameToGrid(full),
          headers: (isSource ? source! : full.columns).map((c) => c.name),
          // A COMPUTED column's type is the DERIVED one, so the format row offers the
          // selector family matching what the cells actually are.
          columnTypes: isSource
            ? source!.map((c, j) => ((c.lambda || c.expr) ? (value.columns[j]?.type ?? "number") : c.type))
            : full.columns.map((c) => c.type),
          // Read-only frame: the Source view shows the INPUTTED text, not the value.
          sourceCells: isSource || !full.columns.some((c) => c.raw)
            ? undefined
            : Array.from({ length: frameRowCount(full) }, (_, r) => full.columns.map((c) => c.raw?.[r] ?? null)),
          cellType: "number",
          // A unit-taggable source gets the unit dropdown (persisted on Save); a derived
          // frame gets the display-only format dropdown.
          formatControls: "columns",
          columnUnits: full.columns.map((c) => c.unit),
          unitTaggable: isSource,
          editableHeaders: isSource || !!onSave,
          literalSource: isSource,
          onSaveSource: isSource ? onSaveSource : undefined,
          onCommitSource: isSource ? onCommitSource : undefined,
          onSaveFrame: isSource ? undefined : onSave,
          accent: accent || st.accent,
          groupColor: st.groupColor,
          groupColorDark: st.groupColorDark,
          pinNodeId: hostId ?? undefined,
          // Computed columns have no raw cells, so their derived VALUES ride along;
          // always passed for a literal source, so the source select exists pre-λ.
          ...(isSource ? {
            formLayout,
            lambdaOptions: lambdaOptions ?? [],
            sourceLambdas: source!.map((c) => c.lambda),
            sourceExprs: source!.map((c) => c.expr),
            computedCells: Array.from(
              { length: Math.max(rowCount, frameRowCount(value)) },
              (_, r) => source!.map((c, j) =>
                (c.lambda || c.expr) ? (value.columns[j]?.values[r] ?? null) : null),
            ),
          } : {}),
        });
      }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{approx ? "≈" : ""}{totalRows}×{cols} Frame{computedCols ? " ƒ" : ""}]
    </button>
  );
}
