import {
  PhysicsConstantNode as PhysicsConstantNodeType,
  PHYS_CONSTANTS,
  type PhysConstOp,
} from "../rete-nodes";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.entries(PHYS_CONSTANTS) as [PhysConstOp, (typeof PHYS_CONSTANTS)[PhysConstOp]][]).map(
  ([value, meta]) => ({ value, label: `${meta.symbol}  ${meta.label}`, group: meta.group }),
);

// Constants span 61 orders of magnitude; exponent notation for anything the
// plain form would mangle, full digits where they fit (c = 299792458).
function formatConst(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e-3 && abs < 1e9) {
    return Number.isInteger(n) ? n.toString() : String(Number(n.toPrecision(10)));
  }
  return n.toExponential(6).replace(/\.?0+e/, "e");
}

export function PhysicsConstantComponent({ data, emit }: NodeProps<PhysicsConstantNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const meta = PHYS_CONSTANTS[op];
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <div className="solenoid-node__display-value">
        <span style={{ marginRight: 6, color: "#9aa0a6" }}>{meta.symbol}</span>
        {formatConst(meta.value)}
        <span style={{ marginLeft: 6, color: "#9aa0a6", fontSize: "0.85em" }}>{meta.unit}</span>
      </div>
    </NodeShell>
  );
}
