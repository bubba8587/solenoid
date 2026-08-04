import { useEffect, useState } from "react";
import {
  BooleanOpNode as BooleanOpNodeType,
  BooleanOp,
  BOOLEAN_OP_META,
} from "../rete-nodes";
import { processGraph } from "../process";
import { ExtensibleInputs } from "./ExtensibleInputs";
import { NodeShell, OpSelect, ValueDisplay, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(BOOLEAN_OP_META) as BooleanOp[]).map((op) => ({
  value: op,
  label: BOOLEAN_OP_META[op].label,
}));

// Every op emits the logical type, so an op switch never swaps the output socket.
export function BooleanComponent({ data, emit }: NodeProps<BooleanOpNodeType>) {
  const [op, setOp] = useState<BooleanOp>(data.op);
  useEffect(() => { setOp(data.op); }, [data.op]);

  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} valueKeys={data.valueInputKeys()} />
      <OpSelect
        value={op}
        onChange={(next) => { setOp(next); data.op = next; void processGraph(data.id); }}
        options={OPS}
      />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
