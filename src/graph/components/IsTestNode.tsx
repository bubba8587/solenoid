import type { IsTestNode as IsTestNodeType, IsTestOp } from "../rete-nodes";
import { IS_TEST_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ERROR_EXPLANATIONS } from "../errorValue";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

const OPS = (Object.keys(IS_TEST_OP_META) as IsTestOp[]).map((op) => ({
  value: op,
  label: IS_TEST_OP_META[op].label,
}));

export function IsTestComponent({ data, emit }: NodeProps<IsTestNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const err = data.seenError;
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <ValueDisplay value={data.cachedResult} />
      {/* When an error value is wired in, this node doubles as the place to
          READ it: code, the producer's message, and the long what-it-means /
          how-to-fix explanation. Visible text, not a tooltip — this is the
          inspection surface. */}
      {err && (
        <div className="solenoid-node__error-explain">
          <div className="solenoid-node__error-explain-head">
            <span className="solenoid-node__error-explain-code">{err.code}</span>
            <span className="solenoid-node__error-explain-msg">{err.message}</span>
          </div>
          <div className="solenoid-node__error-explain-body">
            {ERROR_EXPLANATIONS[err.code]}
          </div>
        </div>
      )}
    </NodeShell>
  );
}
