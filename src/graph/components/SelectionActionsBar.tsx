import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { getEditor, getArea } from "../process";
import { canvasLockStore } from "../canvasLock";
import { alignSelection, distributeSelection, type AlignKind } from "../selectionOps";
import "./selectionActions.css";

// Contextual align/distribute cluster: the six aligns + two distributes live only
// in the Command Palette otherwise, and the standing rule is that nothing is
// reachable solely via the palette. This floating pill appears at the bottom of
// the canvas whenever ≥2 top-level nodes are selected — the visible surface for
// the align/distribute ops. Logic is entirely in selectionOps.ts; this is surface.
//
// Selection has no push-based store (OutlinePanel polls the graph the same way),
// so a light interval reads how many selected nodes have a rendered view — the
// same "measurable" set align/distribute actually act on. Fixed position (not
// anchored to the selection bbox) so it never fights the area transform or lags a
// drag; the selection itself is already highlighted on the canvas.

const POLL_MS = 150;

function selectedVisibleCount(): number {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return 0;
  let n = 0;
  for (const node of editor.getNodes()) {
    if ((node as { selected?: boolean }).selected !== true) continue;
    if (area.nodeViews.get(node.id)) n++;
  }
  return n;
}

// 16×16 (even) glyphs so they centre on a whole pixel in the 26px button box.
// Bars are filled rects; the guide edge is a thin rect in the same ink.
const AlignLeftIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="2" y="2" width="1.4" height="12" rx="0.5" />
    <rect x="4" y="4" width="9" height="2.6" rx="1" />
    <rect x="4" y="9.4" width="6" height="2.6" rx="1" />
  </svg>
);
const AlignCenterHIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="7.3" y="2" width="1.4" height="12" rx="0.5" />
    <rect x="3.5" y="4" width="9" height="2.6" rx="1" />
    <rect x="5" y="9.4" width="6" height="2.6" rx="1" />
  </svg>
);
const AlignRightIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="12.6" y="2" width="1.4" height="12" rx="0.5" />
    <rect x="3" y="4" width="9" height="2.6" rx="1" />
    <rect x="6" y="9.4" width="6" height="2.6" rx="1" />
  </svg>
);
const AlignTopIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="2" y="2" width="12" height="1.4" rx="0.5" />
    <rect x="4" y="4" width="2.6" height="9" rx="1" />
    <rect x="9.4" y="4" width="2.6" height="6" rx="1" />
  </svg>
);
const AlignCenterVIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="2" y="7.3" width="12" height="1.4" rx="0.5" />
    <rect x="4" y="3.5" width="2.6" height="9" rx="1" />
    <rect x="9.4" y="5" width="2.6" height="6" rx="1" />
  </svg>
);
const AlignBottomIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="2" y="12.6" width="12" height="1.4" rx="0.5" />
    <rect x="4" y="3" width="2.6" height="9" rx="1" />
    <rect x="9.4" y="6" width="2.6" height="6" rx="1" />
  </svg>
);
const DistributeHIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="2.5" y="3" width="2.4" height="10" rx="1" />
    <rect x="6.8" y="3" width="2.4" height="10" rx="1" />
    <rect x="11.1" y="3" width="2.4" height="10" rx="1" />
  </svg>
);
const DistributeVIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ display: "block" }}>
    <rect x="3" y="2.5" width="10" height="2.4" rx="1" />
    <rect x="3" y="6.8" width="10" height="2.4" rx="1" />
    <rect x="3" y="11.1" width="10" height="2.4" rx="1" />
  </svg>
);

type AlignBtn = { kind: AlignKind; title: string; Icon: () => ReactElement };
// Labels name the END EFFECT (matching the Command Palette): center-h aligns the
// horizontal centres, stacking the nodes vertically, and vice versa.
const ALIGN_BTNS: AlignBtn[] = [
  { kind: "left", title: "Align left", Icon: AlignLeftIcon },
  { kind: "center-h", title: "Align center (vertical)", Icon: AlignCenterHIcon },
  { kind: "right", title: "Align right", Icon: AlignRightIcon },
  { kind: "top", title: "Align top", Icon: AlignTopIcon },
  { kind: "center-v", title: "Align center (horizontal)", Icon: AlignCenterVIcon },
  { kind: "bottom", title: "Align bottom", Icon: AlignBottomIcon },
];

export function SelectionActionsBar() {
  const [count, setCount] = useState(0);
  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);

  useEffect(() => {
    let prev = -1;
    const tick = () => {
      const c = selectedVisibleCount();
      if (c !== prev) { prev = c; setCount(c); }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // A locked canvas can't move nodes, so the ops are inert — hide entirely.
  if (locked || count < 2) return null;
  const canDistribute = count >= 3;

  return (
    <div
      className="solenoid-selbar"
      // A pointerdown on the overlay must not bubble to the canvas selection
      // handling (same guard the mobile bar uses), so clicking a button keeps
      // the selection the op is about to act on.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {ALIGN_BTNS.map(({ kind, title, Icon }) => (
        <button
          key={kind}
          type="button"
          className="solenoid-selbar__btn"
          title={title}
          aria-label={title}
          onClick={() => void alignSelection(kind)}
        >
          <Icon />
        </button>
      ))}
      <span className="solenoid-selbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="solenoid-selbar__btn"
        title="Distribute horizontally"
        aria-label="Distribute horizontally"
        disabled={!canDistribute}
        onClick={() => void distributeSelection("h")}
      >
        <DistributeHIcon />
      </button>
      <button
        type="button"
        className="solenoid-selbar__btn"
        title="Distribute vertically"
        aria-label="Distribute vertically"
        disabled={!canDistribute}
        onClick={() => void distributeSelection("v")}
      >
        <DistributeVIcon />
      </button>
    </div>
  );
}
