import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { frameHintStore, type FrameHint } from "../frameHint";
import { formatFrameCell } from "../frame";
import { SocketValuePeek } from "./SocketValuePeek";
import "./frameHint.css";

/** The example mini-table itself, shared by the floating hover layer and the
 *  Inspector's per-socket rendering — one markup for one declaration. */
export function FrameHintTable({ hint }: { hint: FrameHint }) {
  const cols = hint.columns;
  const rows = cols.reduce((m, c) => Math.max(m, c.cells.length), 0);
  return (
    <>
      <table>
        <thead>
          <tr>
            {cols.map((c, i) => <th key={i} className="solenoid-frame-hint__name">{c.name}</th>)}
          </tr>
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
      {/* One muted word carries "this is an example, not your data". */}
      <div className="solenoid-frame-hint__tag">example</div>
    </>
  );
}

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
    // Wheel: a zoom would move the anchor out from under it. Pointerdown:
    // the touch dismissal (tap anywhere) — mouse hides on leave anyway.
    window.addEventListener("wheel", hide, { passive: true });
    document.addEventListener("pointerdown", hide, true);
    // Touch has no leave event, so a shown hint also times itself out.
    const t = window.setTimeout(hide, 4000);
    return () => {
      window.removeEventListener("wheel", hide);
      document.removeEventListener("pointerdown", hide, true);
      clearTimeout(t);
    };
  }, [state]);

  if (!state) return null;
  // A live VALUE peek renders the socket's value as a scaled-down Display; the declared
  // EXAMPLE hint renders the miniature TablePopup grid. Both share the positioning +
  // hide logic above (one open at a time).
  if (state.kind === "value") {
    return (
      <div className="solenoid-socket-peek" ref={ref} aria-hidden="true">
        <SocketValuePeek value={state.value} nodeId={state.nodeId} />
      </div>
    );
  }
  return (
    <div className="solenoid-frame-hint" ref={ref} aria-hidden="true">
      {/* The TablePopup grid in miniature — sunken column heads + gridlines —
          so the hint reads as "the frame popup, tiny". */}
      <FrameHintTable hint={state.hint} />
    </div>
  );
}
