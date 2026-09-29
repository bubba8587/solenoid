// [[B14]] oneDesignSystem (DESIGN.md § Card sections)
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { bumpConnectionVersion } from "../graphSignals";
import { sectionFoldStore } from "../sectionFoldStore";
import { scheduleAutosave } from "../persistence";
import { useHostNodeId } from "./nodeContext";
import { useConnectedInputs } from "./inlineInput";
import type { ClassicPreset } from "rete";
import type { Emit } from "./nodeKit";
import { collapseStore } from "../collapseStore";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { NodeSocket, useRowSocketTop } from "./NodeSocket";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import "./nodeCard.css";

/** Whether any of a section's socket rows is wired or holds a typed value other than the node's seeded default: what opens a section by default. */
export function useRowsInUse(
  node: { id: string; literals?: Record<string, number>; stringLiterals?: Record<string, string> },
  keys: readonly string[],
  defaults: Readonly<Record<string, number>> = {},
): boolean {
  const connected = useConnectedInputs(node.id);
  return keys.some((k) => {
    const n = node.literals?.[k];
    return connected.has(k) || (n !== undefined && n !== defaults[k]) || (node.stringLiterals?.[k] ?? "") !== "";
  });
}

type SectionSockets = {
  node: { id: string; inputs: Record<string, { socket: ClassicPreset.Socket } | undefined> };
  emit: Emit;
  keys: readonly string[];
};

/** A small caption over a run of card rows; `collapsible` folds the rows away behind it.
 *  Folded, a wired socket among `sockets` stays live on the caption row: one socket as its own dot, several behind a pill, as a collapsed card does. */
export function CardSection({ label, title, collapsible, defaultOpen = true, sockets, className, children }: {
  label: string;
  title?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  sockets?: SectionSockets;
  className?: string;
  children: ReactNode;
}) {
  // A hand fold or open is saved with the document; until then the section follows defaultOpen.
  const nodeId = useHostNodeId();
  const saved = useSyncExternalStore(sectionFoldStore.subscribe, () => (nodeId ? sectionFoldStore.get(nodeId, label) : undefined));
  const [local, setLocal] = useState<boolean | undefined>(undefined);
  const open = !collapsible || ((nodeId ? saved : local) ?? defaultOpen);
  const setOpen = (next: boolean) => {
    if (!nodeId) { setLocal(next); return; }
    sectionFoldStore.set(nodeId, label, next);
    scheduleAutosave();
  };
  const mounted = useRef(false);
  useEffect(() => {
    // The rows below the section moved, so their cables re-route once the fold has laid out.
    if (mounted.current) bumpConnectionVersion();
    mounted.current = true;
  }, [open]);
  const cls = `solenoid-node__section${className ? ` ${className}` : ""}`;

  if (!collapsible) {
    return (
      <div className={cls}>
        <div className="solenoid-node__section-caption" title={title}>{label}</div>
        {children}
      </div>
    );
  }
  return (
    <div className={cls}>
      <FoldCaption label={label} title={title} open={open} onToggle={() => setOpen(!open)} sockets={open ? undefined : sockets} />
      {open && children}
    </div>
  );
}

function FoldCaption({ label, title, open, onToggle, sockets }: {
  label: string;
  title?: string;
  open: boolean;
  onToggle: () => void;
  sockets?: SectionSockets;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const top = useRowSocketTop(ref);
  const connected = useConnectedInputs(sockets?.node.id ?? "");
  // A collapsed card hides the caption, so the tucked sockets fall back to the card's own pill spot.
  const cardCollapsed = useSyncExternalStore(collapseStore.subscribe, () => (sockets ? collapseStore.get(sockets.node.id) : false));
  const tucked = sockets && sockets.keys.some((k) => connected.has(k))
    ? sockets.keys.filter((k) => sockets.node.inputs[k])
    : [];
  const at = cardCollapsed ? undefined : top;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="solenoid-node__section-caption solenoid-node__section-caption--toggle"
        title={title ?? (open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`)}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {open ? <ChevronDownIcon size={8} strokeWidth={3} /> : <ChevronRightIcon size={8} strokeWidth={3} />}
        {label}
      </button>
      {sockets && tucked.length >= 2 && (cardCollapsed || top !== undefined) && (
        <CollapsedInputPill node={sockets.node} emit={sockets.emit} keys={tucked} top={at} />
      )}
      {sockets && tucked.length === 1 && (cardCollapsed || top !== undefined) && (
        <NodeSocket side="input" socketKey={tucked[0]} nodeId={sockets.node.id} emit={sockets.emit} payload={sockets.node.inputs[tucked[0]]!.socket} top={at} />
      )}
    </>
  );
}
