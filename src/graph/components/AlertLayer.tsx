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

// Lucide "triangle-alert" — the alert icon on the trigger button.
// https://lucide.dev/icons/triangle-alert
const AlertSvg = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

// Lucide icons keyed by kind, drawn in the kind's color on each chip.
// info → "info", warning → "triangle-alert", critical → "octagon-alert".
function KindIcon({ kind, size = 14 }: { kind: AlertKind; size?: number }) {
  const common = {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: KIND_COLOR[kind],
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { display: "block", flexShrink: 0 },
  };
  if (kind === "info") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    );
  }
  if (kind === "critical") {
    return (
      <svg {...common}>
        <path d="M12 16h.01" />
        <path d="M12 8v4" />
        <path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

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
      <KindIcon kind={ev.kind} />
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
