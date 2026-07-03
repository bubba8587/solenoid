import { useLayoutEffect, useRef, useState } from "react";
import type { MermaidNode as MermaidNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { useConnectedInputs } from "./inlineInput";
import { MermaidView } from "./MermaidView";
import { processGraph } from "../process";

export function MermaidComponent({ data, emit }: NodeProps<MermaidNodeType>) {
  const connected = useConnectedInputs(data.id);
  const sourceWired = connected.has("source");
  const source = sourceWired ? data.cachedSource : (data.stringLiterals.source ?? "");

  // Local draft while typing; commit to the node + recompute on blur only (Enter
  // must insert a newline in a diagram, so this can't use the Enter-commits helper).
  const [draft, setDraft] = useState(data.stringLiterals.source ?? "");
  useLayoutEffect(() => { setDraft(data.stringLiterals.source ?? ""); }, [data.stringLiterals.source]);
  function commit() {
    if (draft === (data.stringLiterals.source ?? "")) return;
    data.stringLiterals.source = draft;
    void processGraph();
  }

  // The source socket sits centred on the editor (its main feed), measured against
  // the card so it lines up with the textarea / preview block.
  const feedRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const t = el.offsetTop + el.offsetHeight / 2 - 6;
    setTop((prev) => (prev === t ? prev : t));
  });
  const sourcePort = data.inputs.source;

  return (
    <NodeShell
      node={data}
      emit={emit}
      collapsible={false}
      leading={sourcePort && top !== undefined
        ? <NodeSocket side="input" socketKey="source" nodeId={data.id} emit={emit} payload={sourcePort.socket} top={top} />
        : null}
    >
      <div ref={feedRef} style={{ position: "relative" }}>
        {sourceWired ? (
          <div className="solenoid-mermaid-source solenoid-mermaid-source--wired">connected</div>
        ) : (
          <textarea
            className="solenoid-mermaid-source"
            value={draft}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div className="solenoid-node__section-divider" />
      <MermaidView source={source} className="solenoid-mermaid--card" />
    </NodeShell>
  );
}
