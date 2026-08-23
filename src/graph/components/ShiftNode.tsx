import { useEffect, useState } from "react";
import type { ShiftNode } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import { SegToggle } from "./SegToggle";
import { processGraph } from "../process";

export function ShiftComponent({ data, emit }: NodeProps<ShiftNode>) {
  const [wrap, setWrap] = useState(data.wrap);
  useEffect(() => { setWrap(data.wrap); }, [data.wrap]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg
        value={wrap}
        options={[
          { value: "blank" as const, label: "blank", title: "Vacated slots are blank; elements pushed off the end drop away" },
          { value: "wrap" as const, label: "wrap", title: "Elements pushed off one end wrap around to the other (numpy.roll)" },
        ]}
        onChange={(next) => { setWrap(next); data.wrap = next; void processGraph(data.id); }}
      />
      <InlineInputs node={data} emit={emit} />
      <ResultDisplay value={data.cachedList} label={data.label} />
    </NodeShell>
  );
}
