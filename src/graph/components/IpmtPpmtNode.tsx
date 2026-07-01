import { IPMT_PPMT_OP_META, PAYMENT_TIMING_META } from "../rete-nodes";
import type { IpmtPpmtNode as IpmtPpmtNodeType, IpmtPpmtOp, PaymentTiming } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(IPMT_PPMT_OP_META) as IpmtPpmtOp[]).map((op) => ({
  value: op,
  label: IPMT_PPMT_OP_META[op].label,
}));

const TIMING_OPTS = (Object.keys(PAYMENT_TIMING_META) as PaymentTiming[]).map((t) => ({
  value: t,
  label: PAYMENT_TIMING_META[t],
}));

export function IpmtPpmtComponent({ data, emit }: NodeProps<IpmtPpmtNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [paymentTiming, setPaymentTiming] = useNodeField(data, "paymentTiming");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <OpSelect value={paymentTiming} onChange={setPaymentTiming} options={TIMING_OPTS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
