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
        <span className="solenoid-socket-ctx__icon">⊞</span>
        Attach Format Controller
      </button>
    </div>
  );
}
