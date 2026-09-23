import { useRef, useSyncExternalStore } from "react";
import { drawModeStore, finishDrawing } from "../drawnCables";
import { isPinching } from "../pointerGesture";
import { IS_COARSE } from "../coarse";
import "./drawnCableLayer.css";

const TAP_SLOP = IS_COARSE ? 12 : 4;

export function DrawnCableCapture({
  toFlow,
  panBy,
  zoom,
}: {
  toFlow: (screen: { x: number; y: number }) => { x: number; y: number };
  /** Move the camera by a SCREEN-space delta. */
  panBy: (dx: number, dy: number) => void;
  /** The camera zoom (flow units per screen pixel is 1 / zoom). */
  zoom: () => number;
}) {
  useSyncExternalStore(drawModeStore.subscribe, drawModeStore.version);
  // `down` lives only while the button is held; `pressStart` outlives the release so the following click can apply the tap slop.
  const down = useRef<{ lastX: number; lastY: number } | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
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
          down.current = { lastX: e.clientX, lastY: e.clientY };
          pressStart.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        // Released means no longer panning, click or not, so a bare hover can't drag the camera next.
        onPointerUp={(e) => {
          down.current = null;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={() => { down.current = null; pressStart.current = null; }}
        onClick={(e) => {
          const start = pressStart.current;
          pressStart.current = null;
          if (isPinching()) return;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
          e.stopPropagation();
          if (!IS_COARSE && e.detail >= 2) { finishDrawing(); return; }
          // Tap slop in flow units from the zoom, so a repeat tap on the last point is dropped (toFlow snaps to the grid, which would read as 0).
          drawModeStore.place(toFlow({ x: e.clientX, y: e.clientY }), TAP_SLOP / Math.max(1e-6, zoom()));
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
