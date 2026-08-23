import { useEffect, useState } from "react";
import type { DiffNode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import { SegToggle } from "./SegToggle";
import { processGraph } from "../process";

export function DiffComponent({ data, emit }: NodeProps<DiffNode>) {
  const [mode, setMode] = useState(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg
        value={mode}
        options={[
          { value: "delta" as const, label: "Δ", title: "Absolute difference: list[i] − list[i−1]" },
          { value: "percent" as const, label: "%", title: "Percent change: (list[i] − list[i−1]) / list[i−1] (pandas pct_change)" },
        ]}
        onChange={(next) => { setMode(next); data.mode = next; void processGraph(data.id); }}
      />
      <InlineInputs node={data} emit={emit} />
      <ResultDisplay value={data.cachedList} label={data.label} />
    </NodeShell>
  );
}
