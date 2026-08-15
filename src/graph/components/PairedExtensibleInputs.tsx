import { useSyncExternalStore } from "react";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { processGraph, bumpConnectionVersion } from "../process";
import { getActiveArea } from "../activeGraph";
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
import { pushRowRemovalUndo, pushRowAddUndo } from "./ExtensibleInputs";
import "./nodeCard.css";
import { dropInputCables } from "./cablePrune";

/** A node with a variable number of input PAIRS: two sockets sharing one remove
 *  button, with optional fixed leading/trailing rows around them. */
export interface PairedExtensibleNode {
  id: string;
  inputs: Record<string, { socket: ClassicPreset.Socket; label?: string } | undefined>;
  literals?: Record<string, number>;
  /** Ordered (aKey, bKey) pairs currently present, in row order. */
  valuePairKeys: () => Array<[string, string]>;
  addValuePair: () => void;
  /** Remove the pair identified by its first (a) key. */
  removeValuePair: (aKey: string) => void;
  /** Row labels for the two halves of a pair, e.g. ["If", "Then"]. */
  pairLabels: [string, string];
  /** Inline TEXT literals for a string-socket half; numeric slots use `literals`. */
  stringLiterals?: Record<string, string>;
  /** See `takesAutoLiteral` — a wildcard half takes a number OR text. */
  autoLiterals?: boolean;
}

/** `leadingKeys`/`trailingKeys` are fixed inputs before/after the pairs; each
 *  socket dot centers on its OWN row, so rows can sit anywhere in the body. */
export function PairedExtensibleInputs({
  node, emit, leadingKeys, trailingKeys,
}: {
  node: PairedExtensibleNode;
  emit: RenderEmit<ClassicScheme>;
  leadingKeys?: string[];
  trailingKeys?: string[];
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
    const before = new Set(Object.keys(node.inputs));
    node.addValuePair();
    // Diff the key set so the whole pair is ONE undo entry.
    const added = Object.keys(node.inputs).filter((k) => !before.has(k));
    const aKey = added[0];
    if (aKey) pushRowAddUndo(node, added, () => node.removeValuePair(aKey));
    await getActiveArea()?.update("node", node.id);
    await processGraph();
  }

  async function removePair(aKey: string, bKey: string) {
    await dropInputCables(node.id, [aKey, bKey]);
    // AFTER the connection removals, BEFORE the removal (see ExtensibleInputs).
    pushRowRemovalUndo(node, [aKey, bKey], () => node.removeValuePair(aKey));
    node.removeValuePair(aKey);
    await getActiveArea()?.update("node", node.id);
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
            title="Remove this pair"
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
      {pairs.map(([a, b], i) => (
        // The remove button rides the pair's first row, and only above one pair.
        <div key={a} className="solenoid-node__pair-group">
          {field(a, `${node.pairLabels[0]} ${i + 1}`, pairs.length > 1 ? () => removePair(a, b) : undefined)}
          {field(b, `${node.pairLabels[1]} ${i + 1}`)}
        </div>
      ))}
      <button
        type="button"
        className="solenoid-node__add-input"
        onClick={(e) => { e.stopPropagation(); void addPair(); }}
      >
        + Add pair
      </button>
      {/* The fallback's "N/A" is a state cue, not a typed value: no match with an
          unset fallback yields #N/A. */}
      {trailing.map((key) => field(key, node.inputs[key]?.label ?? key, undefined, "N/A"))}
    </>
  );
}
