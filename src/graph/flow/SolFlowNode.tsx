// React Flow port — the generic FALLBACK card (C0's throwaway visuals): used
// only when a node type has no registered component. Values come from
// cableValueStore, which processGraph fills on every pass.
import { memo, useSyncExternalStore } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps, Node } from "@xyflow/react";
import { ClassicPreset } from "rete";
import { SolenoidSocket, SOCKET_COLORS, SOCKET_TYPE_LABELS } from "../sockets";
import { cableValueStore } from "../cableValueStore";
import { previewValue } from "./preview";
import type { FlowNodeData } from "./SolNodeAdapter";

type Port = { socket?: ClassicPreset.Socket; label?: string; index?: number };

function portRows(ports: Record<string, Port | undefined>): [string, Port][] {
  return (Object.entries(ports).filter(([, p]) => p) as [string, Port][]).sort(
    (a, b) => (a[1].index ?? 1e9) - (b[1].index ?? 1e9),
  );
}

function dotStyle(p: Port): React.CSSProperties {
  const dt = p.socket instanceof SolenoidSocket ? p.socket.dataType : null;
  return { background: dt ? SOCKET_COLORS[dt] : "var(--sock-any, #999)" };
}

function dotTitle(p: Port): string | undefined {
  const dt = p.socket instanceof SolenoidSocket ? p.socket.dataType : null;
  return dt ? SOCKET_TYPE_LABELS[dt] : undefined;
}

function SolFlowNodeBase({ data, selected }: NodeProps<Node<FlowNodeData, "sol">>) {
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  const node = data.node as unknown as {
    id: string;
    label?: string;
    inputs: Record<string, Port | undefined>;
    outputs: Record<string, Port | undefined>;
    constructor: { name: string };
  };
  const inputs = portRows(node.inputs);
  const outputs = portRows(node.outputs);
  return (
    <div className={`sol-rf-card${selected ? " sol-rf-card--selected" : ""}`}>
      <div className="sol-rf-card__header">
        <span className="sol-rf-card__label">{node.label ?? node.constructor.name}</span>
      </div>
      <div className="sol-rf-card__body">
        {inputs.map(([key, p]) => (
          <div key={`in-${key}`} className="sol-rf-row sol-rf-row--in">
            <Handle
              type="target"
              position={Position.Left}
              id={key}
              className="sol-rf-handle sol-rf-handle--in"
              style={dotStyle(p)}
              title={dotTitle(p)}
            />
            <span className="sol-rf-row__label">{p.label ?? key}</span>
          </div>
        ))}
        {outputs.map(([key, p]) => (
          <div key={`out-${key}`} className="sol-rf-row sol-rf-row--out">
            <span className="sol-rf-row__label">{p.label ?? key}</span>
            <span className="sol-rf-row__value">
              {previewValue(cableValueStore.get(node.id, key))}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={key}
              className="sol-rf-handle sol-rf-handle--out"
              style={dotStyle(p)}
              title={dotTitle(p)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const SolFlowNode = memo(SolFlowNodeBase);
