import { HASH_ALGORITHM_META } from "../rete-nodes";
import type { HashNode as HashNodeType, HashAlgorithm } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ArgSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const ALGORITHMS = (Object.keys(HASH_ALGORITHM_META) as HashAlgorithm[]).map((a) => ({
  value: a, label: HASH_ALGORITHM_META[a].label, title: HASH_ALGORITHM_META[a].description,
}));

export function HashComponent({ data, emit }: NodeProps<HashNodeType>) {
  const [algorithm, setAlgorithm] = useNodeField(data, "algorithm");
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <ArgSelect value={algorithm} onChange={setAlgorithm} options={ALGORITHMS} />
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
