import { useEffect, useRef, type ReactNode } from "react";
import "./SocketContextMenu.css";

// The main canvas's node menu is isolate/pin/standoff — main-graph concepts that don't apply
// in a subgraph — so the drill-in gets its own set.
export function DrillNodeMenu({
  menu, onEdit, onDuplicate, onDelete, onClose,
}: {
  menu: { nodeId: string; screenX: number; screenY: number; isComposite: boolean };
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const item = (icon: ReactNode, label: string, run: () => void) => (
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
    <div ref={ref} className="solenoid-socket-ctx" style={{ left: menu.screenX + 6, top: menu.screenY - 4 }}>
      {menu.isComposite && item(
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />
        </svg>, "Edit contents", onEdit)}
      {item(
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" />
        </svg>, "Duplicate", onDuplicate)}
      {item(
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" /><path d="M10 11v6M14 11v6" />
        </svg>, "Delete", onDelete)}
    </div>
  );
}
