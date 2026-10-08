import type { TextAfterBeforeNode as TextAfterBeforeNodeType, TextAfterBeforeOp } from "../rete-nodes";
import { TEXT_AFTER_BEFORE_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { MatchCaseButton } from "./FrameNodes";

const OPS = (Object.keys(TEXT_AFTER_BEFORE_OP_META) as TextAfterBeforeOp[]).map(op => ({
  value: op,
  label: TEXT_AFTER_BEFORE_OP_META[op].label,
}));

export function TextAfterBeforeComponent({ data, emit }: NodeProps<TextAfterBeforeNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const [matchCase, setMatchCase] = useNodeField(data, "matchCase");
  const [matchEnd, setMatchEnd] = useNodeField(data, "matchEnd");
  function handleOp(next: TextAfterBeforeOp) {
    setOp(next);
  }
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
        <MatchCaseButton on={matchCase} onToggle={() => setMatchCase(!matchCase)} title="Match case. Off ignores case, Excel's match_mode 1." />
        <MatchCaseButton on={matchEnd} onToggle={() => setMatchEnd(!matchEnd)} label="End" title="The end of the text counts as a delimiter, Excel's match_end." />
      </div>
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
