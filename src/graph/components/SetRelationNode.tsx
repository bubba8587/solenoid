import { useMemo } from "react";
import type { SetRelationNode as SetRelationNodeType, SetRelation } from "../rete-nodes";
import { SET_RELATION_META } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { useKatexRender } from "./katexLoader";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import "./SetOpNode.css";

const OPS = (Object.keys(SET_RELATION_META) as SetRelation[]).map((op) => ({
  value: op,
  label: SET_RELATION_META[op].label,
  title: SET_RELATION_META[op].description,
}));

export function SetRelationComponent({ data, emit }: NodeProps<SetRelationNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  const meta = SET_RELATION_META[op];

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
      <div className="solenoid-setop__notation" title={meta.description}>
        {html != null ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span>{meta.plain}</span>
        )}
      </div>
      <ValueDisplay value={data.cachedResult} render={(v) => (v === 1 ? "TRUE" : "FALSE")} />
    </NodeShell>
  );
}
