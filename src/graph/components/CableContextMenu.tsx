import { useEffect, useRef } from "react";
import "./SocketContextMenu.css";

// `connIds` is every cable the actions operate on: the right-clicked one plus the
// multi-selection, ribbons already expanded to their member lanes.

export type CableContextTarget = {
  connIds: string[];
  screenX: number;
  screenY: number;
};

type Props = {
  target: CableContextTarget;
  onInsertConduit: (target: CableContextTarget) => void;
  onDelete: (target: CableContextTarget) => void;
  onClose: () => void;
};

export function CableContextMenu({ target, onInsertConduit, onDelete, onClose }: Props) {
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

  const n = target.connIds.length;
  const counted = (label: string) => (n > 1 ? `${label} (${n} cables)` : label);

  return (
    <div
      ref={ref}
      className="solenoid-socket-ctx"
      style={{ left: target.screenX + 6, top: target.screenY - 4 }}
    >
      <button
        className="solenoid-socket-ctx__item"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => { onInsertConduit(target); onClose(); }}
      >
        <span className="solenoid-socket-ctx__icon">
          {/* Conduit — bundled lanes. An SVG, not a font glyph. */}
          <svg viewBox="-1 -1 18 18" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2 4h12 M2 8h12 M2 12h12" />
          </svg>
        </span>
        {counted("Insert Conduit")}
      </button>
      <button
        className="solenoid-socket-ctx__item"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => { onDelete(target); onClose(); }}
      >
        <span className="solenoid-socket-ctx__icon">✕</span>
        {counted("Delete")}
      </button>
    </div>
  );
}
