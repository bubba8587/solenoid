// [[D16]] retypeReconciles
import { useEffect, useState } from "react";
import type { CastNode as CastNodeType } from "../rete-nodes";
import { CAST_TARGET_META, type CastTarget } from "../rete-nodes";
import { dropInputCables } from "./cablePrune";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { TypeIcon } from "./TypeIcon";

const SEPARATOR_KEYS = ["decimal_sep", "group_sep"];

const CAST_TARGET_OPTIONS = (Object.keys(CAST_TARGET_META) as CastTarget[]).map((value) => ({
  value,
  label: <TypeIcon type={value} />,
  title: `${CAST_TARGET_META[value].label}: ${CAST_TARGET_META[value].title}`,
}));

export async function applyCastTarget(node: CastNodeType, target: CastTarget): Promise<void> {
  if (node.target === target) return;
  const departing = node.keysDroppedBySwitch(target);
  if (departing.length > 0) await dropInputCables(node.id, departing);
  node.setTarget(target);

  // Active graph: a Cast inside a drill-in retypes its own graph's cables.
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "result");

  if (view) await view.rerenderNode(node.id);
  await processGraph();
}

export function CastComponent({ data, emit }: NodeProps<CastNodeType>) {
  const [target, setTarget] = useState<CastTarget>(data.target);
  useEffect(() => { setTarget(data.target); }, [data.target]);

  return (
    <NodeShell node={data} emit={emit} className="solenoid-node--cast">
      <InlineInputs node={data} emit={emit} keys={Object.keys(data.inputs).filter((k) => !SEPARATOR_KEYS.includes(k))} />
      {target === "number" && (
        <div className="solenoid-node__cast-seps">
          <div className="solenoid-node__row-caption">Separators</div>
          <InlineInputs node={data} emit={emit} keys={SEPARATOR_KEYS} />
        </div>
      )}
      <SegToggle
        value={target}
        options={CAST_TARGET_OPTIONS}
        onChange={(next) => { setTarget(next); void applyCastTarget(data, next); }}
      />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
