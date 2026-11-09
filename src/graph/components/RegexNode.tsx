import type { RegexNode as RegexNodeType } from "../nodeClasses";
import { REGEX_OP_META } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import type { RegexOp } from "../nodeClasses";
import { MatchCaseButton } from "./FrameNodes";

// Derived from REGEX_OP_META — the table the search rows read too.
const REGEX_OPTIONS: ReadonlyArray<OpOption<RegexOp>> = (Object.keys(REGEX_OP_META) as RegexOp[])
  .map((value) => ({ value, label: REGEX_OP_META[value].label }));

export function RegexComponent({ data: node, emit }: NodeProps<RegexNodeType>) {
  const [op, setOp]     = useNodeField(node, "op");
  const [matchCase, setMatchCase] = useNodeField(node, "matchCase");

  return (
    <NodeShell node={node} emit={emit}>
      <OpSelect value={op} onChange={setOp} options={REGEX_OPTIONS} />
      <InlineInputs
        node={node}
        emit={emit}
        keys={op === "replace" ? ["text", "pattern", "replacement"] : ["text", "pattern"]}
      />
      <div className="solenoid-node__io-row" style={{ paddingLeft: 8, justifyContent: "flex-end" }}>
        <MatchCaseButton on={matchCase} onToggle={() => setMatchCase(!matchCase)} title="Match case. Off ignores case, Excel's case_sensitivity 1." />
      </div>
      <ValueDisplay value={node.cachedResult} />
    </NodeShell>
  );
}
