// [[B14]] oneDesignSystem (DESIGN.md § Card sections)
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { bumpConnectionVersion } from "../graphSignals";
import { sectionFoldStore } from "../sectionFoldStore";
import { notifyGraphChanged } from "../process";
import { useHostNodeId } from "./nodeContext";
import { useConnectedInputs } from "./inlineInput";
import type { ClassicPreset } from "rete";
import type { Emit } from "./nodeKit";
import { collapseStore } from "../collapseStore";
import { SolenoidSocket, SOCKET_COLORS } from "../sockets";
import { prefersReducedMotion } from "../coarse";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { NodeSocket, useRowSocketTop } from "./NodeSocket";
import { SocketGoo, flowYOf, type GooDrop } from "./SocketGoo";
import { cableEndMotion } from "../cableEndMotion";
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
    notifyGraphChanged();
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

/** The socket at `key` in a card's content, and the element just after `caption` that stands for the tucked stack (the pill, or a lone socket). */
const socketEl = (content: HTMLElement, key: string) =>
  content.querySelector<HTMLElement>(`[data-socket-side="input"][data-socket-key="${CSS.escape(key)}"]`);
function tuckTarget(caption: HTMLElement): HTMLElement | SVGElement | null {
  for (let el = caption.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.matches(".solenoid-node__input-pill, [data-socket-side]:not(.solenoid-node__pill-socket)")) return el as HTMLElement | SVGElement;
  }
  return null;
}
const R = 6; // a socket dot's radius: its center sits this far below the socket's top
const socketColor = (sock: ClassicPreset.Socket) => (sock instanceof SolenoidSocket ? SOCKET_COLORS[sock.dataType] : "var(--sock-any)");

type Goo = { mode: "merge" | "split"; drops: GooDrop[]; pillTop: number; pillColor: string; pillHeight: number; hidden: (HTMLElement | SVGElement)[] };

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

  // The fold is liquid: wired sockets run together into the pill, and bud back off it to their rows (SocketGoo).
  const [goo, setGoo] = useState<Goo | null>(null);
  const splitFrom = useRef<number | null>(null);
  const firstColor = sockets ? socketColor(sockets.node.inputs[sockets.keys.find((k) => sockets.node.inputs[k]) ?? ""]?.socket as ClassicPreset.Socket) : "var(--sock-any)";
  const tuckHeight = sockets && sockets.keys.filter((k) => sockets.node.inputs[k]).length >= 2 ? 28 : 12;
  function toggle() {
    const content = ref.current?.closest<HTMLElement>(".solenoid-node__content");
    if (content && sockets && wired.length > 0 && !cardCollapsed && top !== undefined && !prefersReducedMotion()) {
      // The cables hold where they are from this click until the liquid carries them: the fold re-lays the card at
      // once, but the liquid's first frame (and the split's, a frame later) would otherwise show them at the sockets.
      const nodeId = sockets.node.id;
      if (open) {
        const held = wired.flatMap((k) => {
          const el = socketEl(content, k);
          const y = el ? flowYOf(el, R) : undefined;
          return el && y !== undefined ? [{ k, el, y }] : [];
        });
        if (held.length > 0) {
          cableEndMotion.setYs(nodeId, held.map(({ k, y }) => [k, y] as const));
          setGoo({
            mode: "merge",
            drops: held.map(({ k, el }) => ({ key: k, top: el.offsetTop, color: socketColor(sockets.node.inputs[k]!.socket) })),
            pillTop: top, pillColor: firstColor, pillHeight: tuckHeight, hidden: [],
          });
        }
      } else {
        const pillEl = ref.current ? tuckTarget(ref.current) : null;
        const y = pillEl ? flowYOf(pillEl, tuckHeight / 2) : undefined;
        if (y !== undefined) {
          cableEndMotion.setYs(nodeId, wired.map((k) => [k, y] as const));
          splitFrom.current = top;
        }
      }
    }
    onToggle();
  }

  // Merge: the real pill (or lone socket) stays hidden under the goo until the liquid has settled into it.
  useLayoutEffect(() => {
    if (!goo || goo.mode !== "merge" || goo.hidden.length > 0 || !ref.current) return;
    const target = tuckTarget(ref.current);
    if (!target) return;
    target.style.opacity = "0";
    goo.hidden.push(target);
  }, [goo]);

  useEffect(() => {
    if (!open || splitFrom.current === null || !sockets) return;
    const from = splitFrom.current;
    splitFrom.current = null;
    const content = ref.current?.closest<HTMLElement>(".solenoid-node__content");
    if (!content) return;
    // The rows' sockets mount a render after the rows (they measure first), so the split starts next frame, before
    // that frame paints. Not cancelled on cleanup: this effect re-runs on the very next render, which would drop it.
    requestAnimationFrame(() => {
      const els = wired.flatMap((k) => { const el = socketEl(content, k); return el ? [{ el, k }] : []; });
      // No liquid to take the held cables over, so let them go to their sockets.
      if (els.length === 0) { cableEndMotion.clear(sockets.node.id, wired); return; }
      els.forEach(({ el }) => { el.style.opacity = "0"; });
      setGoo({
        mode: "split",
        drops: els.map(({ el, k }) => ({ key: k, top: el.offsetTop, color: socketColor(sockets.node.inputs[k]!.socket) })),
        pillTop: from, pillColor: firstColor, pillHeight: tuckHeight, hidden: els.map(({ el }) => el),
      });
    });
  });

  function gooDone() {
    goo?.hidden.forEach((el) => { el.style.opacity = ""; });
    setGoo(null);
  }

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
      {goo && (
        <SocketGoo key={goo.mode} nodeId={sockets!.node.id} mode={goo.mode} drops={goo.drops} pillTop={goo.pillTop} pillColor={goo.pillColor} pillHeight={goo.pillHeight} onDone={gooDone} />
      )}
    </>
  );
}
