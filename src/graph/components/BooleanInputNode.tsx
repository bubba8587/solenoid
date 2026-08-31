import type { BooleanInputNode as BooleanInputNodeType } from "../rete-nodes";
import { processGraph } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { stopDragStart } from "../coarse";

export function BooleanInputComponent({ data, emit }: NodeProps<BooleanInputNodeType>) {
  async function onToggle() {
    data.value = data.value === 1 ? 0 : 1;
    await processGraph(data.id);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <label
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 0" }}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={data.value === 1}
          onChange={onToggle}
          style={{ width: 14, height: 14 }}
        />
        <span style={{ fontSize: 13, color: data.value === 1 ? "#2fae7a" : "var(--text-dim)" }}>
          {data.value === 1 ? "TRUE" : "FALSE"}
        </span>
      </label>
    </NodeShell>
  );
}
