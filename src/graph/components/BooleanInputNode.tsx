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
      <LogicalCheck checked={data.value === 1} onToggle={() => void onToggle()} />
    </NodeShell>
  );
}

/** The TRUE/FALSE checkbox; Boolean Input's and Value Input's. */
export function LogicalCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", padding: "2px 0" }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ width: 14, height: 14 }}
      />
      <span style={{ fontSize: 13, color: checked ? "color-mix(in srgb, var(--sol-ok) 70%, var(--text))" : "var(--text-dim)" }}>
        {checked ? "TRUE" : "FALSE"}
      </span>
    </label>
  );
}
