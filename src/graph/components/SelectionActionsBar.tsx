import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { getActiveEditor as getEditor, getActiveView as getView, subscribeActiveGraph } from "../activeGraph";
import { canvasLockStore } from "../canvasLock";
import { alignSelection, distributeSelection, type AlignKind } from "../selectionOps";
import "./selectionActions.css";

// TOP-center so it never collides with the bottom-docked palette, and FIXED (not
// anchored to the selection bbox) so it never fights the view transform. Selection
// has no push store, so a light interval counts the selected nodes with a view.

const POLL_MS = 150;

function selectedVisibleCount(): number {
  const editor = getEditor();
  const view = getView();
  if (!editor || !view) return 0;
  let n = 0;
  for (const node of editor.getNodes()) {
    if ((node as { selected?: boolean }).selected !== true) continue;
    if (view.hasNode(node.id)) n++;
  }
  return n;
}

// 16×16 (even) glyphs so they center on a whole pixel in the 26px button box.
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
// Labels name the END EFFECT, matching the Command Palette.
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
  // The ops act on the ACTIVE graph (a drill-in included); re-render on the swap.
  useSyncExternalStore(subscribeActiveGraph, () => 0);

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

  if (locked || count < 2) return null;
  const canDistribute = count >= 3;

  return (
    <div
      className="solenoid-selbar"
      // A pointerdown must not bubble to the canvas selection handling, or the
      // click clears the selection the op is about to act on.
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
