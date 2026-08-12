// Result-type selector for the value-polymorphic producers (Expression, MAP,
// BYROW/BYCOL, REDUCE, MAKEARRAY) — an in-place socket retype, so it must reconcile.
import { useEffect, useState } from "react";
import type { ClassicPreset } from "rete";
import { resultSocket, RESULT_TYPE_META, type ResultType, type ResultDim } from "../nodes/shared";
import { processGraph } from "../process";
import { getActiveEditor, getActiveArea } from "../activeGraph";
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

  const editor = getActiveEditor(); // active graph: result-type toggle inside a drill-in
  const area = getActiveArea();
  const out = node.outputs.result;
  if (out) out.socket = resultSocket(dim, resultAs);
  if (editor && area) await retypeOutputCables(editor, area, node.id, "result");

  if (area) await area.update("node", node.id);
  await processGraph();
}

export function ResultTypeToggle({ node, dim }: { node: Producer; dim: ResultDim }) {
  const [resultAs, setResultAs] = useState<ResultType>(node.resultAs);
  useEffect(() => { setResultAs(node.resultAs); }, [node.resultAs]);

  return (
    <SegToggle arg
      value={resultAs}
      options={RESULT_TYPE_OPTIONS}
      onChange={(next) => { setResultAs(next); void applyResultAs(node, dim, next); }}
    />
  );
}
