// [[C100]] chartIsAValue
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { chartPopup } from "../chartPopupStore";
import { appThemeStore } from "../appTheme";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { ChartView, ChartFigure } from "./chartView";
import { PopupShell, popupCardVars } from "./PopupShell";
import { clamp } from "../nodes/mathUtils";
import { recordNavTarget, stepRecordRow } from "./recordNav";
import { ganttSvg, type GanttPayload } from "@solenoid/gantt-layout";

const MAX_W = 1000;
const MAX_H = 380;
const MAX_H_GANTT = 680;
const MARGIN_X = 32;
const CHROME_Y = 32 /* overlay margin */ + 38 /* header */ + 32 /* chart padding */;

function chartSize(maxH = MAX_H) {
  const w = clamp(window.innerWidth - MARGIN_X - 32, 200, MAX_W);
  const h = clamp(window.innerHeight - CHROME_Y, 140, maxH);
  return { w, h };
}
const FIG_PAD = 16;    // the figure region's inline padding, each side
const CARD_CHROME = 40; // header height + the card's own top/bottom border

export function ChartPopup() {
  const state = useSyncExternalStore(chartPopup.subscribe, chartPopup.get);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const fontScale = state?.pinNodeId
    ? formatAnnotationStore.getForNode(state.pinNodeId)?.chartFontScale
    : undefined;
  const figRef = useRef<HTMLDivElement>(null);
  const [{ w, h }, setFig] = useState(chartSize);
  const [copied, setCopied] = useState(false);
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

  // A hook before the early return. canvasKeyboard stands down under the overlay (modalGuard), so this is the only arrow handler.
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
  const isGantt = state.value?.op === "gantt";
  const ganttPayload = isGantt && state.value?.payload?.kind === "gantt" ? (state.value.payload as GanttPayload) : null;
  const initialCard = (() => { const f = chartSize(isGantt ? MAX_H_GANTT : MAX_H); return { w: f.w + FIG_PAD * 2, h: f.h + FIG_PAD * 2 + CARD_CHROME }; })();
  const cardStyle = popupCardVars(state);

  const copySvg = ganttPayload
    ? () => {
        const svg = ganttSvg(ganttPayload, { width: Math.round(w) });
        void navigator.clipboard?.writeText(svg).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }
    : null;

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
      headerActions={copySvg
        ? <button type="button" className="sol-popup__action" onClick={copySvg}>{copied ? "Copied" : "Copy SVG"}</button>
        : undefined}
      pinNodeId={state.pinNodeId}
      resizable={{ min: isGantt ? { w: 520, h: 300 } : { w: 260, h: 200 }, initial: initialCard }}
    >
      <div ref={figRef} className="sol-popup__scroll" style={{ padding: FIG_PAD, display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        {state.value ? (
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
            virtualize={isGantt}
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
