import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReportNode as ReportNodeType } from "../rete-nodes";
import { hexToRgba, themeAccent, resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";
import { SwatchGrid } from "./SwatchGrid";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { reportStore } from "../reportStore";
import { scheduleAutosave } from "../persistence";
import { RefInputRow } from "./inlineRefDisplay";
import { NodeSocket } from "./NodeSocket";
import type { NodeProps } from "./nodeKit";
import { stopDragStart } from "../coarse";
import "./ReportNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

/**
 * The Report's canvas presence — a small, fixed-size anchor card, deliberately NOT
 * a full editing surface (per the plan: "separate from the graph's node set"). It
 * exists so the report's `` `=name` `` refs have a real place for their wireable
 * INPUT sockets to live (same NodeSocket/RefInputRow machinery as a Note); the
 * actual markdown editing happens in the full-screen ReportOverlay, opened here.
 */
export function ReportComponent({ data, emit }: NodeProps<ReportNodeType>) {
  const [label, setLabel] = useState(data.label);
  const [color, setColor] = useState(data.color);
  const [editingLabel, setEditingLabel] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(pickerOpen, () => setPickerOpen(false), [swatchRef, paletteRef]);

  useEffect(() => { setLabel(data.label); }, [data.label]);
  useEffect(() => { setColor(data.color); }, [data.color]);

  function onLabel(v: string) { setLabel(v); data.label = v; scheduleAutosave(); }
  function pick(c: string) { setColor(c); data.color = c; scheduleAutosave(); }

  // Re-render on theme/palette change — the tint below resolves through the
  // ACTIVE palette (appThemeStore bumps on a palette switch too, same as NoteNode).
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const refKeys = data.refKeys();
  const mode = appThemeStore.getMode();
  const themed = themeAccent(resolveColor(color), mode);
  const vars = {
    "--report-color": themed,
    "--report-bg": hexToRgba(themed, 0.3),
  } as React.CSSProperties;

  return (
    <div className={`solenoid-report${data.selected ? " solenoid-report--selected" : ""}`} style={{ width: data.width, ...vars }}>
      <div className="solenoid-report__bar" title="Drag to move">
        {editingLabel ? (
          <input
            className="solenoid-report__name"
            value={label}
            placeholder="Report"
            spellCheck={false}
            autoFocus
            onChange={(e) => onLabel(e.target.value)}
            onBlur={() => setEditingLabel(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
            onPointerDown={stop}
            onMouseDown={stop}
          />
        ) : (
          <div
            className={`solenoid-report__name-display${label.trim() ? "" : " solenoid-report__name-display--empty"}`}
            title={label || "Report"}
            onClick={() => setEditingLabel(true)}
            onPointerDown={stop}
            onMouseDown={stop}
          >
            {label.trim() || "Report"}
          </div>
        )}
        <button
          ref={swatchRef}
          type="button"
          className="solenoid-report__swatch"
          title="Report color"
          onClick={(e) => { e.stopPropagation(); setPickerOpen((o) => !o); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6" cy="6" r="4.5" />
          </svg>
        </button>
        {pickerOpen && (
          <div ref={paletteRef} className="solenoid-report__palette" onPointerDown={stop} onMouseDown={stop}>
            <SwatchGrid value={color} onPick={pick} />
          </div>
        )}
      </div>
      {refKeys.length > 0 && (
        <div className="solenoid-report__refs">
          {refKeys.map((key) => {
            const input = data.inputs[key];
            if (!input) return null;
            return (
              <RefInputRow
                key={key}
                nodeId={data.id}
                emit={emit}
                refKey={key}
                value={data.refValue(key)}
                socket={input.socket}
                rowClassName="solenoid-report__ref-row"
                keyClassName="solenoid-report__ref-key"
                valClassName="solenoid-report__ref-val"
              />
            );
          })}
        </div>
      )}
      <div className="solenoid-report__content" style={{ position: "relative" }}>
        <button
          type="button"
          className="solenoid-report__open"
          onClick={(e) => { e.stopPropagation(); reportStore.open(data.id); }}
          onPointerDown={stop}
          onMouseDown={stop}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h5l1.5 2H14v8H2z" />
          </svg>
          Open report
        </button>
        {data.embeds.length > 0 && (
          <span className="solenoid-report__embed-count" title={`${data.embeds.length} embedded note${data.embeds.length === 1 ? "" : "s"}`}>
            {data.embeds.length} embed{data.embeds.length === 1 ? "" : "s"}
          </span>
        )}
        {/* The `document` OUTPUT — wire the whole report into a document sink (Write
            to Obsidian). Hosted in the content row so it lines up with "Open report";
            the row is the positioning context (its 50% centers the dot on the button). */}
        {data.outputs.document && (
          <NodeSocket side="output" socketKey="document" nodeId={data.id} emit={emit} payload={data.outputs.document.socket} />
        )}
      </div>
    </div>
  );
}
