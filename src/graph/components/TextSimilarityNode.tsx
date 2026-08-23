import { SIMILARITY_METHOD_META } from "../rete-nodes";
import type { TextSimilarityNode as TextSimilarityNodeType, FuzzyMatchNode as FuzzyMatchNodeType, SimilarityMethod } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, InlineOutputRows, useNodeField, type NodeProps } from "./nodeKit";

const METHODS = (Object.keys(SIMILARITY_METHOD_META) as SimilarityMethod[]).map((m) => ({
  value: m, label: SIMILARITY_METHOD_META[m].label, title: SIMILARITY_METHOD_META[m].description,
}));

export function TextSimilarityComponent({ data, emit }: NodeProps<TextSimilarityNodeType>) {
  const [method, setMethod] = useNodeField(data, "method");
  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect arg value={method} onChange={setMethod} options={METHODS} />
      <InlineInputs node={data} emit={emit} />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

const FUZZY_METHODS = METHODS.filter((m) => m.value !== "levenshtein");

export function FuzzyMatchComponent({ data, emit }: NodeProps<FuzzyMatchNodeType>) {
  const [method, setMethod] = useNodeField(data, "method");
  return (
    <NodeShell node={data} emit={emit} hideOutputSockets>
      <OpSelect arg value={method} onChange={setMethod} options={FUZZY_METHODS} />
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <InlineOutputRows
        node={data}
        emit={emit}
        rows={[
          { key: "match", label: "Best match", value: data.cachedMatch },
          { key: "score", label: "Score", value: data.cachedScore },
        ]}
      />
    </NodeShell>
  );
}
