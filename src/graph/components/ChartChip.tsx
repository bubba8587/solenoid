// [[C100]] chartIsAValue
import { chartPopup } from "../chartPopupStore";
import { useHostNodeId } from "./nodeContext";
import { readChipPopupStyle } from "./chipStyle";
import type { ChartValue } from "../chartValue";
import { stopDragStart } from "../coarse";

export function ChartChip({ value, label, pinNodeId, size = "sm" }: {
  value: ChartValue;
  label?: string;
  pinNodeId?: string;
  size?: "sm" | "md";
}) {
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--chart${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title="Chart"
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const { accent } = readChipPopupStyle(e.currentTarget, "--sock-chart");
        chartPopup.open({ title: label || value.title || "Chart", value, accent, pinNodeId: hostId ?? undefined });
      }}
    >
      Chart
    </button>
  );
}
