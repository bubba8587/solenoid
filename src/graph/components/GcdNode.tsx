import type { GcdNode as GcdNodeType, GcdOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: GcdOp; label: string }[] = [
  { value: "gcd", label: "GCD: greatest common divisor" },
  { value: "lcm", label: "LCM: least common multiple" },
];

export function GcdComponent({ data, emit }: NodeProps<GcdNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
