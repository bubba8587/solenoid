import { useRef, useState, useLayoutEffect, type ReactNode } from "react";
import type { EquationNode as EquationNodeType } from "../rete-nodes";
import { NodeShell, ValueDisplay, type NodeProps, type Emit } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { FormulaField } from "./FormulaField";
import { formulaPopup } from "../formulaPopupStore";
import type { DisplayValue } from "./valueDisplayFormat";
import "./ExpressionNode.css";

// Same measurement idea as MeasuredSocketRow's hook (NodeSocket.tsx) — a
// center relative to .solenoid-node__content, so the dots stay
// header-independent. Local copy because this row carries TWO sockets — the
// variable's input on the left edge and its output on the right — which the
// single-socket MeasuredSocketRow can't. Unlike that hook it centers on the
// HERO VALUE BOX, not the row: the label sits stacked ABOVE the box inside the
// row, so the row's own center would land between label and box. The box's
// offsetParent is the content wrapper (the row is deliberately NOT a
// positioning context), so its offsetTop is already content-relative.
function useRowTop(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const prev = useRef<number | undefined>(undefined);
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.querySelector<HTMLElement>(".solenoid-node__display-value") ?? el;
    const t = box.offsetTop + box.offsetHeight / 2 - 6;
    if (prev.current !== t) { prev.current = t; setTop(t); }
  });
  return top;
}

// The structural slice of a node these rows need — any acausal card (Equation,
// TVM, the Triangle Solver) satisfies it.
export interface AcausalRowNode {
  id: string;
  inputs: Partial<Record<string, { socket: import("rete").ClassicPreset.Socket }>>;
  outputs: Partial<Record<string, { socket: import("rete").ClassicPreset.Socket }>>;
}

// One variable = one hero row: label, value box (chips for lists, error badge
// for #CODE!), input socket on the left edge and output socket on the right —
// the acausal card in miniature. The `--output` modifier keeps the rows visible
// when the node is collapsed. Shared by every acausal card (Equation, TVM,
// Triangle Solver) — the CURRENT Equation design, don't rebuild it per node.
export function EquationVarRow({
  node, emit, varKey, value, solved, label,
}: {
  node: AcausalRowNode;
  emit: Emit;
  varKey: string;
  value: DisplayValue;
  solved: boolean;
  /** Display label; defaults to the socket key. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowTop(ref);
  const inPort = node.inputs[varKey];
  const outPort = node.outputs[varKey];
  return (
    <div ref={ref} className="solenoid-node__io-row solenoid-node__io-row--output solenoid-node__io-row--hero solenoid-eq__var-row">
      {top !== undefined && inPort && (
        <NodeSocket side="input" socketKey={varKey} nodeId={node.id} emit={emit} payload={inPort.socket} top={top} />
      )}
      {top !== undefined && outPort && (
        <NodeSocket side="output" socketKey={varKey} nodeId={node.id} emit={emit} payload={outPort.socket} top={top} />
      )}
      <span
        className="solenoid-node__io-label"
        style={solved ? { color: "var(--node-accent)" } : undefined}
        title={solved ? "Solved from the other variables" : undefined}
      >
        {label ?? varKey}
      </span>
      <ValueDisplay value={value} />
    </div>
  );
}

// A single-OUTPUT hero row measured the same way — the Check row, and the
// derived rows on acausal cards (Triangle Solver's Area / Perimeter / Valid).
export function EquationOutRow({
  node, emit, socketKey, label, value,
}: {
  node: AcausalRowNode;
  emit: Emit;
  socketKey: string;
  label: string;
  value: DisplayValue;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useRowTop(ref);
  const port = node.outputs[socketKey];
  return (
    <div ref={ref} className="solenoid-node__io-row solenoid-node__io-row--output solenoid-node__io-row--hero solenoid-eq__var-row">
      {top !== undefined && port && (
        <NodeSocket side="output" socketKey={socketKey} nodeId={node.id} emit={emit} payload={port.socket} top={top} />
      )}
      <span className="solenoid-node__io-label">{label}</span>
      <ValueDisplay value={value} />
    </div>
  );
}

export function EquationComponent({ data: node, emit, config }: NodeProps<EquationNodeType> & {
  /** Extra control row a subclass card slots between the formula box and the
   *  variable rows (the TVM node's payment-timing dropdown). */
  config?: ReactNode;
}) {
  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="Equation" hideOutputSockets>
      {/* The relation, KaTeX-rendered; sockets derive from its variables. Clicking
          opens the formula popup — the same syntax-highlighted editor Expression
          uses. No "=" prefix: the equation text carries its own. */}
      <FormulaField
        value={node.expr}
        onChange={() => {}}
        placeholder="V = I * R"
        locked={node.locked}
        noPrefix
        onOpen={() => formulaPopup.open(node.id)}
      />
      {config}
      {node.cachedError && (
        <div className="solenoid-expr__error">{node.cachedError}</div>
      )}
      {node.varNames.map((v) => (
        <EquationVarRow
          key={v}
          node={node}
          emit={emit}
          varKey={v}
          value={(node.cachedValues[v] ?? null) as DisplayValue}
          solved={node.solvedFor === v}
        />
      ))}
      <EquationOutRow node={node} emit={emit} socketKey="holds" label="Check" value={node.cachedHolds as DisplayValue} />
    </NodeShell>
  );
}
