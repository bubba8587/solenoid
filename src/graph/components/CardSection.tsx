// [[B14]] oneDesignSystem (DESIGN.md § Card sections)
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { bumpConnectionVersion } from "../graphSignals";
import { sectionFoldStore } from "../sectionFoldStore";
import { scheduleAutosave } from "../persistence";
import { useHostNodeId } from "./nodeContext";
import { useConnectedInputs } from "./inlineInput";
import type { ClassicPreset } from "rete";
import type { Emit } from "./nodeKit";
import { collapseStore } from "../collapseStore";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";
import { prefersReducedMotion } from "../coarse";
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
      <FoldCaption label={label} title={title} open={open} onToggle={() => setOpen(!open)} sockets={sockets} />
      {open && children}
    </div>
  );
}

type FoldGhost = { key: string; top: number; color: string; square: boolean };

const MERGE_MS = 300;
const POP_MS = 260;
const SPLIT_MS = 320;

/** The socket at `key` in a card's content, and the element just after `caption` that stands for the tucked stack (the pill, or a lone socket). */
const socketEl = (content: HTMLElement, key: string) =>
  content.querySelector<HTMLElement>(`[data-socket-side="input"][data-socket-key="${CSS.escape(key)}"]`);
function tuckTarget(caption: HTMLElement): Element | null {
  for (let el = caption.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.matches(".solenoid-node__input-pill, [data-socket-side]:not(.solenoid-node__pill-socket)")) return el;
  }
  return null;
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
  const wired = sockets ? sockets.keys.filter((k) => connected.has(k) && sockets.node.inputs[k]) : [];
  const tucked = !open && sockets && wired.length > 0
    ? sockets.keys.filter((k) => sockets.node.inputs[k])
    : [];
  const at = cardCollapsed ? undefined : top;
  // A pill stands in for the chevron: it and the caption are the reopen button.
  const pill = !!sockets && tucked.length >= 2 && (cardCollapsed || top !== undefined);
  const openTitle = `Show ${label.toLowerCase()}`;

  // The fold animates: wired sockets fly up and merge into the pill, and the pill splits back out to the rows.
  const [ghosts, setGhosts] = useState<FoldGhost[] | null>(null);
  const ghostRefs = useRef<(HTMLDivElement | null)[]>([]);
  const splitFrom = useRef<number | null>(null);
  function toggle() {
    const content = ref.current?.closest<HTMLElement>(".solenoid-node__content");
    if (content && sockets && wired.length > 0 && !cardCollapsed && top !== undefined && !prefersReducedMotion()) {
      if (open) {
        setGhosts(wired.flatMap((k) => {
          const el = socketEl(content, k);
          const sock = sockets.node.inputs[k]!.socket;
          if (!el) return [];
          return [{ key: k, top: el.offsetTop, color: sock instanceof SolenoidSocket ? SOCKET_COLORS[sock.dataType] : "#888", square: el.dataset.socketShape === "square" }];
        }));
      } else {
        splitFrom.current = top;
      }
    }
    onToggle();
  }

  useLayoutEffect(() => {
    if (!ghosts || open || top === undefined || !ref.current) return;
    const anims = ghosts.map((g, i) => ghostRefs.current[i]?.animate(
      [
        { transform: "translateY(0) scale(1)", opacity: 1 },
        { transform: `translateY(${top - g.top}px) scale(0.8)`, opacity: 1, offset: 0.75 },
        { transform: `translateY(${top - g.top}px) scale(0.4)`, opacity: 0 },
      ],
      { duration: MERGE_MS, delay: i * 25, easing: "cubic-bezier(0.55, 0, 0.25, 1)", fill: "both" },
    ));
    const target = tuckTarget(ref.current);
    target?.animate(
      [
        { transform: "scale(0.2, 0.2)", opacity: 0 },
        { transform: "scale(1.25, 1.1)", opacity: 1, offset: 0.65 },
        { transform: "scale(1, 1)", opacity: 1 },
      ],
      { duration: POP_MS, delay: MERGE_MS - 90, easing: "ease-out", fill: "backwards" },
    );
    const done = window.setTimeout(() => setGhosts(null), MERGE_MS + ghosts.length * 25 + 40);
    return () => { window.clearTimeout(done); anims.forEach((a) => a?.cancel()); };
  }, [ghosts, open, top]);

  useEffect(() => {
    if (!open || splitFrom.current === null || !sockets) return;
    const from = splitFrom.current;
    splitFrom.current = null;
    const content = ref.current?.closest<HTMLElement>(".solenoid-node__content");
    if (!content) return;
    // The rows' sockets mount a render after the rows (they measure first), so the split starts next frame.
    // Not cancelled on cleanup: this effect re-runs on the very next render, which would drop the split.
    requestAnimationFrame(() => {
      wired.forEach((k, i) => {
        const el = socketEl(content, k);
        el?.animate(
          [
            { transform: `translateY(${from - el.offsetTop}px) scale(0.5)`, opacity: 0 },
            { transform: "translateY(0) scale(1.2)", opacity: 1, offset: 0.7 },
            { transform: "translateY(0) scale(1)", opacity: 1 },
          ],
          { duration: SPLIT_MS, delay: i * 30, easing: "cubic-bezier(0.3, 0.7, 0.3, 1)", fill: "backwards" },
        );
      });
    });
  });

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
          toggle();
        }}
      >
        {pill ? null : open ? <ChevronDownIcon size={8} strokeWidth={3} /> : <ChevronRightIcon size={8} strokeWidth={3} />}
        {label}
      </button>
      {pill && (
        <CollapsedInputPill node={sockets!.node} emit={sockets!.emit} keys={tucked} top={at} onOpen={cardCollapsed ? undefined : toggle} openTitle={cardCollapsed ? undefined : openTitle} />
      )}
      {sockets && tucked.length === 1 && (cardCollapsed || top !== undefined) && (
        <NodeSocket side="input" socketKey={tucked[0]} nodeId={sockets.node.id} emit={sockets.emit} payload={sockets.node.inputs[tucked[0]]!.socket} top={at} />
      )}
      {ghosts?.map((g, i) => (
        <div
          key={g.key}
          ref={(el) => { ghostRefs.current[i] = el; }}
          className={`solenoid-node__fold-ghost${g.square ? " solenoid-node__fold-ghost--square" : ""}`}
          style={{ top: g.top, background: g.color }}
          aria-hidden
        />
      ))}
    </>
  );
}
