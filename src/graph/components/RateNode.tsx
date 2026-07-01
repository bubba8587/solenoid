import { PAYMENT_TIMING_META } from "../rete-nodes";
import type { RateNode as RateNodeType, PaymentTiming } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const TIMING_OPTS = (Object.keys(PAYMENT_TIMING_META) as PaymentTiming[]).map((t) => ({
  value: t,
  label: PAYMENT_TIMING_META[t],
}));

export function RateComponent({ data, emit }: NodeProps<RateNodeType>) {
  const [paymentTiming, setPaymentTiming] = useNodeField(data, "paymentTiming");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={paymentTiming} onChange={setPaymentTiming} options={TIMING_OPTS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
