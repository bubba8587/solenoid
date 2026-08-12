import { useMenuClamp } from "./menuClamp";
import { useEffect } from "react";
import "./SocketContextMenu.css";

// Shown only when exactly two linkable items are selected and one is right-clicked.

export type StandoffLinkTarget = {
  aId: string;
  bId: string;
  screenX: number;
  screenY: number;
};

type Props = {
  target: StandoffLinkTarget;
  onLink: (target: StandoffLinkTarget) => void;
  onClose: () => void;
};

export function StandoffLinkMenu({ target, onLink, onClose }: Props) {
  const ref = useMenuClamp<HTMLDivElement>(target.screenX, target.screenY);

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

  return (
    <div
      ref={ref}
      className="solenoid-socket-ctx"
      style={{ left: target.screenX + 6, top: target.screenY - 4 }}
    >
      <button
        className="solenoid-socket-ctx__item"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => { onLink(target); onClose(); }}
      >
        <span className="solenoid-socket-ctx__icon">⊷</span>
        Link with Standoff
      </button>
    </div>
  );
}
