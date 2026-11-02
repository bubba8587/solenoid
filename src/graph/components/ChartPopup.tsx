// [[C100]] chartIsAValue
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { chartPopup } from "../chartPopupStore";
import { appThemeStore } from "../appTheme";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { ChartView, ChartFigure } from "./chartView";
import { PopupSkeleton, useAfterPaint } from "./PopupSkeleton";
import { PopupShell, popupCardVars } from "./PopupShell";
import { clamp } from "../nodes/mathUtils";
import { recordNavTarget, recordDetailTarget, setRecordQuery, stepRecordRow } from "./recordNav";
import { SearchField } from "./SearchField";
import { ladderTarget, applyLadderAction } from "./ladderNav";
import type { LadderAction } from "../nodes/ladderOps";
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
  const painted = useAfterPaint(state ? `${state.pinNodeId ?? ""}|${state.title}` : null);
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
  }, [state, painted]);

  // One value per opened chart, so a resize doesn't hand the figure a new value and redraw a heavy one.
  const shown = state?.value;
  const figValue = useMemo(() => shown && {
    ...shown,
    title: undefined,
    options: shown.options ? { ...shown.options, title: undefined } : shown.options,
  }, [shown]);

  // Detail's filter, the Form view's twin: it lives while the popup shows this Record and clears when it closes.
  const detailId = state?.value?.op === "record" && state.pinNodeId ? recordDetailTarget(state.pinNodeId) : null;
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!detailId) return;
    return () => { setQuery(""); void setRecordQuery(detailId, ""); };
  }, [detailId]);
  const filterDetail = (next: string) => {
    setQuery(next);
    if (!detailId || !state) return;
    const s = state;
    void setRecordQuery(detailId, next).then((fresh) => {
      if (fresh && chartPopup.get()?.pinNodeId === s.pinNodeId) chartPopup.open({ ...chartPopup.get()!, value: fresh });
    });
  };

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
  // A ladder grows downward like a Gantt, so it opens as tall.
  const isTall = isGantt || state.value?.op === "ladder";
  const initialCard = (() => { const f = chartSize(isTall ? MAX_H_GANTT : MAX_H); return { w: f.w + FIG_PAD * 2, h: f.h + FIG_PAD * 2 + CARD_CHROME }; })();
  const cardStyle = popupCardVars(state);
  const resizable = { min: isGantt ? { w: 520, h: 300 } : { w: 260, h: 200 }, initial: initialCard };
  // Open at once: the shell (at its final size, which it takes only on mount) and a skeleton paint first, and the
  // figure draws the frame after.
  if (!painted) {
    return (
      <PopupShell title={state.title} onClose={() => chartPopup.close()} cardStyle={cardStyle} resizable={resizable}>
        <PopupSkeleton />
      </PopupShell>
    );
  }

  const copySvg = ganttPayload
    ? () => {
        const svg = ganttSvg(ganttPayload, { width: Math.round(w) });
        void navigator.clipboard?.writeText(svg);
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

  const ladderId = state.value?.op === "ladder" && state.pinNodeId ? ladderTarget(state.pinNodeId) : null;
  const ladderAct = ladderId
    ? (a: LadderAction) => {
        void applyLadderAction(ladderId, a).then((fresh) => {
          if (fresh) chartPopup.open({ ...state, value: fresh });
        });
      }
    : undefined;

  // A Record view other than Detail is a stack of boxes taller than the popup, not a drawing that scales: it scrolls
  // from its top, where centering would push its first rows out of reach. Detail scrolls inside its own grid.
  const stacked = figValue?.op === "record" && figValue.payload?.kind === "record" && figValue.payload.view !== "detail";
  return (
    <PopupShell
      title={state.title}
      onClose={() => chartPopup.close()}
      cardStyle={cardStyle}
      headerExtra={detailId
        ? <SearchField collapsible value={query} onChange={filterDetail} placeholder="Filter" label="Filter records" count={query.trim() && figValue?.payload?.kind === "record" ? `${figValue.payload.total} matches` : undefined} />
        : state.series && <span className="table-popup__dims">{state.series.length} pts</span>}
      menuItems={copySvg ? [{ label: "Copy SVG", onClick: copySvg }] : []}
      pinNodeId={state.pinNodeId}
      resizable={resizable}
    >
      <div ref={figRef} className="sol-popup__scroll" style={stacked ? { padding: FIG_PAD, overflow: "auto" } : { padding: FIG_PAD, display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        {figValue ? (
          <ChartFigure
            value={figValue}
            width={w}
            height={h}
            fontScale={fontScale}
            recordNav={recordStep}
            ladderAction={ladderAct}
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
