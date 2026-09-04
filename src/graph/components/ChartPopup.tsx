import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { chartPopup } from "../chartPopupStore";
import { appThemeStore } from "../appTheme";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { ChartView, ChartFigure } from "./chartView";
import { PopupShell, popupCardVars } from "./PopupShell";
import { clamp } from "../nodes/mathUtils";
import { recordNavTarget, stepRecordRow } from "./recordNav";

// ChartView needs explicit pixel dims (no ResponsiveContainer), and this popup is
// a viewport-centered overlay, so window size is the correct measure.
const MAX_W = 1000;
const MAX_H = 380;
// Card chrome to leave room for inside the viewport.
const MARGIN_X = 32;
const CHROME_Y = 32 /* overlay margin */ + 38 /* header */ + 32 /* chart padding */;

// The FIGURE size the popup opens at (fills the viewport up to the caps). The card is
// this plus its chrome; after that the figure follows its measured region so a resize
// grows it.
function chartSize() {
  const w = clamp(window.innerWidth - MARGIN_X - 32, 200, MAX_W);
  const h = clamp(window.innerHeight - CHROME_Y, 140, MAX_H);
  return { w, h };
}
const FIG_PAD = 16;    // the figure region's inline padding, each side
const CARD_CHROME = 40; // header height + the card's own top/bottom border

/** A big read-only view of a Sparkline / Chart, opened from the node's expand
 *  button; reads its module store, mounted once in App. */
export function ChartPopup() {
  const state = useSyncExternalStore(chartPopup.subscribe, chartPopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  // An FC on the host node's chart output scales the figure text here too.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const fontScale = state?.pinNodeId
    ? formatAnnotationStore.getForNode(state.pinNodeId)?.chartFontScale
    : undefined;
  // The figure follows its measured region (which fills the card), so a popup resize
  // grows the chart. Starts at the window-fit size until the region first measures.
  const figRef = useRef<HTMLDivElement>(null);
  const [{ w, h }, setFig] = useState(chartSize);
  useLayoutEffect(() => {
    const el = figRef.current;
    if (!el) return;
    const measure = () => {
      const mw = Math.max(160, el.clientWidth - FIG_PAD * 2);
      const mh = Math.max(120, el.clientHeight - FIG_PAD * 2);
      setFig((prev) => (prev.w === mw && prev.h === mh ? prev : { w: mw, h: mh }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  // ←/→ page a Record card's popup without closing it — the on-screen prev/next by
  // keyboard. canvasKeyboard already stands down under the overlay (modalGuard), so this
  // is the only handler seeing the arrows; each step swaps the fresh chart into the
  // snapshot. Bound here (a hook, before the early return); a no-op when the popup isn't
  // a steppable record. Ignored while focus is in a field (there are none today, but safe).
  useEffect(() => {
    if (!state) return;
    const s = state;
    const rid = s.value?.op === "record" && s.pinNodeId ? recordNavTarget(s.pinNodeId) : null;
    if (!rid) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      void stepRecordRow(rid, e.key === "ArrowRight" ? 1 : -1).then((fresh) => {
        if (fresh) chartPopup.open({ ...s, value: fresh });
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  if (!state) return null;
  const initialCard = (() => { const f = chartSize(); return { w: f.w + FIG_PAD * 2, h: f.h + FIG_PAD * 2 + CARD_CHROME }; })();
  const cardStyle = popupCardVars(state);

  // A record card pages here too: step the node's Row, then swap the fresh
  // chart into this popup's snapshot (the popup holds a value, not a
  // subscription) — recordNav.ts.
  const recordId = state.value?.op === "record" && state.pinNodeId ? recordNavTarget(state.pinNodeId) : null;
  const recordStep = recordId
    ? (delta: number) => {
        void stepRecordRow(recordId, delta).then((fresh) => {
          if (fresh) chartPopup.open({ ...state, value: fresh });
        });
      }
    : undefined;

  return (
    <PopupShell
      title={state.title}
      onClose={() => chartPopup.close()}
      cardStyle={cardStyle}
      headerExtra={state.series && <span className="table-popup__dims">{state.series.length} pts</span>}
      pinNodeId={state.pinNodeId}
      resizable={{ min: { w: 260, h: 200 }, initial: initialCard }}
    >
      <div ref={figRef} className="sol-popup__scroll" style={{ padding: FIG_PAD, display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        {state.value ? (
          // Title stripped (the value's and the option's) — the popup header
          // already shows it; an in-figure copy would double it.
          <ChartFigure
            value={{
              ...state.value,
              title: undefined,
              options: state.value.options ? { ...state.value.options, title: undefined } : state.value.options,
            }}
            width={w}
            height={h}
            fontScale={fontScale}
            recordNav={recordStep}
          />
        ) : !state.series || state.series.length === 0 ? (
          <div style={{ color: "var(--text-dim, #888)", padding: 40 }}>No data</div>
        ) : (
          <ChartView
            op={state.op ?? "column"}
            series={state.series}
            labels={state.labels}
            width={w}
            height={h}
            axes={state.axes ?? true}
            signColors={state.signColors}
            opts={state.opts ? { ...state.opts, title: undefined } : undefined}
            fontScale={fontScale}
          />
        )}
      </div>
    </PopupShell>
  );
}
