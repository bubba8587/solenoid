import React, { useEffect, useRef } from "react";
import "./SocketContextMenu.css";

// Right-click menu for a node / group body: Isolate (and Isolate chain), Pin,
// and — when exactly two linkable items are selected and one was clicked — the
// Standoff link. One menu so a node's right-click has a single home.

// Lucide "pin" icon — https://lucide.dev/icons/pin
const PinSvg = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

// Lucide "git-fork" — the Where-used icon (downstream stream). https://lucide.dev/icons/git-fork
const WhereUsedSvg = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <circle cx="12" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
    <path d="M12 12v3" />
  </svg>
);

// Lucide "message-square" — the Add-comment icon. https://lucide.dev/icons/message-square
const CommentSvg = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export type NodeContextTarget = {
  nodeId: string;
  /** What Isolate acts on: the selection if the clicked node is part of it,
   *  else just the clicked node. */
  seedIds: string[];
  screenX: number;
  screenY: number;
  /** Whether this item carries a pinnable value (real value node, not a group). */
  canPin?: boolean;
  /** Present only when a Standoff link is on offer (exactly two selected). */
  standoff?: { aId: string; bId: string };
};

type Props = {
  target: NodeContextTarget;
  onIsolate: (ids: string[]) => void;
  onIsolateChain: (ids: string[]) => void;
  onWhereUsed?: (nodeId: string) => void;
  onPin?: (nodeId: string) => void;
  onLinkStandoff?: (s: { aId: string; bId: string }) => void;
  onAddComment?: (nodeId: string) => void;
  onClose: () => void;
};

export function NodeContextMenu({ target, onIsolate, onIsolateChain, onWhereUsed, onPin, onLinkStandoff, onAddComment, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item = (icon: React.ReactNode, label: string, run: () => void) => (
    <button
      className="solenoid-socket-ctx__item"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => { run(); onClose(); }}
    >
      <span className="solenoid-socket-ctx__icon">{icon}</span>
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className="solenoid-socket-ctx"
      style={{ left: target.screenX + 6, top: target.screenY - 4 }}
    >
      {item("⊙", "Isolate", () => onIsolate(target.seedIds))}
      {item("⛓", "Isolate chain", () => onIsolateChain(target.seedIds))}
      {onWhereUsed && item(<WhereUsedSvg />, "Where used", () => onWhereUsed!(target.nodeId))}
      {onPin && target.canPin && item(<PinSvg />, "Pin value", () => onPin!(target.nodeId))}
      {onAddComment && item(<CommentSvg />, "Add comment", () => onAddComment!(target.nodeId))}
      {target.standoff && onLinkStandoff &&
        item("⊷", "Link with Standoff", () => onLinkStandoff!(target.standoff!))}
    </div>
  );
}
