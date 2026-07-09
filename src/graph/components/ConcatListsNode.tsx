import type { ConcatListsNode as ConcatListsNodeType } from "../rete-nodes";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { ExtensibleInputs } from "./ExtensibleInputs";
import type { DisplayValue } from "./valueDisplayFormat";

export function ConcatListsComponent({ data, emit }: NodeProps<ConcatListsNodeType>) {
  return (
    <NodeShell node={data} emit={emit}>
      <ExtensibleInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedList as DisplayValue} />
    </NodeShell>
  );
}
