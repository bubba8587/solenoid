import type { ChartValue } from "../chartValue";
import { chartPopup } from "../chartPopupStore";
import { useHostNodeId } from "./nodeContext";
import type { ChartShape } from "./chartView";
import type { ChartOptions } from "../nodes/chartOptions";
import "./ExpressionNode.css"; // for .solenoid-expr__expand (shared expand button)
import { stopDragStart } from "../coarse";

export function ChartExpandButton({
  title, op, axes, series, opts, signColors, labels, value,
}: {
  title: string;
  /** The whole chart value (series, legend, labels); when given, the popup renders it
   *  through the same figure path as the card, so a multi-series chart expands intact. */
  value?: ChartValue;
  op: ChartShape;
  axes: boolean;
  series: { i: number; v: number }[];
  opts?: ChartOptions;
  signColors?: { pos: string; neg: string };
  labels?: (string | number)[];
}) {
  const hostId = useHostNodeId();
  return (
    <button
      type="button"
      className="solenoid-expr__expand"
      title="Expand"
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const accent = (e.currentTarget.closest(".solenoid-node") as HTMLElement | null)
          ?.style.getPropertyValue("--node-accent")?.trim() || undefined;
        if (value) chartPopup.open({ title, value, accent, pinNodeId: hostId ?? undefined });
        else chartPopup.open({ title, op, axes, series, opts, signColors, labels, accent, pinNodeId: hostId ?? undefined });
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" aria-hidden="true">
        <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      </svg>
    </button>
  );
}
