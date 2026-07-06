import { useEffect, useState } from "react";
import { tablePopup, type FramePopupColumn } from "../tablePopupStore";
import { frameRowCount, frameToGrid, isFrameValue, type FrameValue, type FrameSourceColumn } from "../frame";
import { collectPreview, readFrame, type FrameRef } from "../frameBackend";
import { useHostNodeId } from "./nodeContext";
import "./ArrayChip.css";

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
export function FrameChip({ value, label, size = "md", accent, onSave, source, onSaveSource, pinNodeId }: {
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
  /** The node whose value the popup's Pin action pins (see ArrayChip). Defaults to
   *  the host node from context; a collapsed-group readout passes its member id. */
  pinNodeId?: string;
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

  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--frame${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={`${approx ? "≈ " : ""}${totalRows}×${cols} frame${approx ? " — extrapolated from a sketch-mode sample" : ""} — click to ${onSave ? "edit" : "view"}`}
      onClick={async (e) => {
        e.stopPropagation();
        const cs = getComputedStyle(e.currentTarget);
        // Header accent: an explicit prop, else the host node's accent, else the
        // frame TYPE colour (violet). The last fallback is what themes the popup
        // when a chip is opened somewhere with no node context — e.g. inline in a
        // Report — so it gets the standard coloured header instead of a bare one.
        const popupAccent =
          accent ||
          cs.getPropertyValue("--node-accent").trim() ||
          cs.getPropertyValue("--sock-frame").trim() ||
          undefined;
        const groupColor = cs.getPropertyValue("--group-color").trim();
        const groupColorDark = cs.getPropertyValue("--group-color-dark").trim();
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
          columnTypes: (isSource ? source! : full.columns).map((c) => c.type),
          // Read-only frame: pass the INPUTTED source text (row-major) so the Source
          // view shows what came in (a date string, "1"/"true") rather than the
          // underlying value. The literal-source editor seeds raw from `data` instead.
          sourceCells: isSource || !full.columns.some((c) => c.raw)
            ? undefined
            : Array.from({ length: frameRowCount(full) }, (_, r) => full.columns.map((c) => c.raw?.[r] ?? null)),
          cellType: "number",
          editableHeaders: isSource || !!onSave,
          literalSource: isSource,
          onSaveSource: isSource ? onSaveSource : undefined,
          onSaveFrame: isSource ? undefined : onSave,
          accent: popupAccent,
          groupColor: groupColor || undefined,
          groupColorDark: groupColorDark || undefined,
          pinNodeId: hostId ?? undefined,
        });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      [{approx ? "≈" : ""}{totalRows}×{cols} Frame]
    </button>
  );
}
