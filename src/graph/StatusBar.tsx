import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getEditor, getArea, requestRecalc } from "./process";
import { calcModeStore } from "./calcModeStore";
import { nodeTypeName } from "./nodeNames";
import { isWebDemo } from "../env";
import { loadRevealStore } from "./loadReveal";
import { WEB_DEMO_NODE_BUDGET, WEB_DEMO_NODE_WARN_RATIO } from "./nodeBudget";
import { problemsStore, problemsPanelUi } from "./problemsStore";

/**
 * Thin bottom status strip: graph counts, a light selection indicator, and the
 * zoom level. Polls the editor/area a few times a second (cheap) rather than
 * wiring selection/zoom into dedicated stores.
 *
 * On the WEB DEMO only, the node count doubles as a soft-budget meter: an inline
 * fill bar behind the "N / 100 nodes" readout, coloured as it approaches/exceeds
 * the budget, plus a one-time modal on the crossing ABOVE it (see nodeBudget.ts /
 * docs/archive/performance-hardening.md). Desktop (Tauri) shows the plain count — the limit is
 * a property of the in-browser webview, not the product.
 */

type Snapshot = { nodes: number; cables: number; selection: string; zoom: number };

function read(): Snapshot {
  const editor = getEditor();
  const area = getArea();
  const zoom = area ? Math.round(area.area.transform.k * 100) : 100;
  if (!editor) return { nodes: 0, cables: 0, selection: "Ready", zoom };

  const all = editor.getNodes();
  const cables = editor.getConnections().length;
  const selected = all.filter((n) => (n as { selected?: boolean }).selected);

  let selection: string;
  if (selected.length === 0) selection = "Ready";
  // Node TYPE, not the user-editable header title — the same string the
  // header shows on hover.
  else if (selected.length === 1) selection = nodeTypeName(selected[0]);
  else selection = `${selected.length} selected`;

  return { nodes: all.length, cables, selection, zoom };
}

export function StatusBar() {
  const [snap, setSnap] = useState<Snapshot>(() => ({ nodes: 0, cables: 0, selection: "Ready", zoom: 100 }));
  const [modalOpen, setModalOpen] = useState(false);
  // Edge-detect the budget crossing (like alertStore): fire the modal only when
  // we go from at/under-budget to over, not on every add while already over.
  const wasOver = useRef(false);

  useEffect(() => {
    let prev = "";
    const tick = () => {
      const s = read();
      // Web-demo budget crossing — runs every tick, independent of the render
      // gate below. Suppressed during the cinematic load reveal (nodes stream in
      // there; a graph that loads already-over never pops it — only editing past
      // the line does).
      if (isWebDemo) {
        const over = s.nodes > WEB_DEMO_NODE_BUDGET;
        if (over && !wasOver.current && !loadRevealStore.isActive()) setModalOpen(true);
        wasOver.current = over;
      }
      const sig = `${s.nodes}|${s.cables}|${s.selection}|${s.zoom}`;
      if (sig !== prev) { prev = sig; setSnap(s); }
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, []);

  const ratio = WEB_DEMO_NODE_BUDGET > 0 ? snap.nodes / WEB_DEMO_NODE_BUDGET : 0;
  const level = ratio >= 1 ? "over" : ratio >= WEB_DEMO_NODE_WARN_RATIO ? "warn" : "ok";

  // Calc-mode indicator (Excel's status-bar "Calculate"). Only shown in manual mode:
  // a muted "Manual" when up to date, an actionable "Calculate" (click / F9) when a
  // suppressed change left the graph stale. Nothing in automatic mode (no clutter).
  useSyncExternalStore(calcModeStore.subscribe, calcModeStore.version);
  const manual = calcModeStore.isManual();
  const calcDirty = calcModeStore.dirty();
  const sketch = calcModeStore.isSketch();

  const problemCount = useSyncExternalStore(problemsStore.subscribe, () => problemsStore.list().length);

  return (
    <>
      <div className="solenoid-statusbar" onPointerDown={(e) => e.stopPropagation()}>
        <span
          className={`solenoid-statusbar__counts${isWebDemo ? ` solenoid-statusbar__counts--${level}` : ""}`}
          title={isWebDemo
            ? `Web demo: ${snap.nodes} of a soft ${WEB_DEMO_NODE_BUDGET}-node budget. Big graphs run smoother in the desktop app.`
            : undefined}
        >
          {isWebDemo && (
            <span className="solenoid-statusbar__budget">
              <span
                className="solenoid-statusbar__budget-fill"
                style={{ width: `${Math.min(100, ratio * 100)}%` }}
              />
            </span>
          )}
          {isWebDemo
            ? <>{snap.nodes} / {WEB_DEMO_NODE_BUDGET} {snap.nodes === 1 ? "node" : "nodes"}</>
            : <>{snap.nodes} {snap.nodes === 1 ? "node" : "nodes"}</>}
          <span className="solenoid-statusbar__dot">·</span>
          {snap.cables} {snap.cables === 1 ? "cable" : "cables"}
        </span>
        <span className="solenoid-statusbar__sel">{snap.selection}</span>
        {problemCount > 0 && (
          <button
            type="button"
            className="solenoid-statusbar__problems"
            title={`${problemCount} tagged error${problemCount !== 1 ? "s" : ""}`}
            onClick={() => problemsPanelUi.setOpen(true)}
          >
            {problemCount} {problemCount === 1 ? "problem" : "problems"}
          </button>
        )}
        {manual && (
          calcDirty ? (
            <button
              type="button"
              className="solenoid-statusbar__calc solenoid-statusbar__calc--dirty"
              title="Changes pending. Recompute the graph (F9)."
              onClick={() => void requestRecalc()}
            >
              Calculate
            </button>
          ) : (
            <span
              className="solenoid-statusbar__calc"
              title="Manual calculation: edits don't recompute until you press F9."
            >
              Manual
            </span>
          )
        )}
        {sketch && (
          <span
            className="solenoid-statusbar__sketch"
            title="Sketch mode: verbs run on a sample of the data. F9 forces an exact recompute."
          >
            ≈ approximate
          </span>
        )}
        <span className="solenoid-statusbar__zoom">{snap.zoom}%</span>
      </div>
      {/* Rendered as an App-level sibling (not inside the status strip, whose
          backdrop-filter would trap the modal's stacking context below it). */}
      {modalOpen && <NodeBudgetModal count={snap.nodes} onClose={() => setModalOpen(false)} />}
    </>
  );
}

function NodeBudgetModal({ count, onClose }: { count: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="solenoid-nbmodal" onPointerDown={onClose}>
      <div className="solenoid-nbmodal__panel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="solenoid-nbmodal__title">Large graph on the web demo</div>
        <p className="solenoid-nbmodal__body">
          This graph has {count} nodes, past the demo's soft budget of{" "}
          <strong>{WEB_DEMO_NODE_BUDGET}</strong>. The in-browser demo renders the graph
          as DOM, so pan and zoom get choppy at this size.
        </p>
        <p className="solenoid-nbmodal__body">
          Nothing is blocked. The <strong>desktop app</strong> runs smoother on large
          graphs, and collapsing or grouping nodes helps here too.
        </p>
        <div className="solenoid-nbmodal__actions">
          <button type="button" className="solenoid-nbmodal__ok" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
