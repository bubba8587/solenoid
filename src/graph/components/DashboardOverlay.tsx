// [[B11]] maximalMerge
import { useEffect, useSyncExternalStore } from "react";
import { dashboardStore } from "../dashboardStore";
import { cableValueStore } from "../cableValueStore";
import { getOwningEditor } from "../activeGraph";
import { DashboardNode } from "../nodeClasses";
import { InlineRefValue } from "./inlineRefDisplay";
import { CloseIcon } from "./CloseIcon";
import { useEscapeToClose } from "./useEscapeToClose";
import "./Markdown.css";
import "./ReportOverlay.css";
import "./DashboardOverlay.css";

export function DashboardOverlay() {
  const nodeId = useSyncExternalStore(dashboardStore.subscribe, dashboardStore.openNodeId);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  const found = nodeId ? getOwningEditor(nodeId)?.getNode(nodeId) : undefined;
  const node = found instanceof DashboardNode ? found : undefined;
  useEscapeToClose(() => dashboardStore.close(), !!node);
  // A covered canvas stops painting ([[html-in-canvas#The GPU texture budget]]), a drill-in's included.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("sol-dashboard-open", !!node);
    return () => root.classList.remove("sol-dashboard-open");
  }, [node]);
  if (!node) return null;

  const placed = node.placements();
  const cols = placed.length ? Math.max(...placed.map((p) => p.col + p.colSpan - 1)) : 1;

  return (
    <div className="dashboard-overlay" onPointerDown={(e) => e.stopPropagation()}>
      <div className="report-header">
        <span className="report-title">{node.label?.trim() || "Dashboard"}</span>
        <div className="report-header-actions">
          <button className="report-close" onClick={() => dashboardStore.close()} title="Close (Esc)" aria-label="Close">
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
      {placed.length > 0 ? (
        <div className="dashboard-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {placed.map((p) => (
            <section
              key={p.name}
              className="dashboard-box"
              style={{ gridRow: `${p.row} / span ${p.rowSpan}`, gridColumn: `${p.col} / span ${p.colSpan}` }}
            >
              <div className="dashboard-box__label">{p.name}</div>
              <div className="dashboard-box__value sol-md">
                {node.refValue(p.name) === undefined && p.hint
                  ? <span className="dashboard-box__hint">{p.hint}</span>
                  : <InlineRefValue nodeId={node.id} refKey={p.name} rich fill />}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="dashboard-empty">Empty layout</div>
      )}
    </div>
  );
}
