import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./popupChrome.css";
import { CloseIcon } from "./CloseIcon";
import { PopupPinButton, PopupGoToButton } from "./PopupPinButton";
import { useEscapeToClose } from "./useEscapeToClose";
import { contrastInk, darkenAccent } from "../palette";
import { PopupResizeGrip, type PopupSize } from "./PopupResizeGrip";
import { useHeaderHeightVar } from "./NodeCard";

/** Derives `--node-accent-ink` per node: the app-wide `--accent-ink` is computed for the
 *  APP accent, so accent-filled popup chrome would otherwise wear ink for the wrong hue. */
export function popupCardVars(v: {
  accent?: string;
  groupColor?: string;
  groupColorDark?: string;
}): CSSProperties {
  const vars: Record<string, string> = {};
  if (v.accent) {
    vars["--node-accent"] = v.accent;
    vars["--node-accent-ink"] = contrastInk(v.accent);
    // The card's light-mode body border uses the darkened accent, mirroring the node card.
    vars["--node-accent-dark"] = darkenAccent(v.accent);
  }
  if (v.groupColor) vars["--group-color"] = v.groupColor;
  if (v.groupColorDark) vars["--group-color-dark"] = v.groupColorDark;
  return vars as CSSProperties;
}

/** Shared modal chrome for the value/editor popups. Callers must mount it only while
 *  open — the capture-phase Escape hook's lifetime IS the popup's. */
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
  /** Closes the popup — the overlay click, the ✕ button, and (unless `onEscape` says otherwise) Escape. */
  onClose: () => void;
  /** Escape when it isn't a plain close (CubePopup pops a drill level first). */
  onEscape?: () => void;
  /** Extra card classes after `sol-popup` (e.g. "table-popup"). */
  cardClassName?: string;
  /** Group-membership framing — appends `sol-popup--grouped`. */
  grouped?: boolean;
  /** Accent / group-color CSS vars, mirroring the host node's card. */
  cardStyle?: CSSProperties;
  /** Sits between the title and the pin/close cluster (dims counts, badges, tags). */
  headerExtra?: ReactNode;
  /** When set, the go-to-source + pin-to-HUD buttons render for this node. */
  pinNodeId?: string;
  /** Sits between the pin pair and the close button (overflow menu). */
  headerActions?: ReactNode;
  /** Add a corner resize grip. `min` floors the drag; `initial` sizes the card from
   *  the start (a figure popup that must fill), else the card stays content-sized until
   *  the first drag. The overlay keeps it centered — growth is symmetric about center.
   *  A resized card is `display:flex` column, so a `.sol-popup__scroll` region fills. */
  resizable?: { min: PopupSize; initial?: PopupSize };
  children?: ReactNode;
}) {
  useEscapeToClose(onEscape ?? onClose, true, { capture: true });
  const cardRef = useRef<HTMLDivElement>(null);
  // Publish the header's border-box height as --header-h so the ::after body border
  // starts exactly at the header's bottom (the frame-alignment fix, § popupChrome.css).
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightVar(headerRef);
  const [size, setSize] = useState<PopupSize | null>(resizable?.initial ?? null);
  const sized = !!resizable && !!size;
  const cardClass = `sol-popup${cardClassName ? ` ${cardClassName}` : ""}${grouped ? " sol-popup--grouped" : ""}${sized ? " sol-popup--sized" : ""}`;
  const style = sized ? { ...cardStyle, width: size!.w, height: size!.h } : cardStyle;
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
