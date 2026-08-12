import type { MathFnNode as MathFnNodeType, MathFnOp, AngleMode } from "../rete-nodes";
import { MATH_FN_OP_META, isTrigOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";

const OPS = (Object.keys(MATH_FN_OP_META) as MathFnOp[]).map((op) => ({
  value: op,
  label: MATH_FN_OP_META[op].label,
  group: MATH_FN_OP_META[op].group,
}));

const ANGLE_MODES: { value: AngleMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "rad", label: "Rad" },
  { value: "deg", label: "Deg" },
];

export function MathFnComponent({ data, emit }: NodeProps<MathFnNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [angleMode, setAngleMode] = useNodeField(data, "angleMode");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      {isTrigOp(op) && (
        <SegToggle arg value={angleMode} options={ANGLE_MODES} onChange={setAngleMode} />
      )}
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
