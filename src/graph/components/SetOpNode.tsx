import { useMemo } from "react";
import type { SetOpNode as SetOpNodeType, SetOp } from "../rete-nodes";
import { SET_OP_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { useKatexRender } from "./katexLoader";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import "./SetOpNode.css";

const OPS = (Object.keys(SET_OP_META) as SetOp[]).map((op) => ({
  value: op,
  label: SET_OP_META[op].label,
}));

export function SetOpComponent({ data, emit }: NodeProps<SetOpNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const meta = SET_OP_META[op];

  // Render the set notation as real math. Until the KaTeX chunk arrives the hook
  // returns null and we show the Unicode form, snapping to typeset math a beat later.
  const render = useKatexRender();
  const html = useMemo(() => {
    if (!render) return null;
    try {
      return render(meta.tex, { throwOnError: false, displayMode: false });
    } catch {
      return null;
    }
  }, [render, meta.tex]);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <OpSelect value={op} onChange={setOp} options={OPS} />
      <div className="solenoid-setop__notation" title={meta.label}>
        {html != null ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span>{meta.plain}</span>
        )}
      </div>
      <ValueDisplay value={data.cachedList} />
    </NodeShell>
  );
}
