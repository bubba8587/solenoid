import { WEIBULL_DIST_OP_META } from "../nodes/dist-continuous";
import type { WeibullDistNode as WeibullDistNodeType, WeibullDistOp } from "../nodes/dist-continuous";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(WEIBULL_DIST_OP_META) as WeibullDistOp[]).map((op) => ({
  value: op,
  label: WEIBULL_DIST_OP_META[op].label,
}));

export function WeibullDistComponent({ data, emit }: NodeProps<WeibullDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
