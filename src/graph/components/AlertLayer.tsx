// [[D79]] effectsEdgeTriggered. Layout: tree/specs/computation/alert-node-alerts-hud.md.
import { useSyncExternalStore, useState, useRef, useEffect } from "react";
import { isMobile } from "../coarse";
import { alertStore, type AlertKind } from "../alertStore";
import { registerChrome } from "../chromeToggle";
import { flyToNode } from "../flyToNode";
import "./alertLayer.css";
import { CloseIcon } from "./CloseIcon";
import { resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";

const kindColor = (kind: AlertKind): string =>
  kind === "critical" ? "var(--sol-error)" : kind === "warning" ? "var(--sol-warn)" : resolveColor("blue");

// Lucide "bell" (https://lucide.dev/icons/bell) — the warning triangle marks Problems.
const AlertSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="M10.268 21a2 2 0 0 0 3.464 0" />
    <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.41 5.956-2.738 7.326" />
  </svg>
);

export function AlertLayer() {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [collapsed, setCollapsed] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Mobile: a tap outside re-collapses, so chips don't linger over the canvas.
  useEffect(() => {
    if (!isMobile() || collapsed) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setCollapsed(true);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [collapsed]);

  useSyncExternalStore(alertStore.subscribe, alertStore.version);

  const events = alertStore.list();
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

  const chips = events.map((ev) => {
    // Only the leading label is kind-colored; match it exactly first, since a label may contain a colon.
    const title = ev.message.startsWith(ev.label) ? ev.label : (ev.message.split(":")[0] ?? ev.message);
    const rest = ev.message.slice(title.length);
    return (
    <div
      key={ev.id}
      className="solenoid-alert"
      style={{ ["--alert-color" as string]: kindColor(ev.kind) }}
      onClick={() => flyToNode(ev.nodeId)}
      title="Go to this alert"
    >
      <span className="solenoid-alert__msg"><span className="solenoid-alert__title">{title}</span>{rest}</span>
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
    );
  });

  return (
    <div ref={rootRef} className={`solenoid-alert-layer${collapsed ? " solenoid-alert-layer--collapsed" : ""}`}>
      {trigger}
      {chips}
    </div>
  );
}
