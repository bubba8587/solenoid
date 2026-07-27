import { useState } from "react";
import type { RegexNode as RegexNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import { processGraph } from "../process";
import type { RegexOp } from "../rete-nodes";
import { stopDragStart } from "../coarse";

const REGEX_OPTIONS: ReadonlyArray<OpOption<RegexOp>> = [
  { value: "test",        label: "REGEXTEST" },
  { value: "extract",     label: "REGEXEXTRACT" },
  { value: "extract_all", label: "REGEXEXTRACT (all)" },
  { value: "replace",     label: "REGEXREPLACE" },
];

export function RegexComponent({ data: node, emit }: NodeProps<RegexNodeType>) {
  const [op, setOp]     = useNodeField(node, "op");
  const [flags, setFlags] = useState(node.stringLiterals.flags ?? "");

  function handleFlags(v: string) {
    node.stringLiterals.flags = v;
    setFlags(v);
    void processGraph(node.id);
  }

  return (
    <NodeShell node={node} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={REGEX_OPTIONS} />
      <InlineInputs
        node={node}
        emit={emit}
        keys={op === "replace" ? ["text", "pattern", "replacement"] : ["text", "pattern"]}
      />
      <div className="solenoid-node__io-row" style={{ paddingLeft: 8 }}>
        <span className="solenoid-node__io-label" style={{ color: "#7a8088", fontSize: 10 }}>flags</span>
        <input
          type="text"
          className="solenoid-node__inline-input"
          value={flags}
          placeholder="i, g, …"
          onChange={(e) => handleFlags(e.target.value)}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          style={{ width: 52 }}
        />
      </div>
      <ValueDisplay value={node.cachedResult} />
    </NodeShell>
  );
}
