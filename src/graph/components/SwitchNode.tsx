import type { SwitchNode } from "../rete-nodes";
import type { NodeProps } from "./nodeKit";
import { NodeShell, ValueDisplay } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import type { DisplayValue } from "./valueDisplayFormat";

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
