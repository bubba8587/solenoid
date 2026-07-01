import type { ComparisonNode as ComparisonNodeType, ComparisonOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS: { value: ComparisonOp; label: string }[] = [
  { value: "gt",  label: ">  Greater than" },
  { value: "gte", label: "≥  Greater or equal" },
  { value: "lt",  label: "<  Less than" },
  { value: "lte", label: "≤  Less or equal" },
  { value: "eq",  label: "=  Equal" },
  { value: "neq", label: "≠  Not equal" },
];

export function ComparisonComponent({ data, emit }: NodeProps<ComparisonNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} render={(v) => (v === 1 ? "true (1)" : "false (0)")} />
    </NodeShell>
  );
}
