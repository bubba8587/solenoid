import { chartPopup } from "../chartPopupStore";
import { useHostNodeId } from "./nodeContext";
import type { ChartValue } from "../chartValue";

/**
 * The compact "[Chart]" chip — the chart analogue of FrameChip. Shown where a
 * chart VALUE can't be drawn full size: a collapsed chart node's hero box and a
 * collapsed-group readout row. Click opens the read-only ChartPopup, which
 * renders the full figure via ChartFigure (so it covers every op). Label only,
 * no data — the whole point is a tidy stand-in for the plot.
 */
export function ChartChip({ value, label, pinNodeId }: {
  value: ChartValue;
  label?: string;
  /** Node whose value the popup's Pin/Go-to acts on; defaults to the host from
   *  context. A collapsed-group readout passes its member id explicitly. */
  pinNodeId?: string;
}) {
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  return (
    <button
      type="button"
      className="solenoid-array-chip solenoid-array-chip--sm"
      title="Chart — click to view"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const cs = getComputedStyle(e.currentTarget);
        const accent =
          cs.getPropertyValue("--node-accent").trim() ||
          cs.getPropertyValue("--sock-chart").trim() ||
          undefined;
        chartPopup.open({ title: label || value.title || "Chart", value, accent, pinNodeId: hostId ?? undefined });
      }}
    >
      Chart
    </button>
  );
}
