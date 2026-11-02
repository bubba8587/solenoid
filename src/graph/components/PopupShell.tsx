// [[B14]] oneDesignSystem
import { useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { settingsStore } from "../settingsStore";
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
  menuItems = [],
  resizable,
  fitNarrow = false,
  zoomable = false,
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
  menuItems?: PopupMenuItem[];
  resizable?: { min: PopupSize; initial?: PopupSize };
  /** On a phone, a column capped at the screen whose view fits its content (popupChrome.css § Phone fit). */
  fitNarrow?: boolean;
  /** A − 100% + control in the header zooms the body (CSS `zoom`, so it lays out again rather than scaling a picture). */
  zoomable?: boolean;
  children?: ReactNode;
}) {
  useEscapeToClose(onEscape ?? onClose, true, { capture: true });
  const items = [...menuItems, ...usePopupNodeItems(pinNodeId, onClose)];
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useHeaderHeightVar(headerRef);
  const [size, setSize] = useState<PopupSize | null>(resizable?.initial ?? null);
  const sized = !!resizable && !!size;
  const zoom = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("popupZoom"));
  const cardClass = `sol-popup${cardClassName ? ` ${cardClassName}` : ""}${grouped ? " sol-popup--grouped" : ""}${sized ? " sol-popup--sized" : ""}${fitNarrow ? " sol-popup--fitnarrow" : ""}`;
  const style = sized ? { ...cardStyle, width: size.w, height: size.h } : cardStyle;
  return (
    <div className="sol-popup-overlay" onPointerDown={() => onClose()}>
      <div ref={cardRef} className={cardClass} style={style} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sol-popup__header" ref={headerRef}>
          <div className="sol-popup__title">{title}</div>
          {headerExtra}
          {zoomable && <PopupZoom zoom={zoom} />}
          {items.length > 0 && <PopupOverflowMenu items={items} />}
          <button className="sol-popup__close" onClick={() => onClose()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
        <div className="sol-popup__body" style={zoomable && zoom !== 1 ? { zoom } : undefined}>{children}</div>
        {resizable && <PopupResizeGrip cardRef={cardRef} min={resizable.min} onResize={setSize} />}
      </div>
    </div>
  );
}

const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** The header's zoom control: a step down, the level (a click resets it to 100%), a step up. */
function PopupZoom({ zoom }: { zoom: number }) {
  const at = ZOOM_STEPS.findIndex((z) => Math.abs(z - zoom) < 0.001);
  const set = (z: number) => settingsStore.set("popupZoom", z);
  const step = (dir: 1 | -1) => {
    const i = at >= 0 ? at + dir : dir > 0 ? ZOOM_STEPS.findIndex((z) => z > zoom) : ZOOM_STEPS.findLastIndex((z) => z < zoom);
    if (i >= 0 && i < ZOOM_STEPS.length) set(ZOOM_STEPS[i]);
  };
  return (
    <div className="sol-popup__zoom" role="group" aria-label="Zoom">
      <button type="button" title="Zoom out" aria-label="Zoom out" disabled={zoom <= ZOOM_STEPS[0]} onClick={() => step(-1)}>−</button>
      <button type="button" className="sol-popup__zoom-level" title="Reset zoom to 100%" onClick={() => set(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" title="Zoom in" aria-label="Zoom in" disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => step(1)}>+</button>
    </div>
  );
}
