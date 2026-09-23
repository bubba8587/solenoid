import { collapseStore } from "../collapseStore";
import { useHostNodeId } from "./nodeContext";
import { stopDragStart } from "../coarse";
import type { MermaidValue } from "../mermaidValue";

/** A click expands the host card, where the diagram draws full size; there is no diagram popup. */
export function DiagramChip({ value, pinNodeId, size = "sm" }: {
  value: MermaidValue;
  pinNodeId?: string;
  size?: "sm" | "md";
}) {
  const ctxHostId = useHostNodeId();
  const hostId = pinNodeId ?? ctxHostId;
  return (
    <button
      type="button"
      className={`solenoid-array-chip solenoid-array-chip--chart${size === "sm" ? " solenoid-array-chip--sm" : ""}`}
      title={value.title ? `${value.title}: expand to see it` : "Expand to see the diagram"}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (hostId) collapseStore.set(hostId, false);
      }}
    >
      Diagram
    </button>
  );
}
