import type { IsTestNode as IsTestNodeType, IsTestOp } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { ERROR_EXPLANATIONS } from "../errorValue";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";

// Short, Excel-style names in the dropdown — not the full explanation (the value
// box and the wired-error panel carry the meaning). ISBOOLEAN is our nicer name
// for Excel's ISLOGICAL; the `islogical` op value stays for save compatibility.
const OPS: { value: IsTestOp; label: string }[] = [
  { value: "isnumber",  label: "ISNUMBER" },
  { value: "isblank",   label: "ISBLANK" },
  { value: "isnull",    label: "ISNULL" },
  { value: "iserror",   label: "ISERROR" },
  { value: "isna",      label: "ISNA" },
  { value: "islogical", label: "ISBOOLEAN" },
  { value: "istext",    label: "ISTEXT" },
  { value: "isnontext", label: "ISNONTEXT" },
];

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
