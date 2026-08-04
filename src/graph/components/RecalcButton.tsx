import { requestRecalc } from "../process";
import "./nodeCard.css";
import { stopDragStart } from "../coarse";

/**
 * Reusable "recalculate" control: `requestRecalc()` bumps the volatile-node
 * generation and re-evaluates the graph, so every volatile node rolls a fresh
 * value.
 */
export function RecalcButton({ title = "Recalculate" }: { title?: string }) {
  return (
    <button
      type="button"
      className="solenoid-node__recalc-btn"
      title={title}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void requestRecalc();
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="4.5" y="3.5" width="7" height="2.4" rx="0.5" fill="currentColor" />
        <circle cx="5.4" cy="8.6" r="0.9" fill="currentColor" />
        <circle cx="8" cy="8.6" r="0.9" fill="currentColor" />
        <circle cx="10.6" cy="8.6" r="0.9" fill="currentColor" />
        <circle cx="5.4" cy="11.4" r="0.9" fill="currentColor" />
        <circle cx="8" cy="11.4" r="0.9" fill="currentColor" />
        <circle cx="10.6" cy="11.4" r="0.9" fill="currentColor" />
      </svg>
      <span>Recalculate</span>
    </button>
  );
}
