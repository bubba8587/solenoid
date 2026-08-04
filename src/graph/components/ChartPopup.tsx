import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { chartPopup } from "../chartPopupStore";
import { appThemeStore } from "../appTheme";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { ChartView, ChartFigure } from "./chartView";
import { PopupShell, popupCardVars } from "./PopupShell";
import { clamp } from "../nodes/mathUtils";

// ChartView needs explicit pixel dims (no ResponsiveContainer), and this popup is
// a viewport-centered overlay, so window size is the correct measure.
const MAX_W = 1000;
const MAX_H = 380;
// Card chrome to leave room for inside the viewport.
const MARGIN_X = 32;
const CHROME_Y = 32 /* overlay margin */ + 38 /* header */ + 32 /* chart padding */;

function chartSize() {
  const w = clamp(window.innerWidth - MARGIN_X - 32, 200, MAX_W);
  const h = clamp(window.innerHeight - CHROME_Y, 140, MAX_H);
  return { w, h };
}

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
  const [{ w, h }, setSize] = useState(chartSize);

  useEffect(() => {
    if (!state) return;
    setSize(chartSize());
    const onResize = () => setSize(chartSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [state]);

  if (!state) return null;
  const cardStyle = popupCardVars(state);

  return (
    <PopupShell
      title={state.title}
      onClose={() => chartPopup.close()}
      cardStyle={cardStyle}
      headerExtra={state.series && <span className="table-popup__dims">{state.series.length} pts</span>}
      pinNodeId={state.pinNodeId}
    >
      <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center" }}>
        {state.value ? (
          // Title stripped — the popup header already shows it.
          <ChartFigure value={{ ...state.value, title: undefined }} width={w} height={h} fontScale={fontScale} />
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
