// Cast — universal data-type conversion (number / text / date / complex).
import { useEffect, useState } from "react";
import type { CastNode as CastNodeType } from "../rete-nodes";
import { CAST_TARGET_META, castOutput, type CastTarget } from "../rete-nodes";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { SegToggle } from "./SegToggle";

const CAST_TARGET_OPTIONS = (Object.keys(CAST_TARGET_META) as CastTarget[]).map((value) => ({
  value,
  label: CAST_TARGET_META[value].label,
  title: CAST_TARGET_META[value].title,
}));

/**
 * Switch the Cast target: swaps the output socket in place to the target's
 * type (numlist / strcombo / datecombo / complex). Keeps each outgoing cable the
 * new type can still feed (an `any` input always survives) and re-adapts downstream
 * Format Controllers so the type change propagates — same mechanics as the
 * LAMBDA/Expression result type and the frame nodes' read-as toggle.
 */
export async function applyCastTarget(node: CastNodeType, target: CastTarget): Promise<void> {
  if (node.target === target) return;
  node.target = target;

  // Active graph: a Cast inside a Composite drill-in retypes its OWN graph's cables.
  const editor = getActiveEditor();
  const area = getActiveArea();
  const out = node.outputs.result;
  if (out) out.socket = castOutput(target).socket;
  if (editor && area) await retypeOutputCables(editor, area, node.id, "result");

  if (area) await area.update("node", node.id);
  await processGraph();
}

export function CastComponent({ data, emit }: NodeProps<CastNodeType>) {
  // Local mirror of the target so the control re-renders on change; the
  // change handler swaps the output socket type (see applyCastTarget).
  const [target, setTarget] = useState<CastTarget>(data.target);
  useEffect(() => { setTarget(data.target); }, [data.target]);

  return (
    <NodeShell node={data} emit={emit} className="solenoid-node--cast">
      <InlineInputs node={data} emit={emit} />
      <SegToggle
        value={target}
        options={CAST_TARGET_OPTIONS}
        onChange={(next) => { setTarget(next); void applyCastTarget(data, next); }}
      />
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}
