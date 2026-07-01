import { chartPopup } from "../chartPopupStore";
import { useHostNodeId } from "./nodeContext";
import type { ChartShape } from "./chartView";
import type { ChartOptions } from "../nodes/chartOptions";
import "./ExpressionNode.css"; // for .solenoid-expr__expand (shared expand button)

/**
 * The expand affordance on a chart — the SAME button (class + icon + corner
 * position) the Expression / LAMBDA formula boxes use, so it reads as one
 * consistent control across the app. Opens the big read-only ChartPopup.
 */
export function ChartExpandButton({
  title, op, axes, series, opts,
}: {
  title: string;
  op: ChartShape;
  axes: boolean;
  series: { i: number; v: number }[];
  opts?: ChartOptions;
}) {
  const hostId = useHostNodeId();
  return (
    <button
      type="button"
      className="solenoid-expr__expand"
      title="Expand"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const accent = (e.currentTarget.closest(".solenoid-node") as HTMLElement | null)
          ?.style.getPropertyValue("--node-accent")?.trim() || undefined;
        chartPopup.open({ title, op, axes, series, opts, accent, pinNodeId: hostId ?? undefined });
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" aria-hidden="true">
        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      </svg>
    </button>
  );
}
