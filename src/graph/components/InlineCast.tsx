// [[socket-lattice#The InlineCast]]: a type pick on a card's result is a Cast, labelled as one; ∅ keeps the computed type.
// [[B11]] maximalMerge: the pick retypes the result socket in place, so it reconciles the cables after.
import { useEffect, useState } from "react";
import type { GraphSocket } from "../graphModel";
import { castResultSocket, CAST_TO_META, type CastTo, type ResultDim } from "../nodes/shared";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { CardSection } from "./CardSection";
import { SegToggle } from "./SegToggle";
import { NoCastIcon, TypeIcon } from "./TypeIcon";

type Producer = {
  id: string;
  edited(): void;
  castTo: CastTo;
  outputs: { result?: { socket: GraphSocket } };
};

const OPTIONS = (Object.keys(CAST_TO_META) as CastTo[]).map((value) => ({
  value,
  label: value === "none" ? <NoCastIcon /> : <TypeIcon type={value} />,
  title: CAST_TO_META[value].title,
}));

async function applyCast(node: Producer, dim: ResultDim, castTo: CastTo): Promise<void> {
  if (node.castTo === castTo) return;
  node.castTo = castTo;
  const editor = getOwningEditor(node.id);
  const view = getOwningView(node.id);
  const out = node.outputs.result;
  if (out) out.socket = castResultSocket(dim, castTo);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "result");
  if (view) await view.rerenderNode(node.id);
  node.edited(); await processGraph();
}

/** The Cast section on a card's result. */
export function InlineCast({ node, dim }: { node: Producer; dim: ResultDim }) {
  const [castTo, setCastTo] = useState<CastTo>(node.castTo);
  useEffect(() => { setCastTo(node.castTo); }, [node.castTo]);
  return (
    <CardSection label="Cast">
      <SegToggle
        value={castTo}
        options={OPTIONS}
        onChange={(next) => { setCastTo(next); void applyCast(node, dim, next); }}
      />
    </CardSection>
  );
}
