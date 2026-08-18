import { useEffect, useState, useSyncExternalStore } from "react";
import { presentationStore } from "../presentationStore";
import { getEditor } from "../process";
import { flyToNodes } from "../flyToNode";
import type { PresentationNode } from "../nodes/presentation";
import { CloseIcon } from "./CloseIcon";
import "./PresentationOverlay.css";

// Drives the camera through a Presentation node's steps and hides the app chrome (restored
// on exit) — the canvas itself is the slide.

export function PresentationOverlay() {
  useSyncExternalStore(presentationStore.subscribe, presentationStore.version);
  const activeId = presentationStore.activeId();
  if (!activeId) return null;
  return <PresentationRunner key={activeId} nodeId={activeId} />;
}

function PresentationRunner({ nodeId }: { nodeId: string }) {
  const node = getEditor()?.getNode(nodeId) as PresentationNode | undefined;
  const steps = node?.steps ?? [];
  const [idx, setIdx] = useState(0);

  const exit = () => presentationStore.stop();
  const go = (i: number) => {
    if (steps.length === 0) return;
    const clamped = Math.max(0, Math.min(i, steps.length - 1));
    setIdx(clamped);
    if (node) node.activeIndex = clamped;
  };
  const next = () => go(idx + 1);
  const prev = () => go(idx - 1);

  useEffect(() => {
    document.documentElement.classList.add("solenoid-presenting");
    return () => document.documentElement.classList.remove("solenoid-presenting");
  }, []);

  useEffect(() => {
    const step = steps[idx];
    if (step && step.nodeIds.length) flyToNodes(step.nodeIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // No dep array, so each render's handler closes over the current idx.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      switch (e.key) {
        case " ": case "ArrowRight": case "ArrowDown": case "PageDown": case "Enter":
          e.preventDefault(); next(); break;
        case "ArrowLeft": case "ArrowUp": case "PageUp":
          e.preventDefault(); prev(); break;
        case "Home": e.preventDefault(); go(0); break;
        case "End": e.preventDefault(); go(steps.length - 1); break;
        case "Escape": e.preventDefault(); exit(); break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!node) { presentationStore.stop(); return null; }
  const step = steps[idx];

  return (
    // The whole layer advances on click, so the control bar must stop propagation.
    <div className="solenoid-present" onClick={next}>
      <div className="solenoid-present__bar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="solenoid-present__btn"
          onClick={prev}
          disabled={idx === 0}
          title="Previous (←)"
        >‹</button>
        <div className="solenoid-present__label">
          <span className="solenoid-present__title">
            {steps.length === 0 ? "No steps" : (step?.title || `Step ${idx + 1}`)}
          </span>
          <span className="solenoid-present__counter">
            {steps.length === 0 ? "0 / 0" : `${idx + 1} / ${steps.length}`}
          </span>
        </div>
        <button
          type="button"
          className="solenoid-present__btn"
          onClick={next}
          disabled={steps.length === 0 || idx === steps.length - 1}
          title="Next (→ or Space)"
        >›</button>
        <button
          type="button"
          className="solenoid-present__btn solenoid-present__btn--exit"
          onClick={exit}
          title="Exit (Esc)"
          aria-label="Exit presentation"
        ><CloseIcon size={16} /></button>
      </div>
    </div>
  );
}
