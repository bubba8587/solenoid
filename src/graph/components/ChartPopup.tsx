import { useEffect, useState, type CSSProperties } from "react";
import { useSyncExternalStore } from "react";
import { chartPopup } from "../chartPopupStore";
import { appThemeStore } from "../appTheme";
import { ChartView, ChartFigure } from "./chartView";
import "./popupChrome.css";
import { CloseIcon } from "./CloseIcon";
import { PopupPinButton, PopupGoToButton } from "./PopupPinButton";
import { useEscapeToClose } from "./useEscapeToClose";
import { clamp } from "../nodes/mathUtils";

// Desktop max; the chart shrinks to fit smaller viewports (phones) so the popup
// never overflows the screen. ChartView needs explicit pixel dims (no
// ResponsiveContainer — see dev-notes), but the popup is a viewport-centred
// overlay, so window size is a stable, correct measure here.
const MAX_W = 1000;
const MAX_H = 380;
// Card chrome we must leave room for inside the viewport: ~16px overlay margin
// each side, plus the header (~38px) and the 16px chart padding top+bottom.
const MARGIN_X = 32;
const CHROME_Y = 32 /* overlay margin */ + 38 /* header */ + 32 /* chart padding */;

function chartSize() {
  const w = clamp(window.innerWidth - MARGIN_X - 32, 200, MAX_W);
  const h = clamp(window.innerHeight - CHROME_Y, 140, MAX_H);
  return { w, h };
}

/**
 * A big read-only view of a Sparkline / Chart, opened from the node's expand
 * button. Mirrors FormulaPopup / TablePopup: reads its module store, mounted
 * once in App, closes on overlay click or Escape.
 */
export function ChartPopup() {
  const state = useSyncExternalStore(chartPopup.subscribe, chartPopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [{ w, h }, setSize] = useState(chartSize);

  useEscapeToClose(() => chartPopup.close(), !!state, { capture: true });

  useEffect(() => {
    if (!state) return;
    setSize(chartSize());
    const onResize = () => setSize(chartSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [state]);

  if (!state) return null;
  const cardStyle: CSSProperties = {};
  if (state.accent) (cardStyle as Record<string, string>)["--node-accent"] = state.accent;

  return (
    <div className="sol-popup-overlay" onPointerDown={() => chartPopup.close()}>
      <div className="sol-popup" style={cardStyle} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sol-popup__header">
          <div className="sol-popup__title">{state.title}</div>
          {state.series && <span className="table-popup__dims">{state.series.length} pts</span>}
          {state.pinNodeId && <PopupGoToButton nodeId={state.pinNodeId} onClose={() => chartPopup.close()} />}
          {state.pinNodeId && <PopupPinButton nodeId={state.pinNodeId} />}
          <button className="sol-popup__close" onClick={() => chartPopup.close()} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
        <div style={{ padding: 16, display: "flex", justifyContent: "center", alignItems: "center" }}>
          {state.value ? (
            // General path: render any ChartValue (covers treemap / sankey /
            // composed / bubble / kpi / bullet), title stripped (header shows it).
            <ChartFigure value={{ ...state.value, title: undefined }} width={w} height={h} />
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
              // The header already shows the title — strip it so ChartView
              // doesn't draw a second one above the plot.
              opts={state.opts ? { ...state.opts, title: undefined } : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
