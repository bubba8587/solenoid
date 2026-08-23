import { useEffect, useState } from "react";
import type { TrendNode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import { SegToggle } from "./SegToggle";
import { processGraph } from "../process";

export function TrendComponent({ data, emit }: NodeProps<TrendNode>) {
  const [mode, setMode] = useState(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg
        value={mode}
        options={[
          { value: "linear" as const, label: "linear", title: "Linear fit — predict along a straight line (Excel TREND)" },
          { value: "exponential" as const, label: "exp", title: "Exponential fit y = b·mˣ — predict along a growth curve (Excel GROWTH)" },
        ]}
        onChange={(next) => { setMode(next); data.mode = next; void processGraph(data.id); }}
      />
      <InlineInputs node={data} emit={emit} />
      <ResultDisplay value={data.cachedList} label={data.label} />
    </NodeShell>
  );
}
