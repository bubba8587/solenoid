import { useMenuClamp } from "./menuClamp";
import { useEffect } from "react";
import "./SocketContextMenu.css";

export type SocketContextTarget = {
  nodeId: string;
  socketKey: string;
  side: "input" | "output";
  screenX: number;
  screenY: number;
};

type Props = {
  target: SocketContextTarget;
  onAttachFormat: (target: SocketContextTarget) => void;
  onClose: () => void;
};

export function SocketContextMenu({ target, onAttachFormat, onClose }: Props) {
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

  return (
    <div
      ref={ref}
      className="solenoid-socket-ctx"
      style={{ left: target.screenX + 6, top: target.screenY - 4 }}
    >
      <button
        className="solenoid-socket-ctx__item"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => { onAttachFormat(target); onClose(); }}
      >
        <span className="solenoid-socket-ctx__icon">
          {/* Lucide "paintbrush" (ISC), the Palette's icon. */}
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
            <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
            <path d="M14.5 17.5 4.5 15" />
          </svg>
        </span>
        Attach Format Controller
      </button>
    </div>
  );
}
