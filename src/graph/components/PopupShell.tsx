import type { CSSProperties, ReactNode } from "react";
import "./popupChrome.css";
import { CloseIcon } from "./CloseIcon";
import { PopupPinButton, PopupGoToButton } from "./PopupPinButton";
import { useEscapeToClose } from "./useEscapeToClose";

/**
 * The modal chrome shared by the value/editor popups (Table, Cube, Formula,
 * Chart, Pivot, Element picker): the full-screen overlay (pointer-down outside
 * closes), the accent-tinted card, the header row — title, any extra header
 * content, the optional go-to/pin pair, the close button — and the
 * capture-phase Escape wiring. Callers mount it only while open, so the hook's
 * lifetime IS the popup's; the body is just `children`.
 */
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
  children?: ReactNode;
}) {
  useEscapeToClose(onEscape ?? onClose, true, { capture: true });
  const cardClass = `sol-popup${cardClassName ? ` ${cardClassName}` : ""}${grouped ? " sol-popup--grouped" : ""}`;
  return (
    <div className="sol-popup-overlay" onPointerDown={() => onClose()}>
      <div className={cardClass} style={cardStyle} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sol-popup__header">
          <div className="sol-popup__title">{title}</div>
          {headerExtra}
          {pinNodeId && <PopupGoToButton nodeId={pinNodeId} onClose={onClose} />}
          {pinNodeId && <PopupPinButton nodeId={pinNodeId} />}
          {headerActions}
          <button className="sol-popup__close" onClick={() => onClose()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
