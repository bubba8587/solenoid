// [[B11]] maximalMerge: the result-type toggle is an in-place socket retype, so it must reconcile.
import { useEffect, useState } from "react";
import type { GraphSocket } from "../graphModel";
import { resultSocket, RESULT_TYPE_META, type ResultType, type ResultDim } from "../nodes/shared";
import { processGraph } from "../process";
import { getOwningView, getOwningEditor } from "../activeGraph";
import { retypeOutputCables } from "../fcReconcile";
import { SegToggle } from "./SegToggle";
import { TypeIcon } from "./TypeIcon";

type Producer = {
  id: string;
  edited(): void;
  resultAs: ResultType;
  /** The family the last run computed, which Auto takes ([[C136]] typesKnownAfterCalc). */
  lastResultFamily?: string;
  outputs: { result?: { socket: GraphSocket } };
};

const isResultType = (f: string | undefined): f is ResultType => f === "number" || f === "text" || f === "date";

const RESULT_TYPE_OPTIONS = (Object.keys(RESULT_TYPE_META) as ResultType[]).map((value) => ({
  value,
  label: value === "auto" ? RESULT_TYPE_META[value].label : <TypeIcon type={value} />,
  title: RESULT_TYPE_META[value].title,
}));

async function applyResultAs(node: Producer, dim: ResultDim, resultAs: ResultType): Promise<void> {
  if (node.resultAs === resultAs) return;
  node.resultAs = resultAs;

  const editor = getOwningEditor(node.id); // active graph: result-type toggle inside a drill-in
  const view = getOwningView(node.id);
  const out = node.outputs.result;
  const family = resultAs === "auto" && isResultType(node.lastResultFamily) ? node.lastResultFamily : resultAs;
  if (out) out.socket = resultSocket(dim, family);
  if (editor && view) await retypeOutputCables(editor, view, node.id, "result");

  if (view) await view.rerenderNode(node.id);
  node.edited(); await processGraph();
}

export function ResultTypeToggle({ node, dim }: { node: Producer; dim: ResultDim }) {
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
