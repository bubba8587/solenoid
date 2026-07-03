import type { CompositeNode as CompositeNodeType } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import type { DisplayValue } from "./valueDisplayFormat";

// The Composite card: an editable title (NodeShell), one row per exposed
// input (InlineInputs — reuses the generic input-row renderer off
// node.inputs; every port socket is `any`, so a row is socket+label, or a
// "↩ <source>" marker once wired), and one row per output (custom, since
// ValueDisplay doesn't know about frame/cube previews — a v1 gap noted below).
export function CompositeComponent({ data: node, emit }: NodeProps<CompositeNodeType>) {
  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="Composite" hideOutputSockets>
      <InlineInputs node={node} emit={emit} />
      {node.outputPorts.map((p) => {
        const port = node.outputs[p.id];
        if (!port) return null;
        const value = node.cachedOutputs[p.id] ?? null;
        return (
          <MeasuredSocketRow key={p.id} side="output" socketKey={p.id} nodeId={node.id} emit={emit} payload={port.socket}>
            <span className="solenoid-node__io-label">{p.label}</span>
            {/* Scalar/list/error/logical render correctly; a frame/cube output
                falls back to a plain object stringification — a known gap for
                the shell milestone (frame-holding composites are a follow-up). */}
            <ValueDisplay value={value as unknown as DisplayValue} />
          </MeasuredSocketRow>
        );
      })}
      {node.inputPorts.length === 0 && node.outputPorts.length === 0 && (
        <div className="solenoid-node__text-empty">no ports</div>
      )}
    </NodeShell>
  );
}
