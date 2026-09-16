import { useState } from "react";
import { PAYMENT_BREAKDOWN_OP_META, PAYMENT_TIMING_META } from "../rete-nodes";
import type { PaymentBreakdownNode as PaymentBreakdownNodeType, PaymentBreakdownOp, PaymentTiming } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveView } from "../activeGraph";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";

const OPS = (Object.keys(PAYMENT_BREAKDOWN_OP_META) as PaymentBreakdownOp[]).map((op) => ({
  value: op,
  label: PAYMENT_BREAKDOWN_OP_META[op].label,
}));
const TIMING_OPTS = (Object.keys(PAYMENT_TIMING_META) as PaymentTiming[]).map((t) => ({
  value: t,
  label: PAYMENT_TIMING_META[t],
}));

export function PaymentBreakdownComponent({ data, emit }: NodeProps<PaymentBreakdownNodeType>) {
  const [op, setOpState] = useState<PaymentBreakdownOp>(data.op);
  const [paymentTiming, setPaymentTiming] = useNodeField(data, "paymentTiming");

  // The op reshapes sockets across the single↔range span, so it commits through the
  // prune/reshape path (not useNodeField): drop departing cables, reshape, re-render,
  // recompute (the AccruedInterest handoff).
  async function pickOp(next: PaymentBreakdownOp) {
    if (next === data.op) return;
    const departing = data.keysDroppedBySwitch(next);
    if (departing.length > 0) await dropInputCables(data.id, departing);
    data.setOp(next);
    setOpState(next);
    await getActiveView()?.rerenderNode(data.id);
    await processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={(o) => void pickOp(o)} options={OPS} />
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={paymentTiming} onChange={setPaymentTiming} options={TIMING_OPTS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
