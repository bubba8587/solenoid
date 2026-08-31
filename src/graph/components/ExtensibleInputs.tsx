import type { Emit } from "./nodeKit";
import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getActiveView } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import { SolenoidSocket } from "../sockets";
import {
  useConnectedInputs,
  useIncomingSources,
  InlineInputs,
  InlineNumberField,
  InlineTextField,
  InlineAutoField,
  takesAutoLiteral,
  type AutoLiteral,
} from "./inlineInput";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import "./nodeCard.css";
import { dropInputCables } from "./cablePrune";

/** Variable-arity value inputs whose values can also be typed directly into the node. */
export interface ExtensibleNode {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket; label?: string } | undefined>;
  // One or the other: number rows bind to `literals`, string rows to `stringLiterals`.
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  /** See `takesAutoLiteral` — a wildcard row takes a number OR text. */
  autoLiterals?: boolean;
  addValueInput: () => string;
  removeValueInput: (key: string) => void;
}

/** For an arbitrary number of DISTINCT in-node values; interchangeable inputs take a
 *  single multi-connection socket instead. Each input dot centers on its own row. */
export function ExtensibleInputs({
  node, emit, leadingKeys, valueKeys, minRows = 1, addLabel = "+ Add",
}: {
  node: ExtensibleNode;
  emit: Emit;
  // Fixed inputs (no remove) rendered ABOVE the extensible rows — e.g. CHOOSE's `index`.
  leadingKeys?: string[];
  // The removable value rows. Default: all inputs (List/Concat, where every input is one).
  valueKeys?: string[];
  // The fewest rows the remove button leaves standing; an OPTIONAL group passes 0.
  minRows?: number;
  // The add-row button's text; names what a row IS on nodes where it isn't a plain value
  // (Frame Input's rows are λ column-sources, so it reads "+ Add lambda").
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
    await processGraph();
  }

  async function setStr(key: string, v: string) {
    strLiterals[key] = v;
    await processGraph();
  }

  async function setAuto(key: string, v: AutoLiteral) {
    // Exactly one map holds a wildcard slot, so the reader never has to break a tie.
    delete literals[key];
    delete strLiterals[key];
    if (typeof v === "number") literals[key] = v;
    else if (typeof v === "string") strLiterals[key] = v;
    await processGraph();
  }

  async function addRow() {
    node.addValueInput();
    await getActiveView()?.rerenderNode(node.id);
    await processGraph();
  }

  async function removeRow(key: string) {
    await dropInputCables(node.id, [key]);
    node.removeValueInput(key);
    await getActiveView()?.rerenderNode(node.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processGraph();
  }

  // Collapsed: ≥2 inputs aggregate into one pill (dots would spill past the small node);
  // a lone input centers on the display box.
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
        // A list-typed row is typed as CSV in the same text field a string row uses.
        const isTextField = dt === "string" || dt === "numlist" || dt === "strlist" || dt === "datelist" || dt === "logicallist";
        // A container-typed row is WIRE-ONLY — a typed literal has no meaning for a
        // list/table/frame operand. Logical operands are wire-only too, matching IfNode.
        const isWireOnly = dt === "anylist" || dt === "anytable" || dt === "table" || dt === "frame" || dt === "cube" || dt === "logicalcombo" || dt === "lambda" || dt === "chart";
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
            ) : takesAutoLiteral(node, dt) ? (
              <InlineAutoField num={literals[key]} text={strLiterals[key]} onChange={(v) => void setAuto(key, v)} />
            ) : isTextField ? (
              <InlineTextField value={strLiterals[key]} onChange={(v) => setStr(key, v)} />
            ) : (
              <InlineNumberField value={literals[key]} onChange={(v) => setLiteral(key, v)} />
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
