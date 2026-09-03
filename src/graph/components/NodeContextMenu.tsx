import React, { useEffect } from "react";
import { useMenuClamp } from "./menuClamp";
import { inspectorStore } from "../inspectorStore";
import "./SocketContextMenu.css";

// The single right-click menu for a node / group body — a node's right-click has
// one home, so new items land here rather than in a second menu.

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

// Lucide "pencil" — Edit composite contents. https://lucide.dev/icons/pencil
const EditSvg = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </svg>
);

// Lucide "lock" / "lock-open" — pin or release a group's position. https://lucide.dev/icons/lock
const LockSvg = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const UnlockSvg = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
);

// Lucide "package-open" — Unpack composite. https://lucide.dev/icons/package-open
const UnpackSvg = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M12 22v-9" />
    <path d="M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z" />
    <path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13" />
    <path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z" />
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
  /** The clicked node is a Composite — offers Edit contents / Unpack. */
  isComposite?: boolean;
  /** The clicked node is a Group — offers Lock / Unlock position. */
  isGroup?: boolean;
  /** A group's current position-lock state (drives the Lock ↔ Unlock label). */
  lockedPosition?: boolean;
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
  onEditComposite?: (nodeId: string) => void;
  onUnpackComposite?: (nodeId: string) => void;
  onToggleLock?: (nodeId: string) => void;
  onClose: () => void;
};

export function NodeContextMenu({ target, onIsolate, onIsolateChain, onWhereUsed, onPin, onLinkStandoff, onAddComment, onEditComposite, onUnpackComposite, onToggleLock, onClose }: Props) {
  const ref = useMenuClamp<HTMLDivElement>(target.screenX, target.screenY);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item = (icon: React.ReactNode, label: string, run: () => void, title?: string) => (
    <button
      className="solenoid-socket-ctx__item"
      title={title}
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
      {/* The description moved to the Inspector; this (i) is its door — and the
          touch-reachable one, since mobile has no top-bar button. */}
      <button
        className="solenoid-socket-ctx__info"
        title="Inspector"
        aria-label="Inspector"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => { inspectorStore.openFor(target.nodeId); onClose(); }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {target.isComposite && onEditComposite &&
        item(<EditSvg />, "Edit contents", () => onEditComposite!(target.nodeId))}
      {target.isComposite && onUnpackComposite &&
        item(<UnpackSvg />, "Unpack composite", () => onUnpackComposite!(target.nodeId))}
      {item("⊙", "Isolate", () => onIsolate(target.seedIds))}
      {item("⛓", "Isolate chain", () => onIsolateChain(target.seedIds),
        "Isolate everything connected to this, upstream and downstream")}
      {onWhereUsed && item(<WhereUsedSvg />, "Where used", () => onWhereUsed!(target.nodeId),
        "Isolate this node and everything downstream of it")}
      {onPin && target.canPin && item(<PinSvg />, "Pin value", () => onPin!(target.nodeId))}
      {onAddComment && item(<CommentSvg />, "Add comment", () => onAddComment!(target.nodeId))}
      {target.standoff && onLinkStandoff &&
        item("⊷", "Link with Standoff", () => onLinkStandoff!(target.standoff!))}
      {target.isGroup && onToggleLock && (
        target.lockedPosition
          ? item(<UnlockSvg />, "Unlock position", () => onToggleLock!(target.nodeId),
              "Let the group be dragged again and included in Tidy / Cleanup")
          : item(<LockSvg />, "Lock position", () => onToggleLock!(target.nodeId),
              "Pin the group's corner: no dragging, and Tidy / Cleanup skip it (resize still works)")
      )}
    </div>
  );
}
