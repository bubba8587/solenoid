import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { frameHintStore } from "../frameHint";
import { formatFrameCell } from "../frame";
import "./frameHint.css";

/** The floating example mini-table for a hovered frame-input socket. Fixed
 *  screen-space (like a tooltip — it does not scale with the canvas), anchored
 *  to the LEFT of the socket, flipping right when the viewport edge is close.
 *  Any wheel (zoom would move the anchor out from under it) hides it. */
export function FrameHintLayer() {
  const state = useSyncExternalStore(frameHintStore.subscribe, frameHintStore.get);
  const ref = useRef<HTMLDivElement>(null);

  // Position after render, when the popup's size is measurable.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state) return;
    const { anchor } = state;
    const r = el.getBoundingClientRect();
    const gap = 10;
    let left = anchor.left - gap - r.width;
    if (left < 8) left = anchor.right + gap; // no room on the left → flip
    const top = Math.min(Math.max(anchor.centerY - r.height / 2, 8), window.innerHeight - r.height - 8);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [state]);

  useLayoutEffect(() => {
    if (!state) return;
    const hide = () => frameHintStore.close();
    window.addEventListener("wheel", hide, { passive: true });
    return () => window.removeEventListener("wheel", hide);
  }, [state]);

  if (!state) return null;
  const cols = state.hint.columns;
  const rows = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
  return (
    <div className="solenoid-frame-hint" ref={ref} aria-hidden="true">
      <table>
        <thead>
          <tr>{cols.map((c, i) => <th key={i}>{c.name}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {cols.map((c, i) => {
                const cell = c.cells[r];
                const shown = cell === undefined ? "" : formatFrameCell(c.type, cell);
                return (
                  <td key={i} data-num={c.type === "number" ? "" : undefined}>
                    {shown === null ? "" : String(shown)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="solenoid-frame-hint__tag">example</div>
    </div>
  );
}
