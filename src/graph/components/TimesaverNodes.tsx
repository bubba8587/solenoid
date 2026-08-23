import { useEffect, useState } from "react";
import { ReverseTextNode as ReverseTextNodeType, SpellNumberNode as SpellNumberNodeType } from "../rete-nodes";
import { makeNodeComponent } from "./standardNode";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ResultDisplay } from "./ResultDisplay";
import { SegToggle } from "./SegToggle";
import { processGraph } from "../process";

export const ReverseTextComponent = makeNodeComponent<ReverseTextNodeType>((n) => n.cachedText);

export function SpellNumberComponent({ data, emit }: NodeProps<SpellNumberNodeType>) {
  const [mode, setMode] = useState(data.mode);
  useEffect(() => { setMode(data.mode); }, [data.mode]);
  return (
    <NodeShell node={data} emit={emit}>
      <SegToggle arg
        value={mode}
        options={[
          { value: "words" as const, label: "words", title: "Spell out in words: 42 → forty-two" },
          { value: "ordinal" as const, label: "ordinal", title: "Ordinal form: 42 → 42nd" },
        ]}
        onChange={(next) => { setMode(next); data.mode = next; void processGraph(data.id); }}
      />
      <InlineInputs node={data} emit={emit} />
      <ResultDisplay value={data.cachedText} label={data.label} />
    </NodeShell>
  );
}
