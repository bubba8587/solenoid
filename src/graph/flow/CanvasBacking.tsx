// [[engineering#Table work grows with the rows, never with rows squared, and drawing stops at the screen]]. The canvas color and dot grid, under every card (react-flow-surface-contract § The dot grid).
import { memo, useId } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { DOT_SPACING } from "../gridSnapStore";

/** Half the backing's side in canvas units, a multiple of DOT_SPACING so a dot sits on every multiple of it. */
const BACKING_SPAN = DOT_SPACING * 83334;
const SIDE = BACKING_SPAN * 2;

/** The dots' window: CELL canvas units (a multiple of DOT_SPACING, at least a screen at this zoom), anchored on the cell
 *  under the screen's center, covering that cell and one on every side. A string, so a pan inside the cell re-renders nothing. */
function dotsWindow(st: ReactFlowState): string {
  const [x, y, k] = st.transform;
  const cell = DOT_SPACING * Math.max(1, Math.ceil(Math.max(st.width, st.height, 1) / k / DOT_SPACING));
  const ax = Math.floor((st.width / 2 - x) / k / cell) * cell;
  const ay = Math.floor((st.height / 2 - y) / k / cell) * cell;
  return `${k} ${cell} ${ax} ${ay}`;
}

/** The color is the box's own background, which the browser knows is opaque; an SVG fill, or a fill under a scale, it doesn't.
 *  The dots are an SVG scaled back to screen pixels, so their tile rasters at screen resolution exactly as RF's background tile
 *  did (a dot of radius 1 at every multiple of DOT_SPACING); drawn in canvas units a zoomed-out dot rastered soft. The SVG
 *  spans three screens around the view, not the backing: spanning the backing, it reached millions of pixels at full zoom, and
 *  a pinch at an unsnapped zoom then placed its dots half a pixel off, differently every frame. */
export const CanvasBacking = memo(function CanvasBacking() {
  const id = `sol-dots-${useId()}`;
  const [k, cell, ax, ay] = useStore(dotsWindow).split(" ").map(Number);
  const side = 3 * cell * k;
  return (
    <>
      <div className="sol-canvas-backing" aria-hidden style={{ left: -BACKING_SPAN, top: -BACKING_SPAN, width: SIDE, height: SIDE }} />
      <svg
        className="sol-canvas-backing sol-canvas-backing__dots"
        aria-hidden
        width={side}
        height={side}
        style={{ left: ax - cell, top: ay - cell, transform: `scale(${1 / k})` }}
      >
        <defs>
          <pattern id={id} x={-k} y={-k} width={DOT_SPACING * k} height={DOT_SPACING * k} patternUnits="userSpaceOnUse">
            <circle cx={k} cy={k} r={k} />
          </pattern>
        </defs>
        <rect width={side} height={side} fill={`url(#${id})`} />
      </svg>
    </>
  );
});
