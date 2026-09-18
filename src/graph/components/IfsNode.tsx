import type { IfsNode } from "../rete-nodes";
import type { NodeProps } from "./nodeKit";
import { NodeShell, ValueDisplay } from "./nodeKit";
import { PairedExtensibleInputs } from "./PairedExtensibleInputs";
import type { DisplayValue } from "./valueDisplayFormat";

export function IfsComponent({ data, emit }: NodeProps<IfsNode>) {
  return (
    <NodeShell node={data} emit={emit}>
      <PairedExtensibleInputs node={data} emit={emit} trailingKeys={["otherwise"]} />
      <ValueDisplay value={data.cachedResult as DisplayValue} />
    </NodeShell>
  );
}
