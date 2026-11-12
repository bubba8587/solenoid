import type { TextAfterBeforeNode as TextAfterBeforeNodeType, TextAfterBeforeOp } from "../nodeClasses";
import { TEXT_AFTER_BEFORE_OP_META } from "../nodeClasses";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { useSyncExternalStore } from "react";
import { MatchCaseButton } from "./FrameNodes";
import { CardSection, useRowsInUse } from "./CardSection";
import { collapseStore } from "../collapseStore";

/** Excel's optional arguments: instance_num and if_not_found, with match_mode and match_end beside them. */
const OPTION_KEYS = ["instance", "if_not_found"];

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
  const optionsSet = useRowsInUse(data, OPTION_KEYS, { instance: 1 });
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  return (
    <NodeShell node={data} emit={emit}>
      {/* Collapsed, one InlineInputs carries every input, so the card shows one pill. */}
      <InlineInputs node={data} emit={emit} keys={collapsed ? undefined : ["text", "delimiter"]} />
      <OpSelect value={op} onChange={handleOp} options={OPS} />
      {!collapsed && (
        <CardSection
          label="Options"
          collapsible
          defaultOpen={optionsSet || !matchCase || matchEnd}
          sockets={{ node: data, emit, keys: OPTION_KEYS }}
        >
          <InlineInputs node={data} emit={emit} keys={OPTION_KEYS} />
          <div className="solenoid-node__toggle-pair">
            <MatchCaseButton on={matchCase} onToggle={() => setMatchCase(!matchCase)} title="Match case. Off ignores case, Excel's match_mode 1." />
            <MatchCaseButton on={matchEnd} onToggle={() => setMatchEnd(!matchEnd)} label="End" title="The end of the text counts as a delimiter, Excel's match_end." />
          </div>
        </CardSection>
      )}
      <ValueDisplay value={data.cachedText} />
    </NodeShell>
  );
}
