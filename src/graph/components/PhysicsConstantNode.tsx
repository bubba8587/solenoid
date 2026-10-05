import { PhysicsConstantNode as PhysicsConstantNodeType } from "../rete-nodes";
import { PHYS_CONSTANTS, type PhysConstOp } from "../nodes/physicsConstantsOps";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.entries(PHYS_CONSTANTS) as [PhysConstOp, (typeof PHYS_CONSTANTS)[PhysConstOp]][]).map(
  ([value, meta]) => ({ value, label: `${meta.symbol}  ${meta.label}`, group: meta.group }),
);

export function PhysicsConstantComponent({ data, emit }: NodeProps<PhysicsConstantNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const meta = PHYS_CONSTANTS[op];
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      {/* The value carries its unit, so the box shows it formatted with the unit; the symbol is in the picker. */}
      <ValueDisplay value={meta.value} toClipboard={(v) => String(v)} />
    </NodeShell>
  );
}
