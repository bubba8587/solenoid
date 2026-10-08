// [[B14]] oneDesignSystem
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./popupChrome.css";
import { CloseIcon } from "./CloseIcon";
import { PopupPinButton, PopupGoToButton } from "./PopupPinButton";
import { useEscapeToClose } from "./useEscapeToClose";
import { contrastInk, darkenAccent } from "../palette";
import { PopupResizeGrip, type PopupSize } from "./PopupResizeGrip";
import { useHeaderHeightVar } from "./useHeaderHeightVar";

export function popupCardVars(v: {
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
}): CSSProperties {
  const vars: Record<string, string> = {};
  if (v.accent) {
    vars["--node-accent"] = v.accent;
    vars["--node-accent-ink"] = contrastInk(v.accent);
    vars["--node-accent-dark"] = darkenAccent(v.accent);
  }
  if (v.groupColor) vars["--group-color"] = v.groupColor;
  if (v.groupColorDark) vars["--group-color-dark"] = v.groupColorDark;
  return vars;
}

/** Mount only while open: the capture-phase Escape hook lives as long as the shell. */
export function PopupShell({
  title,
  onClose,
  onEscape,
  cardClassName,
  grouped = false,
  cardStyle,
  headerExtra,
  pinNodeId,
  headerActions,
  resizable,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  onEscape?: () => void;
  cardClassName?: string;
  grouped?: boolean;
  cardStyle?: CSSProperties;
  headerExtra?: ReactNode;
  pinNodeId?: string;
  headerActions?: ReactNode;
  resizable?: { min: PopupSize; initial?: PopupSize };
  children?: ReactNode;
}) {
  useEscapeToClose(onEscape ?? onClose, true, { capture: true });
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightVar(headerRef);
  const [size, setSize] = useState<PopupSize | null>(resizable?.initial ?? null);
  const sized = !!resizable && !!size;
  const cardClass = `sol-popup${cardClassName ? ` ${cardClassName}` : ""}${grouped ? " sol-popup--grouped" : ""}${sized ? " sol-popup--sized" : ""}`;
  const style = sized ? { ...cardStyle, width: size.w, height: size.h } : cardStyle;
  return (
    <div className="sol-popup-overlay" onPointerDown={() => onClose()}>
      <div ref={cardRef} className={cardClass} style={style} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sol-popup__header" ref={headerRef}>
          <div className="sol-popup__title">{title}</div>
          {headerExtra}
          {pinNodeId && <PopupGoToButton nodeId={pinNodeId} onClose={onClose} />}
          {pinNodeId && <PopupPinButton nodeId={pinNodeId} />}
          {headerActions}
          <button className="sol-popup__close" onClick={() => onClose()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
        {children}
        {resizable && <PopupResizeGrip cardRef={cardRef} min={resizable.min} onResize={setSize} />}
      </div>
    </div>
  );
}
