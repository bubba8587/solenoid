import { useEffect, useState } from "react";
import type { RandArrayNode as RandArrayNodeType } from "../rete-nodes";
import { processGraph } from "../process";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import { RecalcButton } from "./RecalcButton";
import { stopDragStart } from "../coarse";

export function RandArrayComponent({ data, emit }: NodeProps<RandArrayNodeType>) {
  // Local mirror so the checkbox re-renders immediately (data.integer is the truth).
  const [integer, setInteger] = useState(data.integer);
  useEffect(() => { setInteger(data.integer); }, [data.integer]);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <label
        style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text)", marginTop: 2, cursor: "pointer" }}
        title="Round every draw to a whole number (Excel's integer flag)"
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={integer}
          onChange={(e) => { setInteger(e.target.checked); data.integer = e.target.checked; void processGraph(data.id); }}
        />
        Integer
      </label>
      <ResultDisplay value={data.cachedList} label={data.label} />
      <RecalcButton title="Roll new random values" />
    </NodeShell>
  );
}
