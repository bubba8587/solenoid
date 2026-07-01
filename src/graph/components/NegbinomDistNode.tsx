import { NEGBINOM_DIST_OP_META } from "../nodes/dist-discrete";
import type { NegbinomDistNode as NegbinomDistNodeType, NegbinomDistOp } from "../nodes/dist-discrete";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(NEGBINOM_DIST_OP_META) as NegbinomDistOp[]).map((op) => ({
  value: op,
  label: NEGBINOM_DIST_OP_META[op].label,
}));

export function NegbinomDistComponent({ data, emit }: NodeProps<NegbinomDistNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
