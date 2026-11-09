// [[B14]] oneDesignSystem
import { SearchField } from "./SearchField";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./popupChrome.css";
import { CloseIcon } from "./CloseIcon";
import { PopupOverflowMenu, type PopupMenuItem } from "./PopupOverflowMenu";
import { usePopupNodeItems } from "./popupNodeItems";
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

type PopupFilter = { value: string; onChange: (next: string) => void; label?: string; count?: string };

/** Mount only while open: the capture-phase Escape hook lives as long as the shell. */
export function PopupShell({
  title,
  onClose,
  onEscape,
  cardClassName,
  grouped = false,
  cardStyle,
  headerExtra,
  filter,
  pinNodeId,
  menuItems = [],
  resizable,
  fitNarrow = false,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  onEscape?: () => void;
  cardClassName?: string;
  grouped?: boolean;
  cardStyle?: CSSProperties;
  headerExtra?: ReactNode;
  /** The header's Filter field, one slot every popup with rows fills the same way; `count` trails while it filters. */
  filter?: PopupFilter;
  pinNodeId?: string;
  menuItems?: PopupMenuItem[];
  resizable?: { min: PopupSize; initial?: PopupSize };
  /** On a phone, a column capped at the screen whose view fits its content (popupChrome.css § Phone fit). */
  fitNarrow?: boolean;
  children?: ReactNode;
}) {
  useEscapeToClose(onEscape ?? onClose, true, { capture: true });
  const items = [...menuItems, ...usePopupNodeItems(pinNodeId, onClose)];
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightVar(headerRef);
  const [size, setSize] = useState<PopupSize | null>(resizable?.initial ?? null);
  const sized = !!resizable && !!size;
  const cardClass = `sol-popup${cardClassName ? ` ${cardClassName}` : ""}${grouped ? " sol-popup--grouped" : ""}${sized ? " sol-popup--sized" : ""}${fitNarrow ? " sol-popup--fitnarrow" : ""}`;
  const style = sized ? { ...cardStyle, width: size.w, height: size.h } : cardStyle;
  return (
    <div className="sol-popup-overlay" onPointerDown={() => onClose()}>
      <div ref={cardRef} className={cardClass} style={style} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sol-popup__header" ref={headerRef}>
          <div className="sol-popup__title">{title}</div>
          {filter && (
            <SearchField collapsible value={filter.value} onChange={filter.onChange} placeholder="Filter" label={filter.label ?? "Filter rows"} count={filter.value.trim() ? filter.count : undefined} />
          )}
          {headerExtra}
          {items.length > 0 && <PopupOverflowMenu items={items} />}
          <button className="sol-popup__close" onClick={() => onClose()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
        {children}
        {resizable && <PopupResizeGrip cardRef={cardRef} min={resizable.min} onResize={setSize} />}
      </div>
    </div>
  );
}
