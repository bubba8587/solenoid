// [[C47]] equationNode, [[C11]] socketBox12
import { useRef, useState, useLayoutEffect, type ReactNode } from "react";
import type { EquationNode as EquationNodeType } from "../rete-nodes";
import { NodeShell, ValueDisplay, type NodeProps, type Emit } from "./nodeKit";
import { NodeSocket } from "./NodeSocket";
import { FormulaField } from "./FormulaField";
import { formulaPopup } from "../formulaPopupStore";
import type { DisplayValue } from "./valueDisplayFormat";
import "./ExpressionNode.css";

// Two sockets centered on the hero value box, not the row; the row must not become a positioning context.
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

export interface AcausalRowNode {
  id: string;
  inputs: Partial<Record<string, { socket: import("rete").ClassicPreset.Socket }>>;
  outputs: Partial<Record<string, { socket: import("rete").ClassicPreset.Socket }>>;
}

// `--output` keeps the rows visible when collapsed.
export function EquationVarRow({
  node, emit, varKey, value, solved, label, desc,
}: {
  node: AcausalRowNode;
  emit: Emit;
  varKey: string;
  value: DisplayValue;
  solved: boolean;
  label?: string;
  desc?: string;
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
        title={desc || (solved ? "Solved from the other variables" : undefined)}
      >
        {label ?? varKey}
      </span>
      <ValueDisplay value={value} socketKey={varKey} />
    </div>
  );
}

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
      <ValueDisplay value={value} socketKey={socketKey} />
    </div>
  );
}

export function EquationComponent({ data: node, emit, config }: NodeProps<EquationNodeType> & {
  /** A control row between the formula box and the variable rows (TVM's payment timing). */
  config?: ReactNode;
}) {
  return (
    <NodeShell node={node} emit={emit} hideOutputSockets>
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
          desc={node.varDescriptions[v] || undefined}
        />
      ))}
      <EquationOutRow node={node} emit={emit} socketKey="holds" label="Check" value={node.cachedHolds as DisplayValue} />
    </NodeShell>
  );
}
