// [[C28]] literalsIffEditable
import type { Emit } from "./nodeKit";
import { useSyncExternalStore } from "react";
import type { GraphSocket } from "../graphModel";
import { processEdited } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getOwningView } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import { literalFieldOf } from "../literalFields";
import {
  useConnectedInputs,
  useIncomingSources,
  InlineInputs,
  InlineNumberField,
  InlineTextField,
  KeyedField,
  LogicalCheck,
  type KeyedKind,
} from "./inlineInput";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import "./nodeCard.css";
import { dropInputCables } from "./cablePrune";

export interface ExtensibleNode {
  id: string;
  edited(): void;
  inputs: Record<string, { socket: GraphSocket; label?: string } | undefined>;
  // Number rows bind to `literals`, string rows to `stringLiterals`.
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  literalKinds?: Record<string, KeyedKind>;
  addValueInput: () => string;
  removeValueInput: (key: string) => void;
}

/** For distinct in-node values; interchangeable inputs take one multi-connection socket instead. */
export function ExtensibleInputs({
  node, emit, leadingKeys, valueKeys, minRows = 1, addLabel = "Add",
}: {
  node: ExtensibleNode;
  emit: Emit;
  leadingKeys?: string[];
  valueKeys?: string[];
  // The fewest rows the remove button leaves; an optional group passes 0.
  minRows?: number;
  addLabel?: string;
}) {
  const connected = useConnectedInputs(node.id);
  const incoming = useIncomingSources(node.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(node.id));
  const literals = (node.literals ??= {});
  const strLiterals = (node.stringLiterals ??= {});
  const leading = leadingKeys ?? [];
  const keys = valueKeys ?? Object.keys(node.inputs);
  const allKeys = [...leading, ...keys];

  async function setLiteral(key: string, v: number | undefined) {
    if (v === undefined) delete literals[key];
    else literals[key] = v;
    await processEdited(node.id);
  }

  async function setStr(key: string, v: string) {
    strLiterals[key] = v;
    await processEdited(node.id);
  }

  async function addRow() {
    node.addValueInput();
    await getOwningView(node.id)?.rerenderNode(node.id);
    await processEdited(node.id, [], { topology: true });
  }

  async function removeRow(key: string) {
    await dropInputCables(node.id, [key]);
    node.removeValueInput(key);
    await getOwningView(node.id)?.rerenderNode(node.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processEdited(node.id, [], { topology: true });
  }

  if (collapsed) {
    if (allKeys.length >= 2) {
      return <CollapsedInputPill node={node} emit={emit} keys={allKeys} />;
    }
    return (
      <>
        {allKeys.map((key) => {
          const input = node.inputs[key];
          return input ? (
            <NodeSocket
              key={key}
              side="input"
              socketKey={key}
              nodeId={node.id}
              emit={emit}
              payload={input.socket}
            />
          ) : null;
        })}
      </>
    );
  }

  return (
    <>
      {leading.length > 0 && <InlineInputs node={node} emit={emit} keys={leading} />}
      {keys.map((key, rowIdx) => {
        const input = node.inputs[key];
        if (!input) return null;
        const isConn = connected.has(key);
        // One field per input, the one the core reads; a wire-only row shows its number.
        const field = literalFieldOf(node, key);
        const isWireOnly = field === "none";
        return (
          <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={input.socket}>
            {isWireOnly ? (
              isConn ? (
                <span className="solenoid-node__io-wired" style={{ flex: 1 }} title="Driven by the incoming cable named here">↩ {incoming.get(key)?.label || "wired"}</span>
              ) : (
                <span className="solenoid-node__io-label" style={{ flex: 1 }}>{rowIdx + 1}</span>
              )
            ) : isConn ? (
              <span className="solenoid-node__io-wired" style={{ flex: 1 }} title="Driven by an incoming cable">↩ wired</span>
            ) : field === "keyed" ? (
              <KeyedField node={node} slot={key} />
            ) : field === "logical" ? (
              <LogicalCheck checked={!!literals[key]} onToggle={() => void setLiteral(key, literals[key] ? 0 : 1)} />
            ) : field === "number" ? (
              <InlineNumberField value={literals[key]} onChange={(v) => setLiteral(key, v)} />
            ) : (
              <InlineTextField value={strLiterals[key]} onChange={(v) => setStr(key, v)} />
            )}
            {keys.length > minRows && (
              <button
                type="button"
                className="solenoid-node__row-remove"
                title="Remove this input"
                onClick={(e) => { e.stopPropagation(); void removeRow(key); }}
              >
                ×
              </button>
            )}
          </MeasuredSocketRow>
        );
      })}
      <button
        type="button"
        className="solenoid-node__add-input"
        onClick={(e) => { e.stopPropagation(); void addRow(); }}
      >
        {addLabel}
      </button>
    </>
  );
}
