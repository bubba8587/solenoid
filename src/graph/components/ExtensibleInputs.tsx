import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { getEditor, getArea, processGraph, bumpConnectionVersion, pushHistory } from "../process";
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

// The rows an add/remove gesture touches must be UNDOABLE alongside the
// connection add/removes the classic history preset already records — without
// this, Ctrl+Z after removing a WIRED row re-added the cable into an input key
// that no longer existed (a ghost cable until reload, then a silent drop).
// Generic over every extensible node: undo re-adds the very same
// `ClassicPreset.Input` OBJECTS (socket type + label survive by identity) and
// restores the node's original input-key ORDER (positional nodes — CHOOSE —
// change meaning if rows reorder). Call BEFORE the rows are actually removed,
// and AFTER the connection removals, so undo pops row-restore first and the
// cable re-add that follows lands on a live socket.
type RowHost = {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket; label?: string } | undefined>;
};
function refreshAfterRowChange(node: RowHost): void {
  void getArea()?.update("node", node.id);
  bumpConnectionVersion();
  void processGraph();
}
export function pushRowRemovalUndo(node: RowHost, keys: string[], removeAgain: () => void): void {
  const saved = keys
    .map((k) => [k, node.inputs[k]] as const)
    .filter((e): e is [string, NonNullable<RowHost["inputs"][string]>] => !!e[1]);
  if (saved.length === 0) return;
  const order = Object.keys(node.inputs);
  pushHistory(
    () => {
      const n = node as unknown as { addInput: (key: string, input: unknown) => void };
      for (const [k, input] of saved) if (!node.inputs[k]) n.addInput(k, input);
      // Restore insertion order by re-slotting every key (the Input objects
      // themselves are untouched, so live cables keep their endpoints).
      const rec = node.inputs as Record<string, unknown>;
      for (const k of order) {
        if (k in rec) { const v = rec[k]; delete rec[k]; rec[k] = v; }
      }
      refreshAfterRowChange(node);
    },
    () => {
      removeAgain();
      refreshAfterRowChange(node);
    },
  );
}
/** The inverse for "+ Add": call AFTER adding, with the fresh key(s) — a
 *  paired node passes both halves so the whole pair is ONE undo entry. */
export function pushRowAddUndo(node: RowHost, keys: string[], removeIt: () => void): void {
  const saved = keys
    .map((k) => [k, node.inputs[k]] as const)
    .filter((e): e is [string, NonNullable<RowHost["inputs"][string]>] => !!e[1]);
  if (saved.length === 0) return;
  pushHistory(
    () => {
      removeIt();
      refreshAfterRowChange(node);
    },
    () => {
      const n = node as unknown as { addInput: (k: string, i: unknown) => void };
      for (const [k, input] of saved) if (!node.inputs[k]) n.addInput(k, input);
      refreshAfterRowChange(node);
    },
  );
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
    const key = node.addValueInput();
    pushRowAddUndo(node, [key], () => node.removeValueInput(key));
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
    // AFTER the connection removals (undo restores the row before the cable),
    // BEFORE the removal itself (captures the live Input object + key order).
    pushRowRemovalUndo(node, [key], () => node.removeValueInput(key));
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
        const dt = input.socket instanceof SolenoidSocket ? input.socket.dataType : undefined;
        // A list-typed row (List Input's numlist) is typed as a CSV of numbers in
        // the same text field a string row uses; the node parses it.
        const isTextField = dt === "string" || dt === "numlist";
        return (
          <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={input.socket}>
            {isConn ? (
              <span className="solenoid-node__io-wired" style={{ flex: 1 }} title="Driven by an incoming cable">↩ wired</span>
            ) : isTextField ? (
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
