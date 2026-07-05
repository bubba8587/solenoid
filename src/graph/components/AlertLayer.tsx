import { useSyncExternalStore, useState, useRef, useEffect } from "react";
import { IS_MOBILE } from "../coarse";
import { alertStore, type AlertKind } from "../alertStore";
import { registerChrome } from "../chromeToggle";
import { flyToNode } from "../flyToNode";
import "./alertLayer.css";
import { CloseIcon } from "./CloseIcon";

// Per-kind HUD color — matches the toast tones (info / warn / error).
const KIND_COLOR: Record<AlertKind, string> = {
  info:     "#4c8bf5",
  warning:  "#d9822b",
  critical: "#e0524d",
};

// Lucide "bell" — the alert trigger icon. An alert isn't necessarily bad (it just
// fired on a status change), so a bell reads better than a warning triangle (which
// now marks the Problems panel). https://lucide.dev/icons/bell
const AlertSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.41 5.956-2.738 7.326" />
  </svg>
);

/**
 * The fired-alerts HUD section: a stack of chips, one per recent alert event
 * (see alertStore). An Alert node logs an event here on the rising edge of its
 * trigger condition. Click a chip to fly to the node that raised it; × dismisses
 * it. Collapses to a single alert-icon button with a count badge. Positioned by
 * its parent <HudStack/>, directly below the pinned-values section.
 */
export function AlertLayer() {
  // Collapsed by default everywhere (click the count button to expand); new
  // alerts still surface as toasts. On mobile a tap outside re-collapses it.
  const [collapsed, setCollapsed] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Full auto-collapse on mobile: once expanded, a tap anywhere outside the
  // layer snaps it shut again so the alert chips don't linger over the canvas.
  useEffect(() => {
    if (!IS_MOBILE || collapsed) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setCollapsed(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [collapsed]);

  useSyncExternalStore(alertStore.subscribe, alertStore.version);

  const events = alertStore.list();
  // Join the chrome-toggle group (Tab) only while there are alerts to show.
  useEffect(() => {
    if (events.length === 0) return;
    return registerChrome("alerts", { isOpen: () => !collapsed, setOpen: (o) => setCollapsed(!o) });
  }, [collapsed, events.length]);
  if (events.length === 0) return null;

  const trigger = (
    <button
      type="button"
      className="solenoid-alert-layer__trigger"
      title={collapsed ? `Show ${events.length} alert${events.length !== 1 ? "s" : ""}` : "Collapse alerts"}
      onClick={() => setCollapsed((c) => !c)}
    >
      <AlertSvg size={14} />
      {collapsed && <span className="solenoid-alert-layer__count">{events.length}</span>}
    </button>
  );

  const chips = events.map((ev) => (
    <div
      key={ev.id}
      className="solenoid-alert"
      style={{ ["--alert-color" as string]: KIND_COLOR[ev.kind] }}
      onClick={() => flyToNode(ev.nodeId)}
      title="Click to go to this alert"
    >
      <span className="solenoid-alert__msg">{ev.message}</span>
      <button
        type="button"
        className="solenoid-alert__remove"
        aria-label="Dismiss alert"
        title="Dismiss"
        onClick={(e) => { e.stopPropagation(); alertStore.dismiss(ev.id); }}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  ));

  return (
    <div ref={rootRef} className={`solenoid-alert-layer${collapsed ? " solenoid-alert-layer--collapsed" : ""}`}>
      {trigger}
      {chips}
    </div>
  );
}
