// The armed draw tool's capture sheet: a screen-space overlay over the whole pane, so
// while the tool is armed a press places a point instead of starting a lasso. Unmounted
// entirely when disarmed, so nothing intercepts anything the rest of the time.
//
// Points land in canvas coordinates (`toFlow`); the half-drawn run is previewed by
// DrawnCableLayer, which lives inside the viewport transform.
//
// The canvas must stay navigable mid-draw, which the sheet cannot do by getting out of
// the way: it is a SIBLING of the pane, not an ancestor, so declining to stop the event
// hands the drag to nobody. So the sheet owns the gesture itself — a drag pans the
// viewport, and only a TAP (a press that barely moved) places a point, which is the
// "a finger never selects on pointerdown" rule from touch-gestures.md applied to
// placing. Pinch needs nothing here: `flowPinch` listens in CAPTURE on the wrapper, so
// it sees the fingers through the sheet, and its own click guard swallows the click a
// pinch ends on.
import { useRef, useSyncExternalStore } from "react";
import { drawModeStore } from "../drawnCables";
import { isPinching } from "../pointerGesture";
import { IS_COARSE } from "../coarse";
import { scheduleAutosave } from "../persistence";
import "./drawnCableLayer.css";

/** How far a press may travel and still count as a tap. Generous on touch: a finger
 *  never lands still. */
const TAP_SLOP = IS_COARSE ? 12 : 4;

export function DrawnCableCapture({
  toFlow,
  panBy,
}: {
  toFlow: (screen: { x: number; y: number }) => { x: number; y: number };
  /** Move the camera by a SCREEN-space delta (the drag-to-pan the sheet owns). */
  panBy: (dx: number, dy: number) => void;
}) {
  useSyncExternalStore(drawModeStore.subscribe, drawModeStore.version);
  // Where the press started (so the click can tell a tap from a pan) and where it was
  // last seen (so the pan moves by the delta).
  const down = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  if (!drawModeStore.armed()) return null;

  const placed = drawModeStore.pending().length;
  const finish = () => { if (drawModeStore.finish()) scheduleAutosave(); };

  return (
    <>
      <div
        className="solenoid-drawn-capture"
        onPointerMove={(e) => {
          const g = down.current;
          // A second finger means a pinch: `flowPinch` owns that, so stand down.
          if (g && !isPinching()) {
            panBy(e.clientX - g.lastX, e.clientY - g.lastY);
            g.lastX = e.clientX;
            g.lastY = e.clientY;
          }
          drawModeStore.moveCursor(toFlow({ x: e.clientX, y: e.clientY }));
        }}
        onPointerLeave={() => drawModeStore.moveCursor(null)}
        onPointerDown={(e) => {
          if (e.button === 2) { finish(); return; } // right-click ends a run; it raises no click
          if (e.button !== 0) return;
          e.stopPropagation();
          down.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={() => { down.current = null; }}
        // Placing happens on CLICK, not pointerdown: a PointerEvent's `detail` is
        // always 0 (spec), so the double-click that ends a run is only legible here —
        // the same reason the cable edge detects its own double-click in onClick.
        // Click 1 of the double places the last point, click 2 ends the run.
        onClick={(e) => {
          const start = down.current;
          down.current = null;
          // A pan, or a pinch's trailing click: not a placement.
          if (isPinching()) return;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
          e.stopPropagation();
          // Double-click ends the run on a mouse. On touch it does not: double-tap is
          // "nothing, by design" here (touch-gestures.md), so the Finish button below
          // is the one way out.
          if (!IS_COARSE && e.detail >= 2) { finish(); return; }
          drawModeStore.place(toFlow({ x: e.clientX, y: e.clientY }));
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* State plus the way out. On a keyboard that is two named keys; on touch there is
          no keyboard and double-tap is not a gesture here, so the same strip carries
          real buttons. The placing gesture stays unnarrated either way (DESIGN.md § 7). */}
      <div className={`solenoid-drawn-hint${IS_COARSE ? " solenoid-drawn-hint--touch" : ""}`}>
        <span className="solenoid-drawn-hint__state">
          {placed === 0 ? "Drawing" : placed === 1 ? "1 point" : `${placed} points`}
        </span>
        {IS_COARSE ? (
          <>
            <button
              type="button"
              className="solenoid-drawn-hint__btn"
              disabled={placed === 0}
              onClick={() => drawModeStore.undoPoint()}
            >
              Undo
            </button>
            <button
              type="button"
              className="solenoid-drawn-hint__btn solenoid-drawn-hint__btn--go"
              disabled={placed < 2}
              onClick={finish}
            >
              Finish
            </button>
            <button
              type="button"
              className="solenoid-drawn-hint__btn"
              onClick={() => drawModeStore.disarm()}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <span className="solenoid-drawn-hint__key">Enter</span>
            Finish
            <span className="solenoid-drawn-hint__key">Esc</span>
            Cancel
          </>
        )}
      </div>
    </>
  );
}
