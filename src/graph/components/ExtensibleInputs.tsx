import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { processGraph, bumpConnectionVersion, pushHistory } from "../process";
import { getActiveArea } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import { SolenoidSocket } from "../sockets";
import {
  useConnectedInputs,
  useIncomingSources,
  InlineInputs,
  InlineNumberField,
  InlineTextField,
} from "./inlineInput";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import "./nodeCard.css";
import { dropInputCables } from "./cablePrune";

/** A node with a variable number of value inputs the user can add/remove, where each
 *  value can also be typed directly into the node (see ListInputNode). */
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

// Row add/removes must be UNDOABLE alongside the connection add/removes the classic
// history preset records, or Ctrl+Z re-adds a cable into an input key that no longer
// exists. Undo re-adds the very same `ClassicPreset.Input` OBJECTS (socket type +
// label survive by identity) and restores the input-key ORDER (positional nodes like
// CHOOSE change meaning if rows reorder). Call BEFORE the rows are removed and AFTER
// the connection removals, so undo pops row-restore first and the cable re-add that
// follows lands on a live socket.
type RowHost = {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket; label?: string } | undefined>;
};
function refreshAfterRowChange(node: RowHost): void {
  void getActiveArea()?.update("node", node.id);
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

/** Reusable renderer for extensible value inputs. Use it for nodes taking an
 *  arbitrary number of DISTINCT values definable in-node; for interchangeable inputs
 *  that can't be defined in-node use a single multi-connection socket instead.
 *  Each input dot centers on its own row, so rows can sit anywhere in the body. */
export function ExtensibleInputs({
  node, emit, leadingKeys, valueKeys, minRows = 1,
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
  // The fewest rows the remove button leaves standing. Value nodes keep 1 (a
  // List with zero rows is nothing); an OPTIONAL group (Frame Input's λ
  // inputs) passes 0 so the last row can go too.
  minRows?: number;
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
    await processGraph();
  }

  async function setStr(key: string, v: string) {
    strLiterals[key] = v;
    await processGraph();
  }

  async function addRow() {
    const key = node.addValueInput();
    pushRowAddUndo(node, [key], () => node.removeValueInput(key));
    await getActiveArea()?.update("node", node.id);
    await processGraph();
  }

  async function removeRow(key: string) {
    await dropInputCables(node.id, [key]);
    // AFTER the connection removals (undo restores the row before the cable),
    // BEFORE the removal itself (captures the live Input object + key order).
    pushRowRemovalUndo(node, [key], () => node.removeValueInput(key));
    node.removeValueInput(key);
    await getActiveArea()?.update("node", node.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processGraph();
  }

  // Collapsed: ≥2 inputs aggregate into one pill (dots would spill past the small
  // node); a lone input centers on the display box (no explicit top →
  // --out-socket-top). The pill spans leading inputs AND value rows.
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
        const dt = input.socket instanceof SolenoidSocket ? input.socket.dataType : undefined;
        // A list-typed row is typed as CSV in the same text field a string row uses;
        // the node parses it per element type.
        const isTextField = dt === "string" || dt === "numlist" || dt === "strlist" || dt === "datelist" || dt === "logicallist";
        // A container-typed row is WIRE-ONLY — a typed literal has no meaning for a
        // list/table/frame operand. Unwired it shows its position (order = stack
        // order); wired it names the incoming node. Logical operands are wire-only
        // too, matching IfNode; a number still bridges in via the socket.
        const isWireOnly = dt === "anylist" || dt === "anytable" || dt === "table" || dt === "frame" || dt === "cube" || dt === "logicalcombo" || dt === "lambda";
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
            ) : isTextField ? (
              <InlineTextField value={strLiterals[key]} onChange={(v) => setStr(key, v)} />
            ) : (
              <InlineNumberField value={literals[key]} onChange={(v) => setLiteral(key, v)} />
            )}
            {keys.length > minRows && (
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
