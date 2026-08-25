import { PAYMENT_TIMING_META } from "../rete-nodes";
import type { AmortizationNode as AmortizationNodeType, PaymentTiming } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import { FrameDisplay } from "./FrameDisplay";
import { nodeDisplayName } from "../catalogUtils";

const TIMING = (Object.keys(PAYMENT_TIMING_META) as PaymentTiming[]).map((t) => ({ value: t, label: PAYMENT_TIMING_META[t] }));

export function AmortizationComponent({ data, emit }: NodeProps<AmortizationNodeType>) {
  const [timing, setTiming] = useNodeField(data, "paymentTiming");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect arg value={timing} onChange={setTiming} options={TIMING} />
      <FrameDisplay frame={data.cachedResult} label={nodeDisplayName(data)} />
    </NodeShell>
  );
}
