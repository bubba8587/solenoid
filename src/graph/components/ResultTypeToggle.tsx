// Polyform result-type selector — the control the value-polymorphic formula
// producers (Expression, MAP, BYROW/BYCOL, REDUCE, MAKEARRAY) carry to declare
// their output element type. Swaps the output socket in place to the chosen
// type at the node's dimensionality level and drops now-incompatible outgoing
// cables — same mechanics as Cast's target toggle / the frame nodes' read-as.
import { useEffect, useState } from "react";
import type { ClassicPreset } from "rete";
import { resultSocket, RESULT_TYPE_META, type ResultType, type ResultDim } from "../nodes/shared";
import { getEditor, getArea, processGraph } from "../process";
import { retypeOutputCables } from "../fcReconcile";
import { SegToggle } from "./SegToggle";

type Producer = {
  id: string;
  resultAs: ResultType;
  outputs: { result?: { socket: ClassicPreset.Socket } };
};

const RESULT_TYPE_OPTIONS = (Object.keys(RESULT_TYPE_META) as ResultType[]).map((value) => ({
  value,
  label: RESULT_TYPE_META[value].label,
  title: RESULT_TYPE_META[value].title,
}));

export async function applyResultAs(node: Producer, dim: ResultDim, resultAs: ResultType): Promise<void> {
  if (node.resultAs === resultAs) return;
  node.resultAs = resultAs;

  const editor = getEditor();
  const area = getArea();
  const out = node.outputs.result;
  if (out) out.socket = resultSocket(dim, resultAs);
  // Keep cables the new type can still feed (an `any` input survives) and re-adapt
  // downstream FCs so the type change propagates the whole chain.
  if (editor && area) await retypeOutputCables(editor, area, node.id, "result");

  if (area) await area.update("node", node.id);
  await processGraph();
}

export function ResultTypeToggle({ node, dim }: { node: Producer; dim: ResultDim }) {
  // Local mirror so the control re-renders on change; the handler swaps the
  // output socket (see applyResultAs).
  const [resultAs, setResultAs] = useState<ResultType>(node.resultAs);
  useEffect(() => { setResultAs(node.resultAs); }, [node.resultAs]);

  return (
    <SegToggle
      value={resultAs}
      options={RESULT_TYPE_OPTIONS}
      onChange={(next) => { setResultAs(next); void applyResultAs(node, dim, next); }}
    />
  );
}
