import { useEffect, useState } from "react";
import type { ConnectedRegionsNode as ConnectedRegionsNodeType } from "../nodeClasses";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TableDisplay } from "./TableDisplay";
import { processGraph } from "../process";
import { stopDragStart } from "../coarse";
import { nodeDisplayName } from "../catalogUtils";

export function ConnectedRegionsComponent({ data, emit }: NodeProps<ConnectedRegionsNodeType>) {
  const [diagonal, setDiagonal] = useState(data.diagonal);
  useEffect(() => { setDiagonal(data.diagonal); }, [data.diagonal]);
  return (
    <NodeShell node={data} emit={emit}>
      <label
        style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text)", marginTop: 2, cursor: "pointer" }}
        title="Count cells that meet only at a corner as touching (8-connected)"
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={diagonal}
          onChange={(e) => { setDiagonal(e.target.checked); data.diagonal = e.target.checked; void processGraph(data.id); }}
        />
        Diagonals touch
      </label>
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult as (number | null)[][] | null} label={nodeDisplayName(data)} elem="number" />
    </NodeShell>
  );
}
