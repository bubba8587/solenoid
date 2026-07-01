import { TVM_OP_META, PAYMENT_TIMING_META } from "../rete-nodes";
import type { TvmNode as TvmNodeType, TvmOp, PaymentTiming } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { getEditor, processGraph } from "../process";

const OPS = (Object.keys(TVM_OP_META) as TvmOp[]).map((op) => ({
  value: op,
  label: TVM_OP_META[op].label,
}));

const TIMING_OPTS = (Object.keys(PAYMENT_TIMING_META) as PaymentTiming[]).map((t) => ({
  value: t,
  label: PAYMENT_TIMING_META[t],
}));

// Fixed input order. The op being solved for is hidden — e.g. PMT solves
// for the payment, so showing a "Pmt" input would be meaningless (Excel's
// =PMT(rate, nper, pv, fv, type) has no pmt argument either).
const TVM_INPUT_ORDER = ["rate", "nper", "pmt", "pv", "fv"];

export function TvmComponent({ data, emit }: NodeProps<TvmNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [paymentTiming, setPaymentTiming] = useNodeField(data, "paymentTiming");
  // The op value is exactly the key of the quantity being solved for.
  const shownKeys = TVM_INPUT_ORDER.filter((k) => k !== op);

  async function handleOpChange(next: TvmOp) {
    // The input matching `next` is about to be hidden (we solve for it).
    // Drop any cable wired to it so it doesn't dangle to a hidden socket.
    const editor = getEditor();
    if (editor) {
      const stale = editor.getConnections().filter(
        (c) => c.target === data.id && c.targetInput === next,
      );
      for (const c of stale) await editor.removeConnection(c.id);
    }
    setOp(next);
    void processGraph();
  }

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={shownKeys} />
      <OpSelect value={op} onChange={handleOpChange} options={OPS} />
      <OpSelect value={paymentTiming} onChange={setPaymentTiming} options={TIMING_OPTS} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
