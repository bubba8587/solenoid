import type { IfNode as IfNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";

// A plain IF: three labeled inputs (Condition / Value if true / Value if false),
// value passthrough. The input labels come from the sockets, so InlineInputs
// renders the rows directly — no op selector (the boolean ops live elsewhere).
export function IfComponent({ data, emit }: NodeProps<IfNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      {/* `any` result — number / text / date / list, etc.; ValueDisplay renders each. */}
      <ValueDisplay value={data.cachedResult as DisplayValue} />
    </NodeShell>
  );
}
