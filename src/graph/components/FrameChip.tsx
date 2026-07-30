import { useEffect, useState } from "react";
import { tablePopup, type FramePopupColumn, type SourceCommitRefresh } from "../tablePopupStore";
import { frameRowCount, frameToGrid, isFrameValue, type FrameValue, type FrameSourceColumn } from "../frame";
import { collectPreview, readFrame, type FrameRef } from "../frameBackend";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import "./ArrayChip.css";
import { stopDragStart } from "../coarse";

/**
 * A frame on a cable can be a LAZY ref (a verb output — see frameBackend), which the
 * card never sees (cachedResult is collected) but the cable inspector / pins do. This
 * collects the ref on mount and renders the resulting FrameChip; a dropped/unknown
 * handle (e.g. after a recompute) just shows the placeholder. The collect is instant
 * on the web backend, an IPC round-trip on desktop.
 */
export function FrameRefChip({ frameRef, label, size = "sm", accent }: {
  frameRef: FrameRef; label?: string; size?: "sm" | "md"; accent?: string;
}) {
  const [value, setValue] = useState<FrameValue | null>(null);
  useEffect(() => {
    // Head-N preview, not a full collect: the chip only needs the count + a preview,
    // so hovering a cable over a million-row verb output stays cheap.
    let live = true;
    void collectPreview(frameRef).then((r) => { if (live && isFrameValue(r)) setValue(r); });
    return () => { live = false; };
  }, [frameRef]);
  if (!value) return <span className="array-chip array-chip--placeholder" style={accent ? { color: accent } : undefined}>{label ? `${label}: ` : ""}table…</span>;
  return <FrameChip value={value} label={label} size={size} accent={accent} />;
}

/**
 * A clickable chip for a Frame value — `[R×C Frame]` — that opens the full grid
 * in the popup with its column names as the header row. Mirrors ArrayChip (same
 * styling, accent + group-color inheritance) so frames read like every other
 * array value in the app. Read-only by default; editable (cells, column names,
 * per-column number/text type) when `onSave` is given — the Frame Input node's
 * chip is its editor. Column types are passed either way so a frame with a text
 * column renders correctly even read-only.
 */
export function FrameChip({ value, label, size = "md", accent, onSave, source, onSaveSource, onCommitSource, pinNodeId, lambdaOptions }: {
  value: FrameValue;
  label?: string;
  size?: "sm" | "md";
  /** Accent for the opened popup header; defaults to the host's sniffed
   *  `--node-accent`. Pass it when the chip is recolored (neutral pin chips). */
  accent?: string;
  /** When set, the popup opens editable; Save returns the edited typed columns. */
  onSave?: (columns: FramePopupColumn[]) => void;
  /** Literal-source editing (Frame Input): the editor seeds from and saves the RAW
   *  text the user typed, deriving the typed value only downstream. When given (with
   *  `onSaveSource`) it takes precedence over the typed `value` for the popup. */
  source?: FrameSourceColumn[];
  onSaveSource?: (columns: FrameSourceColumn[]) => void;
  /** LIVE write-through for the column-source model — see tablePopupStore. */
  onCommitSource?: (columns: FrameSourceColumn[]) => Promise<SourceCommitRefresh | null>;
  /** The node whose value the popup's Pin action pins (see ArrayChip). Defaults to
   *  the host node from context; a collapsed-group readout passes its member id. */
  pinNodeId?: string;
  /** The host's λ input keys (Frame Input) — enables the popup's per-column
   *  source select (the column-source model, slice 1). */
  lambdaOptions?: string[];
}) {
  // Hook runs every render (Rules of Hooks); the explicit prop wins when given.
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  const rows = frameRowCount(value);
  const cols = value.columns.length;
  // A large frame shows here as a head-N preview, but `__totalRows` carries the true
  // count so the chip reads the real size (the grid still iterates the rows it has).
  const totalRows = value.__totalRows ?? rows;
  // Sketch mode (#24): an aggregate scaled up from a sample carries `__approx` —
  // never show it as if it were an exact total.
  const approx = value.__approx != null;
  // Computed columns (λ / Formula source) mark the chip with a quiet ƒ — the
  // at-a-glance signal that part of this table is DEFINED, not typed (C2,
  // v2.0/19-computed-column-surface.md).
  const computedCols = source?.filter((c) => c.lambda || c.expr).length ?? 0;

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--frame${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={`${approx ? "≈ " : ""}${totalRows}×${cols} frame${approx ? ", extrapolated from a sketch-mode sample" : ""}${computedCols ? `, ${computedCols} computed column${computedCols === 1 ? "" : "s"}` : ""}. ${onSave || onSaveSource ? "Edit" : "View"}.`}
      onClick={async (e) => {
        e.stopPropagation();
        // Header accent: an explicit prop, else the inherited node/group style
        // (frame TYPE violet when there's no node context).
        const st = readChipPopupStyle(e.currentTarget, "--sock-frame");
        // Literal-source editor (Frame Input): seed from the RAW cells the user typed,
        // not the derived value, so editing never canonicalises "1" → "TRUE".
        const isSource = !!source && !!onSaveSource;
        const rowCount = isSource ? source!.reduce((m, c) => Math.max(m, c.cells.length), 0) : 0;
        // A truncated verb preview must not masquerade as the table in the popup —
        // Copy CSV would silently export 100 of 50,000 rows (audit 22p). Fetch the
        // FULL frame through the carried handle; the popup DOM stays capped (it
        // renders at most MAX_VISIBLE_ROWS) but Copy/CSV get every row. A dropped
        // handle (stale preview after a recompute) falls back to the preview.
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
          // The popup's type switcher covers all four kinds (number/text/date/logical),
          // so pass each column's real type — a logical column edits as TRUE/FALSE text.
          // A COMPUTED column's type is the DERIVED one (inference/λ result), so the
          // format row shows the right selector family for what the cells actually are.
          columnTypes: isSource
            ? source!.map((c, j) => ((c.lambda || c.expr) ? (value.columns[j]?.type ?? "number") : c.type))
            : full.columns.map((c) => c.type),
          // Read-only frame: pass the INPUTTED source text (row-major) so the Source
          // view shows what came in (a date string, "1"/"true") rather than the
          // underlying value. The literal-source editor seeds raw from `data` instead.
          sourceCells: isSource || !full.columns.some((c) => c.raw)
            ? undefined
            : Array.from({ length: frameRowCount(full) }, (_, r) => full.columns.map((c) => c.raw?.[r] ?? null)),
          cellType: "number",
          // A per-column controls row. A UNIT-TAGGABLE source (Frame Input, literal
          // source) shows the unit dropdown, persisted on Save; a read-only derived
          // frame shows the display-only format dropdown. Seeded from the current
          // column units (the derived frame carries them either way).
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
          // The column-source model: the host's λ keys, each column's current
          // binding (λ or inline formula), and the COMPUTED columns' derived
          // cell VALUES (they have no raw cells — the popup renders these
          // read-only, through the SAME format+unit controls as literal
          // columns). Always passed for a literal source, so the source
          // select (Data | Formula | λ…) is there even before any λ socket.
          ...(isSource ? {
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
