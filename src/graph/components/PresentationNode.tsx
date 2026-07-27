import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PresentationNode as PresentationNodeType } from "../rete-nodes";
import { hexToRgba, themeAccent, resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";
import { SwatchGrid } from "./SwatchGrid";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { getEditor } from "../process";
import { flyToNodes } from "../flyToNode";
import { presentationStore } from "../presentationStore";
import { scheduleAutosave } from "../persistence";
import { nodeDisplayNames } from "../nodeNames";
import type { NodeProps } from "./nodeKit";
import { stopDragStart } from "../coarse";
import "./PresentationNode.css";

const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

/**
 * Presenter mode, kept light (bundle 13 #51): an ordered step list, each step an
 * explicit node-id set captured from the current canvas SELECTION (picked like a
 * navigator list, not typed). Stepping calls flyToNodes — pan/zoom only, no
 * isolate/highlight/dim (those are separate mechanisms this doesn't touch).
 */
export function PresentationComponent({ data }: NodeProps<PresentationNodeType>) {
  const [label, setLabel] = useState(data.label);
  const [color, setColor] = useState(data.color);
  const [editingLabel, setEditingLabel] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // `steps`/`activeIndex` mutate on the node instance directly (like GroupNode's
  // members or Note's fieldTypes) — `bump` forces a re-render after each mutation.
  const [, bump] = useState(0);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(pickerOpen, () => setPickerOpen(false), [swatchRef, paletteRef]);

  useEffect(() => { setLabel(data.label); }, [data.label]);
  useEffect(() => { setColor(data.color); }, [data.color]);

  // Re-resolve the accent on theme/palette change (palette edits funnel through
  // appThemeStore) — without this the card kept its stale hex until some other
  // re-render, so it looked like it ignored the palette.
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);

  function onLabel(v: string) { setLabel(v); data.label = v; scheduleAutosave(); }
  function pick(c: string) { setColor(c); data.color = c; scheduleAutosave(); }
  function refresh() { bump((v) => v + 1); scheduleAutosave(); }

  function addStep() {
    const selected = (getEditor()?.getNodes() ?? []).filter((n) => n.selected && n.id !== data.id);
    const n = data.steps.length + 1;
    data.addStep(`Step ${n}`, selected.map((s) => s.id));
    refresh();
  }
  function removeStep(i: number) { data.removeStep(i); refresh(); }
  function move(i: number, dir: -1 | 1) { data.moveStep(i, dir); refresh(); }
  function rename(i: number, title: string) { data.renameStep(i, title); refresh(); }
  function goTo(i: number) {
    const idx = data.goTo(i);
    const step = data.steps[idx];
    if (step) flyToNodes(step.nodeIds);
    refresh();
  }
  function next() { goTo(data.activeIndex + 1); }
  function prev() { goTo(data.activeIndex - 1); }

  const editor = getEditor();
  const names = editor ? nodeDisplayNames(editor.getNodes()) : new Map<string, string>();
  const mode = appThemeStore.getMode();
  const themed = themeAccent(resolveColor(color), mode);
  const vars = {
    "--pres-color": themed,
    "--pres-bg": hexToRgba(themed, 0.3),
  } as React.CSSProperties;

  return (
    <div className={`solenoid-pres${data.selected ? " solenoid-pres--selected" : ""}`} style={{ width: data.width, ...vars }}>
      <div className="solenoid-pres__bar">
        {editingLabel ? (
          <input
            className="solenoid-pres__name"
            value={label}
            placeholder="Presentation"
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
            className={`solenoid-pres__name-display${label.trim() ? "" : " solenoid-pres__name-display--empty"}`}
            title={label || "Presentation"}
            onClick={() => setEditingLabel(true)}
            onPointerDown={stop}
            onMouseDown={stop}
          >
            {label.trim() || "Presentation"}
          </div>
        )}
        <button
          ref={swatchRef}
          type="button"
          className="solenoid-pres__swatch"
          title="Presentation color"
          onClick={(e) => { e.stopPropagation(); setPickerOpen((o) => !o); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6" cy="6" r="4.5" />
          </svg>
        </button>
        {pickerOpen && (
          <div ref={paletteRef} className="solenoid-pres__palette" onPointerDown={stop} onMouseDown={stop}>
            <SwatchGrid value={color} onPick={pick} />
          </div>
        )}
      </div>

      <div className="solenoid-pres__steps" onPointerDown={stop} onMouseDown={stop}>
        {data.steps.length === 0 ? (
          <div className="solenoid-pres__empty">Select nodes, then Add step</div>
        ) : (
          data.steps.map((step, i) => (
            <div key={i} className={`solenoid-pres__step${i === data.activeIndex ? " solenoid-pres__step--active" : ""}`}>
              <button type="button" className="solenoid-pres__step-go" onClick={() => goTo(i)} title="Fly to this step">
                <input
                  className="solenoid-pres__step-title"
                  value={step.title}
                  onChange={(e) => rename(i, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={stop}
                  onMouseDown={stop}
                  onBlur={() => scheduleAutosave()}
                />
                <span className="solenoid-pres__step-count" title={step.nodeIds.map((id) => names.get(id) ?? "node").join(", ")}>
                  {step.nodeIds.length}
                </span>
              </button>
              <div className="solenoid-pres__step-actions">
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
                <button type="button" disabled={i === data.steps.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
                <button type="button" onClick={() => removeStep(i)} title="Remove step">×</button>
              </div>
            </div>
          ))
        )}
        <button type="button" className="solenoid-pres__add" onClick={addStep} title="Capture the current canvas selection as a new step">
          + Add step
        </button>
      </div>

      <div className="solenoid-pres__footer" onPointerDown={stop} onMouseDown={stop}>
        <button type="button" onClick={prev} disabled={data.steps.length === 0} title="Previous step">‹</button>
        <span className="solenoid-pres__counter">
          {data.steps.length === 0 ? "0 / 0" : `${data.activeIndex + 1} / ${data.steps.length}`}
        </span>
        <button type="button" onClick={next} disabled={data.steps.length === 0} title="Next step">›</button>
        <button
          type="button"
          className="solenoid-pres__present"
          onClick={() => presentationStore.start(data.id)}
          disabled={data.steps.length === 0}
          title="Present full screen. Space or → advances; Esc exits."
        >
          ▶ Present
        </button>
      </div>
    </div>
  );
}
