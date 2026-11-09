import { PhysicsConstantNode as PhysicsConstantNodeType } from "../nodeClasses";
import { PHYS_CONSTANTS, type PhysConstOp } from "../nodes/physicsConstantsOps";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { CollapsedCell, useCollapsed } from "./CollapsedCell";

const OPS = (Object.entries(PHYS_CONSTANTS) as [PhysConstOp, (typeof PHYS_CONSTANTS)[PhysConstOp]][]).map(
  ([value, meta]) => ({ value, label: `${meta.symbol}  ${meta.label}`, group: meta.group }),
);

// Constants span 61 orders of magnitude: exponent notation for anything the plain form
// would mangle, full digits where they fit.
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
  const collapsed = useCollapsed(data.id);
  const render = (v: number) => <>{formatConst(v)}<span className="solenoid-const__unit">{meta.unit}</span></>;
  // Collapsed, the card is its value cell, read-only (as Constant).
  return (
    <NodeShell node={data} emit={emit} cellCollapse>
      <OpSelect value={op} onChange={setOp} options={OPS} />
      {collapsed ? (
        <CollapsedCell value={meta.value} renderWins render={render} />
      ) : (
        <ValueDisplay value={meta.value} renderWins render={render} toClipboard={(v) => String(v)} />
      )}
    </NodeShell>
  );
}
