import { CUM_PMT_OP_META, PAYMENT_TIMING_META } from "../rete-nodes";
import type { CumPmtNode as CumPmtNodeType, CumPmtOp, PaymentTiming } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(CUM_PMT_OP_META) as CumPmtOp[]).map((op) => ({
  value: op,
  label: CUM_PMT_OP_META[op].label,
}));

const TIMING_OPTS = (Object.keys(PAYMENT_TIMING_META) as PaymentTiming[]).map((t) => ({
  value: t,
  label: PAYMENT_TIMING_META[t],
}));

export function CumPmtComponent({ data, emit }: NodeProps<CumPmtNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [paymentTiming, setPaymentTiming] = useNodeField(data, "paymentTiming");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <OpSelect arg value={paymentTiming} onChange={setPaymentTiming} options={TIMING_OPTS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
