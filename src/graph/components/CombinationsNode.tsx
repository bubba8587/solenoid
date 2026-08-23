import { useEffect, useState } from "react";
import type { CombinationsNode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { TableDisplay } from "./TableDisplay";
import { SegToggle } from "./SegToggle";
import { processGraph } from "../process";

export function CombinationsComponent({ data, emit }: NodeProps<CombinationsNode>) {
  const [mode, setMode] = useState(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg
        value={mode}
        options={[
          { value: "combinations" as const, label: "combos", title: "Order-independent subsets (itertools.combinations)" },
          { value: "permutations" as const, label: "perms", title: "Ordered arrangements (itertools.permutations)" },
        ]}
        onChange={(next) => { setMode(next); data.mode = next; void processGraph(data.id); }}
      />
      <InlineInputs node={data} emit={emit} />
      <TableDisplay table={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}
