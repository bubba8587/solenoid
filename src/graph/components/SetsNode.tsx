// [[C113]] controlDrivenRetype, [[D16]] retypeReconciles, [[C26]] opArgDistinct
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SetsNode as SetNodeType, SetOpAll } from "../rete-nodes";
import { SET_META, isSetRelationOp, adoptiveListOut, logicalOut } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { descriptionText } from "../descriptionMd";
import { useKatexRender } from "./katexLoader";
import { NodeShell, OpSelect, ValueDisplay, type NodeProps, type OpOption } from "./nodeKit";
import type { DisplayValue } from "./valueDisplayFormat";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { processGraph } from "../process";
import "./SetOpNode.css";

const OPS: ReadonlyArray<OpOption<SetOpAll>> = (Object.keys(SET_META) as SetOpAll[]).map((op) => ({
  value: op,
  label: SET_META[op].label,
  title: SET_META[op].description,
  group: SET_META[op].group,
}));

// An operation (list) and relation (logical) switch swaps the result socket in place and retypes downstream cables.
export async function applySetOp(node: SetNodeType, op: SetOpAll): Promise<void> {
  if (node.op === op) return;
  const crossed = isSetRelationOp(node.op) !== isSetRelationOp(op);
  node.op = op;
  if (crossed) {
    const editor = getActiveEditor();
    const view = getActiveView();
    const out = node.outputs.result;
    if (out) out.socket = (isSetRelationOp(op) ? logicalOut("Result") : adoptiveListOut("Result")).socket;
    if (editor && view) await retypeOutputCables(editor, view, node.id, "result");
    if (view) await view.rerenderNode(node.id);
  }
  await processGraph();
}

export function SetsComponent({ data, emit }: NodeProps<SetNodeType>) {
  const [op, setOpState] = useState<SetOpAll>(data.op);
  useEffect(() => { setOpState(data.op); }, [data.op]);
  const setOp = useCallback((v: SetOpAll) => { setOpState(v); void applySetOp(data, v); }, [data]);
  const meta = SET_META[op];
  const isRel = isSetRelationOp(op);

  // The hook returns null until the KaTeX chunk lands, so the Unicode form shows first.
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
      <div className="solenoid-setop__notation" title={descriptionText(meta.description)}>
        {html != null ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span>{meta.plain}</span>
        )}
      </div>
      {isRel ? (
        <ValueDisplay value={data.cachedRelation} render={(v) => (v === 1 ? "TRUE" : "FALSE")} />
      ) : (
        <ValueDisplay value={data.cachedList as DisplayValue} />
      )}
    </NodeShell>
  );
}
