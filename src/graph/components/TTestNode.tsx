import { T_TEST_OP_META } from "../rete-nodes";
import type { TTestNode as TTestNodeType, TTestOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(T_TEST_OP_META) as TTestOp[]).map((op) => ({
  value: op,
  label: T_TEST_OP_META[op].label,
}));

export function TTestComponent({ data, emit }: NodeProps<TTestNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
