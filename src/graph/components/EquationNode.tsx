import { useRef, useState, useLayoutEffect, type ReactNode } from "react";
import type { EquationNode as EquationNodeType } from "../rete-nodes";
import { NodeShell, ValueDisplay, type NodeProps, type Emit } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { FormulaField } from "./FormulaField";
import { formulaPopup } from "../formulaPopupStore";
import type { DisplayValue } from "./valueDisplayFormat";
import "./ExpressionNode.css";

// Same measurement as MeasuredSocketRow's hook (NodeSocket.tsx): the row's
// vertical center relative to .solenoid-node__content, so the dots stay
// header-independent. Local copy because this row carries TWO sockets — the
// variable's input on the left edge and its output on the right — which the
// single-socket MeasuredSocketRow can't.
function useRowTop(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const prev = useRef<number | undefined>(undefined);
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const t = el.offsetTop + el.offsetHeight / 2 - 6;
    if (prev.current !== t) { prev.current = t; setTop(t); }
  });
  return top;
}

// One variable = one hero row: label, value box (chips for lists, error badge
// for #CODE!), input socket on the left edge and output socket on the right —
// the acausal card in miniature. The `--output` modifier keeps the rows visible
// when the node is collapsed.
function EquationVarRow({
  node, emit, varKey, value, solved,
}: {
  node: EquationNodeType;
  emit: Emit;
  varKey: string;
  value: DisplayValue;
  solved: boolean;
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
        {varKey}
      </span>
      <ValueDisplay value={value} />
    </div>
  );
}

export function EquationComponent({ data: node, emit, config }: NodeProps<EquationNodeType> & {
  /** Extra control row a subclass card slots between the formula box and the
   *  variable rows (the TVM node's payment-timing dropdown). */
  config?: ReactNode;
}) {
  const checkRef = useRef<HTMLDivElement>(null);
  const checkTop = useRowTop(checkRef);
  const checkPort = node.outputs.holds;

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
      <div ref={checkRef} className="solenoid-node__io-row solenoid-node__io-row--output solenoid-node__io-row--hero solenoid-eq__var-row">
        {checkTop !== undefined && checkPort && (
          <NodeSocket side="output" socketKey="holds" nodeId={node.id} emit={emit} payload={checkPort.socket} top={checkTop} />
        )}
        <span className="solenoid-node__io-label">Check</span>
        <ValueDisplay value={node.cachedHolds as DisplayValue} />
      </div>
    </NodeShell>
  );
}
