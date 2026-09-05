// The armed draw tool's capture sheet: a screen-space overlay over the whole pane, so
// while the tool is armed a click PLACES A POINT instead of panning the canvas or
// starting a lasso. Unmounted entirely when disarmed, so nothing intercepts anything
// the rest of the time.
//
// Points land in canvas coordinates (`toFlow`); the half-drawn run is previewed by
// DrawnCableLayer, which lives inside the viewport transform.
import { useSyncExternalStore } from "react";
import { drawModeStore } from "../drawnCables";
import { scheduleAutosave } from "../persistence";
import "./drawnCableLayer.css";

export function DrawnCableCapture({
  toFlow,
}: {
  toFlow: (screen: { x: number; y: number }) => { x: number; y: number };
}) {
  useSyncExternalStore(drawModeStore.subscribe, drawModeStore.version);
  if (!drawModeStore.armed()) return null;

  const placed = drawModeStore.pending().length;

  const finish = () => {
    if (drawModeStore.finish()) scheduleAutosave();
  };

  return (
    <>
      <div
        className="solenoid-drawn-capture"
        onPointerMove={(e) => drawModeStore.moveCursor(toFlow({ x: e.clientX, y: e.clientY }))}
        onPointerLeave={() => drawModeStore.moveCursor(null)}
        // Swallowed so the press never reaches the pane underneath (no pan, no lasso).
        // Right-click ends the run — it raises no `click`, so it is handled here.
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button === 2) finish();
        }}
        // Placing happens on CLICK, not pointerdown: a PointerEvent's `detail` is
        // always 0 (spec), so the double-click that ends a run is only legible here —
        // the same reason the cable edge detects its own double-click in onClick.
        // Click 1 of the double places the last point, click 2 ends the run.
        onClick={(e) => {
          e.stopPropagation();
          if (e.detail >= 2) { finish(); return; }
          drawModeStore.place(toFlow({ x: e.clientX, y: e.clientY }));
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* State plus the two keys that end it. The placing gesture is left unnarrated
          (DESIGN.md § 7); finishing a run is not a conventional affordance, so it is
          named as a key + verb rather than as "double-click to…". */}
      <div className="solenoid-drawn-hint">
        <span className="solenoid-drawn-hint__state">
          {placed === 0 ? "Drawing" : placed === 1 ? "1 point" : `${placed} points`}
        </span>
        <span className="solenoid-drawn-hint__key">Enter</span>
        Finish
        <span className="solenoid-drawn-hint__key">Esc</span>
        Cancel
      </div>
    </>
  );
}
