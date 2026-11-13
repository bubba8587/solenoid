// [[B19]] spreadsheetHabits, [[C28]] literalsIffEditable
import type { Emit } from "./nodeKit";
import { useSyncExternalStore } from "react";
import type { GraphSocket } from "../graphModel";
import { processEdited } from "../process";
import { literalFieldOf } from "../literalFields";
import { bumpConnectionVersion } from "../graphSignals";
import { getOwningView } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import {
  useConnectedInputs,
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

/** N sockets per tuple sharing one remove button: a pair is the two-element case (Filter, SUMIFS, IFS), and Set Cell uses triplets. */
interface PairedExtensibleNode {
  id: string;
  edited(): void;
  inputs: Record<string, { socket: GraphSocket; label?: string } | undefined>;
  literals?: Record<string, number>;
  valuePairKeys: () => string[][];
  addValuePair: () => void;
  /** Remove the tuple identified by its FIRST key. */
  removeValuePair: (aKey: string) => void;
  pairLabels: string[];
  /** Muted text an empty field of the tuple shows, numbered like its label; it never reaches the card's answer. */
  pairPlaceholders?: readonly (string | undefined)[];
  stringLiterals?: Record<string, string>;
  literalKinds?: Record<string, KeyedKind>;
}

export function PairedExtensibleInputs({
  node, emit, leadingKeys, trailingKeys, rowNoun = "pair", minRows = 1,
}: {
  node: PairedExtensibleNode;
  emit: Emit;
  leadingKeys?: string[];
  trailingKeys?: string[];
  rowNoun?: string;
  /** The fewest rows the card keeps: a row's remove button shows above it (PIVOTBY's calculated fields go to none). */
  minRows?: number;
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
    await processEdited(node.id);
  }

  async function setStrLiteral(key: string, v: string) {
    if (v === "") delete strLiterals[key];
    else strLiterals[key] = v;
    await processEdited(node.id);
  }

  async function addPair() {
    node.addValuePair();
    await getOwningView(node.id)?.rerenderNode(node.id);
    await processEdited(node.id, [], { topology: true });
  }

  async function removePair(keys: string[]) {
    await dropInputCables(node.id, keys);
    // Prune first, then remove the tuple ([[input-cable-pruning#The ordering rule]]).
    node.removeValuePair(keys[0]);
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
            <NodeSocket key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={input.socket} />
          ) : null;
        })}
      </>
    );
  }

  const field = (key: string, label: string, placeholder?: string) => {
    const input = node.inputs[key];
    if (!input) return null;
    const isConn = connected.has(key);
    return (
      <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={input.socket} example={!!placeholder}>
        <span className="solenoid-node__io-label">{label}</span>
        {isConn ? (
          <span className="solenoid-node__io-wired" title="Driven by an incoming cable">↩ wired</span>
        ) : literalFieldOf(node, key) === "keyed" ? (
          <KeyedField node={node} slot={key} placeholder={placeholder} />
        ) : literalFieldOf(node, key) === "text" ? (
          <InlineTextField value={strLiterals[key]} onChange={(v) => void setStrLiteral(key, v)} placeholder={placeholder} />
        ) : literalFieldOf(node, key) === "logical" ? (
          <LogicalCheck checked={!!literals[key]} onToggle={() => void setLiteral(key, literals[key] ? 0 : 1)} />
        ) : literalFieldOf(node, key) === "number" ? (
          <InlineNumberField value={literals[key]} onChange={(v) => setLiteral(key, v)} placeholder={placeholder} />
        ) : null}
      </MeasuredSocketRow>
    );
  };

  return (
    <>
      {leading.length > 0 && <InlineInputs node={node} emit={emit} keys={leading} />}
      {pairs.map((keys, i) => (
        // The tuple's remove button sits on the rule above it, so every field keeps the full width; one tuple has neither.
        <div key={keys[0]} className="solenoid-node__pair-group solenoid-node__pair-group--headed">
          {pairs.length > minRows && <PairHead title={`Remove this ${rowNoun}`} onRemove={() => void removePair(keys)} />}
          {keys.map((k, j) => field(k, `${node.pairLabels[j] ?? ""} ${i + 1}`, node.pairPlaceholders?.[j] && `${node.pairPlaceholders[j]} ${i + 1}`))}
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
      {trailing.map((key) => field(key, node.inputs[key]?.label ?? key, "N/A"))}
    </>
  );
}

/** The rule that heads a repeated group of rows (a SWITCH pair, a Filter condition, a Sort key), its remove button at
 *  the right end, so every field in the group keeps the full width. Its group takes `solenoid-node__pair-group--headed`. */
export function PairHead({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="solenoid-node__pair-head">
      <span className="solenoid-node__pair-rule" />
      <button
        type="button"
        className="solenoid-node__row-remove"
        title={title}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >
        ×
      </button>
    </div>
  );
}
