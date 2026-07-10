import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  MapTableNode as MapTableNodeType,
  ByAxisNode as ByAxisNodeType, ByAxis,
  MakeArrayNode as MakeArrayNodeType,
  ReduceLambdaNode as ReduceLambdaNodeType,
  ScanLambdaNode as ScanLambdaNodeType,
} from "../rete-nodes";
import { isLambdaValue, formatLambda } from "../nodes/lambda";
import { processGraph } from "../process";
import { formulaPopup } from "../formulaPopupStore";
import { cableValueStore } from "../cableValueStore";
import { InlineInputs, useIncomingSources } from "./inlineInput";
import { FormulaField } from "./FormulaField";
import { TableDisplay } from "./TableDisplay";
import { ResultTypeToggle } from "./ResultTypeToggle";
import { NodeShell, ValueDisplay, OpSelect, useNodeField, type NodeProps } from "./nodeKit";
import type { SolError } from "../errorValue";
import "./ExpressionNode.css";

// cachedResult on these nodes is value-polymorphic (number | string | their
// lists/matrices | error); the display components already branch on each shape.
type ScalarVal = number | string | SolError | null;
type ListVal = number[] | string[] | SolError | null;

// The LAMBDA-family formula is edited in the roomy box below (or the big
// FormulaPopup); a wired LAMBDA value supersedes it. The old piped-formula
// string socket was removed 2026-07-09. Variables are fixed per node — a
// small hint names them.

const FORMULA_KEYS = new Set(["lambda"]);

type FormulaNode = { id: string; stringLiterals: Record<string, string> };

/** Formula editor bound to node.stringLiterals.formula. When a wired LAMBDA
 *  supersedes the inline text, this shows WHAT actually runs and WHO sends it
 *  instead of dimming stale text: the lambda's live signature + source label. */
function FormulaBox({ node }: { node: FormulaNode }) {
  const incoming = useIncomingSources(node.id);
  // Re-render when processGraph refreshes live values — the wired lambda's
  // signature can change without a topology change.
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  const lambdaSrc = incoming.get("lambda");
  const [val, setVal] = useState(node.stringLiterals.formula ?? "");

  useEffect(() => {
    if (node.stringLiterals.formula !== val) setVal(node.stringLiterals.formula ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.stringLiterals.formula]);

  async function onChange(next: string) {
    setVal(next);
    node.stringLiterals.formula = next;
    await processGraph();
  }

  if (lambdaSrc) {
    const live = cableValueStore.get(lambdaSrc.sourceId, lambdaSrc.sourceOutput);
    const sig = isLambdaValue(live) ? formatLambda(live) : "λ";
    return (
      <div
        className="solenoid-expr__override"
        title="Runs the wired lambda; parameters bind positionally"
      >
        <span className="solenoid-expr__override-sig">{sig}</span>
        <span className="solenoid-expr__override-src">↩ {lambdaSrc.label || "wired"}</span>
      </div>
    );
  }

  return (
    <FormulaField value={val} onChange={onChange} onOpen={() => formulaPopup.open(node.id)} />
  );
}

function FormulaError({ msg }: { msg: string | null }) {
  return msg ? <div className="solenoid-expr__error">{msg}</div> : null;
}

// ─── MAP ──────────────────────────────────────────────────────────────────────

export function MapTableComponent({ data, emit }: NodeProps<MapTableNodeType>) {
  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="MAP">
      <InlineInputs node={data} emit={emit} cableOnlyKeys={FORMULA_KEYS} mathLabelKeys={FORMULA_KEYS} />
      <FormulaBox node={data} />
      <ResultTypeToggle node={data} dim="matrix" />
      <TableDisplay table={data.cachedResult} label={data.label} kind={data.resultAs} />
      <FormulaError msg={data.cachedError} />
    </NodeShell>
  );
}

// ─── BYROW / BYCOL ──────────────────────────────────────────────────────────────

const AXIS_OPTS: ReadonlyArray<{ value: ByAxis; label: string }> = [
  { value: "row", label: "By row" },
  { value: "col", label: "By column" },
];

export function ByAxisComponent({ data, emit }: NodeProps<ByAxisNodeType>) {
  const [axis, setAxis] = useNodeField(data, "axis");
  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="BYROW / BYCOL">
      <InlineInputs node={data} emit={emit} cableOnlyKeys={FORMULA_KEYS} mathLabelKeys={FORMULA_KEYS} />
      <OpSelect value={axis} onChange={setAxis} options={AXIS_OPTS} />
      <FormulaBox node={data} />
      <ResultTypeToggle node={data} dim="combo" />
      <ValueDisplay value={data.cachedResult as ListVal} />
      <FormulaError msg={data.cachedError} />
    </NodeShell>
  );
}

// ─── REDUCE ─────────────────────────────────────────────────────────────────────

export function ReduceLambdaComponent({ data, emit }: NodeProps<ReduceLambdaNodeType>) {
  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="REDUCE">
      <InlineInputs node={data} emit={emit} cableOnlyKeys={FORMULA_KEYS} mathLabelKeys={FORMULA_KEYS} />
      <FormulaBox node={data} />
      <ResultTypeToggle node={data} dim="scalar" />
      <ValueDisplay value={data.cachedResult as ScalarVal} />
      <FormulaError msg={data.cachedError} />
    </NodeShell>
  );
}

// ─── SCAN ───────────────────────────────────────────────────────────────────────

export function ScanLambdaComponent({ data, emit }: NodeProps<ScanLambdaNodeType>) {
  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="SCAN">
      <InlineInputs node={data} emit={emit} cableOnlyKeys={FORMULA_KEYS} mathLabelKeys={FORMULA_KEYS} />
      <FormulaBox node={data} />
      <ResultTypeToggle node={data} dim="matrix" />
      <TableDisplay table={data.cachedResult} label={data.label} kind={data.resultAs} />
      <FormulaError msg={data.cachedError} />
    </NodeShell>
  );
}

// ─── MAKEARRAY ──────────────────────────────────────────────────────────────────

export function MakeArrayComponent({ data, emit }: NodeProps<MakeArrayNodeType>) {
  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="MAKEARRAY">
      <InlineInputs node={data} emit={emit} cableOnlyKeys={FORMULA_KEYS} mathLabelKeys={FORMULA_KEYS} />
      <FormulaBox node={data} />
      <ResultTypeToggle node={data} dim="matrix" />
      <TableDisplay table={data.cachedResult} label={data.label} kind={data.resultAs} />
      <FormulaError msg={data.cachedError} />
    </NodeShell>
  );
}
