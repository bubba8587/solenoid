// [[C95]] commitOnEnter, [[C28]] literalsIffEditable
import type { Emit } from "./nodeKit";
import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getActiveView } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import {
  useConnectedInputs,
  InlineInputs,
  InlineNumberField,
  InlineTextField,
  InlineAutoField,
  takesAutoLiteral,
  type AutoLiteral,
} from "./inlineInput";

const dataTypeOf = (s: ClassicPreset.Socket): string | undefined => (s as { dataType?: string }).dataType;
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import "./nodeCard.css";
import { dropInputCables } from "./cablePrune";

/** N sockets per tuple sharing one remove button: a pair is the two-element case (Filter, SUMIFS, IFS), and Set Cell uses triplets. */
export interface PairedExtensibleNode {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket; label?: string } | undefined>;
  literals?: Record<string, number>;
  valuePairKeys: () => string[][];
  addValuePair: () => void;
  /** Remove the tuple identified by its FIRST key. */
  removeValuePair: (aKey: string) => void;
  pairLabels: string[];
  stringLiterals?: Record<string, string>;
  autoLiterals?: boolean;
}

export function PairedExtensibleInputs({
  node, emit, leadingKeys, trailingKeys, rowNoun = "pair",
}: {
  node: PairedExtensibleNode;
  emit: Emit;
  leadingKeys?: string[];
  trailingKeys?: string[];
  rowNoun?: string;
}) {
  const connected = useConnectedInputs(node.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(node.id));
  const literals = (node.literals ??= {});
  const strLiterals = (node.stringLiterals ??= {});
  const leading = leadingKeys ?? [];
  const trailing = trailingKeys ?? [];
  const pairs = node.valuePairKeys();
  const allKeys = [...leading, ...pairs.flat(), ...trailing];

  async function setLiteral(key: string, v: number | undefined) {
    if (v === undefined) delete literals[key];
    else literals[key] = v;
    await processGraph();
  }

  async function setStrLiteral(key: string, v: string) {
    if (v === "") delete strLiterals[key];
    else strLiterals[key] = v;
    await processGraph();
  }

  async function setAutoLiteral(key: string, v: AutoLiteral) {
    // Exactly one map holds a wildcard slot, so the reader never has to break a tie.
    delete literals[key];
    delete strLiterals[key];
    if (typeof v === "number") literals[key] = v;
    else if (typeof v === "string") strLiterals[key] = v;
    await processGraph();
  }

  async function addPair() {
    node.addValuePair();
    await getActiveView()?.rerenderNode(node.id);
    await processGraph();
  }

  async function removePair(keys: string[]) {
    await dropInputCables(node.id, keys);
    // Prune first, then remove the tuple (tree/specs/canvas/input-cable-pruning.md).
    node.removeValuePair(keys[0]);
    await getActiveView()?.rerenderNode(node.id);
    bumpConnectionVersion(); // re-route cables on rows that shifted up
    await processGraph();
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
            <NodeSocket key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={input.socket} />
          ) : null;
        })}
      </>
    );
  }

  const field = (key: string, label: string, remove?: () => void, placeholder?: string) => {
    const input = node.inputs[key];
    if (!input) return null;
    const isConn = connected.has(key);
    return (
      <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={input.socket}>
        <span className="solenoid-node__io-label">{label}</span>
        {isConn ? (
          <span className="solenoid-node__io-wired" title="Driven by an incoming cable">↩ wired</span>
        ) : takesAutoLiteral(node, dataTypeOf(input.socket)) ? (
          <InlineAutoField num={literals[key]} text={strLiterals[key]} onChange={(v) => void setAutoLiteral(key, v)} placeholder={placeholder} />
        ) : dataTypeOf(input.socket) === "string" ? (
          <InlineTextField value={strLiterals[key]} onChange={(v) => void setStrLiteral(key, v)} placeholder={placeholder} />
        ) : (
          <InlineNumberField value={literals[key]} onChange={(v) => setLiteral(key, v)} placeholder={placeholder} />
        )}
        {remove && (
          <button
            type="button"
            className="solenoid-node__row-remove"
            title={`Remove this ${rowNoun}`}
            onClick={(e) => { e.stopPropagation(); void remove(); }}
          >
            ×
          </button>
        )}
      </MeasuredSocketRow>
    );
  };

  return (
    <>
      {leading.length > 0 && <InlineInputs node={node} emit={emit} keys={leading} />}
      {pairs.map((keys, i) => (
        // The remove button rides the tuple's first row, and only when there is more than one tuple.
        <div key={keys[0]} className="solenoid-node__pair-group">
          {keys.map((k, j) => field(
            k,
            `${node.pairLabels[j] ?? ""} ${i + 1}`,
            j === 0 && pairs.length > 1 ? () => removePair(keys) : undefined,
          ))}
        </div>
      ))}
      <button
        type="button"
        className="solenoid-node__add-input"
        onClick={(e) => { e.stopPropagation(); void addPair(); }}
      >
        Add {rowNoun[0].toUpperCase() + rowNoun.slice(1)}
      </button>
      {/* "N/A" is a state cue, not a typed value: no match with an unset fallback yields #N/A. */}
      {trailing.map((key) => field(key, node.inputs[key]?.label ?? key, undefined, "N/A"))}
    </>
  );
}
