import type { SwitchNode } from "../rete-nodes";
import type { NodeProps } from "./nodeKit";
import { NodeShell, ValueDisplay } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import type { DisplayValue } from "./valueDisplayFormat";

// SWITCH: a fixed Expression + extensible when/then pairs + a fixed Default.
// Returns the Then of the first When equal to the Expression, else the Default.
export function SwitchComponent({ data, emit }: NodeProps<SwitchNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <PairedExtensibleInputs
        node={data}
        emit={emit}
        leadingKeys={["expr"]}
        trailingKeys={["default"]}
      />
      <ValueDisplay value={data.cachedResult as DisplayValue} />
    </NodeShell>
  );
}
