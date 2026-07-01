import type { CumulativeNode as CumulativeNodeType, CumulativeOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: CumulativeOp; label: string }[] = [
  { value: "cumsum",  label: "CUMSUM — running sum"     },
  { value: "cummax",  label: "CUMMAX — running max"     },
  { value: "cummin",  label: "CUMMIN — running min"     },
  { value: "cumprod", label: "CUMPROD — running product" },
];

export function CumulativeComponent({ data, emit }: NodeProps<CumulativeNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
