import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { getEditor, getArea, processGraph, bumpConnectionVersion } from "../process";
import { collapseStore } from "../collapseStore";
import { SolenoidSocket } from "../sockets";
import {
  useConnectedInputs,
  InlineInputs,
  InlineNumberField,
  InlineTextField,
} from "./inlineInput";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import "./nodeCard.css";

/**
 * A node with a variable number of value inputs the user can add/remove,
 * where each value can also be typed directly into the node. Implemented
 * by the node class (see ListInputNode).
 */
export interface ExtensibleNode {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket; label?: string } | undefined>;
  // A node has one or the other depending on its value type: number rows bind
  // to `literals`, string rows (Concat) to `stringLiterals`.
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  addValueInput: () => string;
  removeValueInput: (key: string) => void;
}

/**
 * Reusable renderer for extensible value inputs: one editable row per
 * input (socket + literal field + remove ×) plus a "+ Add" button. Use
 * this for nodes that take an arbitrary number of distinct values that
 * can be defined in-node (List, future Concat, etc.). For arbitrary
 * inputs that can't be defined in-node (e.g. multiple arrays), use a
 * single pill/multi-connection socket instead — not this.
 *
 * Each input dot centers on its own row (see .solenoid-node__io-row), so the
 * rows can sit anywhere in the body — no fixed header-offset assumption.
 */
export function ExtensibleInputs({
  node, emit, leadingKeys, valueKeys,
}: {
  node: ExtensibleNode;
  emit: RenderEmit<ClassicScheme>;
  // Fixed inputs rendered (label + field, no remove) ABOVE the extensible rows —
  // e.g. CHOOSE's `index`. Rendered via InlineInputs so they get the standard
  // label/wired/field treatment. Default: none.
  leadingKeys?: string[];
  // Which input keys are the removable value rows. Default: all inputs (the
  // List/Concat case, where every input is a value row).
  valueKeys?: string[];
}) {
  const connected = useConnectedInputs(node.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(node.id));
  const literals = (node.literals ??= {});
  const strLiterals = (node.stringLiterals ??= {});
  const leading = leadingKeys ?? [];
  const keys = valueKeys ?? Object.keys(node.inputs);
  const allKeys = [...leading, ...keys];

  async function setLiteral(key: string, v: number | undefined) {
    if (v === undefined) delete literals[key];
    else literals[key] = v;
    await processGraph();
  }

  async function setStr(key: string, v: string) {
    strLiterals[key] = v;
    await processGraph();
  }

  async function addRow() {
    node.addValueInput();
    await getArea()?.update("node", node.id);
    await processGraph();
  }

  async function removeRow(key: string) {
    const editor = getEditor();
    if (editor) {
      for (const c of editor.getConnections()) {
        if (c.target === node.id && c.targetInput === key) await editor.removeConnection(c.id);
      }
    }
    node.removeValueInput(key);
    await getArea()?.update("node", node.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processGraph();
  }

  // Collapsed: ≥2 inputs aggregate into a single pill (avoids dots
  // spilling past the small node); a lone input centers on the display
  // box (no explicit top → --out-socket-top). The pill spans fixed leading
  // inputs AND value rows so a collapsed CHOOSE shows one combined pill.
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
      {keys.map((key) => {
        const input = node.inputs[key];
        if (!input) return null;
        const isConn = connected.has(key);
        const isStr = input.socket instanceof SolenoidSocket && input.socket.dataType === "string";
        return (
          <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={input.socket}>
            {isConn ? (
              <span className="solenoid-node__io-wired" style={{ flex: 1 }} title="Driven by an incoming cable">↩ wired</span>
            ) : isStr ? (
              <InlineTextField value={strLiterals[key]} onChange={(v) => setStr(key, v)} />
            ) : (
              <InlineNumberField value={literals[key]} onChange={(v) => setLiteral(key, v)} />
            )}
            {keys.length > 1 && (
              <button
                type="button"
                className="solenoid-node__row-remove"
                title="Remove input"
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
        + Add
      </button>
    </>
  );
}
