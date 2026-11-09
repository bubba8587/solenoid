import { useState } from "react";
import { PAYMENT_TIMING_META } from "../nodeClasses";
import type { TvmNode as TvmNodeType, PaymentTiming } from "../nodeClasses";
import { ArgSelect, type NodeProps } from "./nodeKit";
import { EquationComponent } from "./EquationNode";
import { processGraph } from "../process";
const TIMING_OPTS = (Object.keys(PAYMENT_TIMING_META) as PaymentTiming[]).map((t) => ({
  value: t,
  label: PAYMENT_TIMING_META[t],
}));

// Payment timing swaps which locked relation is compiled, so it's a dropdown rather
// than a variable socket.
export function TvmComponent({ data, emit }: NodeProps<TvmNodeType>) {
  const [timing, setTiming] = useState<PaymentTiming>(data.paymentTiming);
  return (
    <EquationComponent
      data={data}
      emit={emit}
      config={
        <ArgSelect
          value={timing}
          onChange={(t) => {
            data.setPaymentTiming(t);
            setTiming(t);
            data.edited(); void processGraph();
          }}
          options={TIMING_OPTS}
        />
      }
    />
  );
}
