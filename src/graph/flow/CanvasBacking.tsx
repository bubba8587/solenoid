// [[C120]] linearWork. The canvas color and dot grid, under every card (react-flow-surface-contract § The dot grid).
import { memo, useId } from "react";
import { useStore } from "@xyflow/react";
import { DOT_SPACING } from "../gridSnapStore";

/** Half the backing's side in canvas units, a multiple of DOT_SPACING so a dot sits on every multiple of it. */
export const BACKING_SPAN = DOT_SPACING * 83334;
const SIDE = BACKING_SPAN * 2;

/** The color is the box's own background, which the browser knows is opaque; an SVG fill, or a fill under a scale, it doesn't.
 *  The dots are an SVG scaled back to screen pixels, so their tile rasters at screen resolution exactly as RF's background tile
 *  did (a dot of radius 1 at every multiple of DOT_SPACING); drawn in canvas units a zoomed-out dot rastered soft. */
export const CanvasBacking = memo(function CanvasBacking() {
  const id = `sol-dots-${useId()}`;
  const k = useStore((st) => st.transform[2]);
  const span = BACKING_SPAN * k;
  const side = SIDE * k;
  return (
    <div className="sol-canvas-backing" aria-hidden style={{ left: -BACKING_SPAN, top: -BACKING_SPAN, width: SIDE, height: SIDE }}>
      <svg
        className="sol-canvas-backing__dots"
        width={side}
        height={side}
        viewBox={`${-span} ${-span} ${side} ${side}`}
        style={{ transform: `scale(${1 / k})` }}
      >
        <defs>
          <pattern id={id} x={-k} y={-k} width={DOT_SPACING * k} height={DOT_SPACING * k} patternUnits="userSpaceOnUse">
            <circle cx={k} cy={k} r={k} />
          </pattern>
        </defs>
        <rect x={-span} y={-span} width={side} height={side} fill={`url(#${id})`} />
      </svg>
    </div>
  );
});
