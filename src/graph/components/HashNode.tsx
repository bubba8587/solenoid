import { HASH_ALGORITHM_META } from "../rete-nodes";
import type { HashNode as HashNodeType, HashAlgorithm } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const ALGORITHMS = (Object.keys(HASH_ALGORITHM_META) as HashAlgorithm[]).map((a) => ({
  value: a, label: HASH_ALGORITHM_META[a].label, title: HASH_ALGORITHM_META[a].description,
}));

export function HashComponent({ data, emit }: NodeProps<HashNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={ALGORITHMS} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
