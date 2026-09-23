// [[D18]] frameLabelHint
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { frameHintStore, type FrameHint } from "../frameHint";
import { formatFrameCell } from "../frame";
import { SocketValuePeek } from "./SocketValuePeek";
import "./frameHint.css";

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
      <div className="solenoid-frame-hint__tag">example</div>
    </>
  );
}

export function FrameHintLayer() {
  const state = useSyncExternalStore(frameHintStore.subscribe, frameHintStore.get);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state) return;
    const { anchor } = state;
    const r = el.getBoundingClientRect();
    const gap = 10;
    let left = anchor.left - gap - r.width;
    if (left < 8) left = anchor.right + gap;
    const top = Math.min(Math.max(anchor.centerY - r.height / 2, 8), window.innerHeight - r.height - 8);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [state]);

  useLayoutEffect(() => {
    if (!state) return;
    const hide = () => frameHintStore.close();
    // A zoom would move the anchor out from under it; a press is the touch dismissal.
    window.addEventListener("wheel", hide, { passive: true });
    document.addEventListener("pointerdown", hide, true);
    const t = window.setTimeout(hide, 4000);
    return () => {
      window.removeEventListener("wheel", hide);
      document.removeEventListener("pointerdown", hide, true);
      clearTimeout(t);
    };
  }, [state]);

  if (!state) return null;
  if (state.kind === "value") {
    return (
      <div className="solenoid-socket-peek" ref={ref} aria-hidden="true">
        <SocketValuePeek value={state.value} nodeId={state.nodeId} />
      </div>
    );
  }
  return (
    <div className="solenoid-frame-hint" ref={ref} aria-hidden="true">
      <FrameHintTable hint={state.hint} />
    </div>
  );
}
