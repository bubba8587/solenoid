// The armed draw tool: a screen-space sheet over the pane, mounted only while armed.
// Owns pan itself (it is a SIBLING of the pane). Spec: subsystem-invariants § Drawn cables.
import { useRef, useSyncExternalStore } from "react";
import { drawModeStore, finishDrawing } from "../drawnCables";
import { isPinching } from "../pointerGesture";
import { IS_COARSE } from "../coarse";
import "./drawnCableLayer.css";

/** How far a press may travel and still count as a tap. */
const TAP_SLOP = IS_COARSE ? 12 : 4;

export function DrawnCableCapture({
  toFlow,
  panBy,
}: {
  toFlow: (screen: { x: number; y: number }) => { x: number; y: number };
  /** Move the camera by a SCREEN-space delta. */
  panBy: (dx: number, dy: number) => void;
}) {
  useSyncExternalStore(drawModeStore.subscribe, drawModeStore.version);
  const down = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  if (!drawModeStore.armed()) return null;

  const placed = drawModeStore.pending().length;

  return (
    <>
      <div
        className="solenoid-drawn-capture"
        onPointerMove={(e) => {
          const g = down.current;
          if (g && !isPinching()) {
            panBy(e.clientX - g.lastX, e.clientY - g.lastY);
            g.lastX = e.clientX;
            g.lastY = e.clientY;
          }
          drawModeStore.moveCursor(toFlow({ x: e.clientX, y: e.clientY }));
        }}
        onPointerLeave={() => drawModeStore.moveCursor(null)}
        onPointerDown={(e) => {
          if (e.button === 2) { finishDrawing(); return; }
          if (e.button !== 0) return;
          e.stopPropagation();
          down.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={() => { down.current = null; }}
        // Placing happens on CLICK: a PointerEvent's `detail` is always 0, so the
        // double-click that ends a run is only legible here.
        onClick={(e) => {
          const start = down.current;
          down.current = null;
          if (isPinching()) return;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
          e.stopPropagation();
          if (!IS_COARSE && e.detail >= 2) { finishDrawing(); return; }
          // Flow units per screen pixel, so a repeat tap on the last point is dropped.
          const o = toFlow({ x: 0, y: 0 });
          const u = toFlow({ x: 1, y: 0 });
          drawModeStore.place(toFlow({ x: e.clientX, y: e.clientY }), TAP_SLOP * Math.hypot(u.x - o.x, u.y - o.y));
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
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
              onClick={finishDrawing}
            >
              Finish
            </button>
            <button
              type="button"
              className="solenoid-drawn-hint__btn"
              onClick={() => drawModeStore.disarm()}
            >
              Cancel
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
