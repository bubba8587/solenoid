// [[C129]] describeDashboard, [[C120]] linearWork
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DescribeTile } from "../describeProfile";
import { defaultCellText } from "../cellText";
import { APP_LOCALE } from "../locale";
import { ChartView, useChartColors } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { TypeIcon } from "./TypeIcon";
import { setDashboardView } from "../tablePopupStore";
import "./DescribeDashboard.css";

const MIN_TILE = 220;
/** A narrow popup, a phone's, fits two tiles a row at this width. */
const MIN_TILE_NARROW = 160;
const GAP = 10;
/** A tile's padding and border, which its charts sit inside. */
const TILE_INSET = 2 * 10 + 2;
const HIST_H = 64;
const TREND_H = 28;

const count = (n: number) => n.toLocaleString(APP_LOCALE);

/** As many tiles a row as fit at `MIN_TILE`, stretched to fill it. */
function useTileWidth(): { ref: (el: HTMLElement | null) => void; width: number } {
  const [grid, setGrid] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(MIN_TILE);
  useLayoutEffect(() => {
    if (!grid) return;
    const measure = () => {
      const w = grid.clientWidth;
      const min = w <= 640 ? MIN_TILE_NARROW : MIN_TILE;
      const cols = Math.max(1, Math.floor((w + GAP) / (min + GAP)));
      const next = Math.floor((w - GAP * (cols - 1)) / cols);
      setWidth((cur) => (cur === next || next <= 0 ? cur : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    measure();
    return () => ro.disconnect();
  }, [grid]);
  return { ref: setGrid, width };
}

/** True once the element has scrolled into view: a tile draws its charts only then. */
function useSeen<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setSeen(true); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function Tile({ tile, width }: { tile: DescribeTile; width: number }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const { viz } = useChartColors();
  const plotW = Math.max(60, width - TILE_INSET);
  const rows = tile.count + tile.blank;
  const filled = rows ? tile.count / rows : 0;
  const text = (v: number | null | undefined) => (v == null ? "" : defaultCellText(tile.type, v, tile.format));
  const hist = tile.hist;
  // Each bin by its lower edge, to three figures as the Histogram node's are.
  const edge = (v: number) => text(tile.type === "date" ? v : Number(v.toPrecision(3)));
  const binLabels = hist ? hist.counts.map((_, i) => edge(hist.min + (i * (hist.max - hist.min)) / hist.counts.length)) : [];
  const histSeries = hist ? hist.counts.map((v, i) => ({ i, v })) : [];
  const trendSeries = tile.trend ? tile.trend.map((v, i) => ({ i, v })) : [];
  const topMax = tile.top?.values[0]?.count ?? 0;
  return (
    <div ref={ref} className="describe-dash__tile" style={{ width }}>
      <div className="describe-dash__head">
        <span className="describe-dash__icon"><TypeIcon type={tile.type} size={11} /></span>
        <span className="describe-dash__name" title={tile.name}>{tile.name}</span>
        <span className="describe-dash__distinct">{count(tile.distinct)} distinct</span>
      </div>
      <div className="describe-dash__fill" title={`${count(tile.count)} filled, ${count(tile.blank)} blank`}>
        <span className="describe-dash__fillbar"><span style={{ width: `${filled * 100}%` }} /></span>
        <span className="describe-dash__filltext">{count(tile.count)} filled{tile.blank ? ` · ${count(tile.blank)} blank` : ""}</span>
      </div>

      {hist && (
        <div className="describe-dash__chart" style={{ height: HIST_H }}>
          {seen && <ChartView op="column" series={histSeries} width={plotW} height={HIST_H} axes={false} labels={binLabels} />}
          <ChartExpandButton title={`${tile.name}: distribution`} op="column" axes series={histSeries} labels={binLabels} />
        </div>
      )}
      {hist && (
        <div className="describe-dash__range">
          <span>{text(hist.min)}</span>
          <span>{text(hist.max)}</span>
        </div>
      )}
      {tile.trend && (
        <div className="describe-dash__chart describe-dash__trend" style={{ height: TREND_H }}>
          {seen && <ChartView op="line" series={trendSeries} width={plotW} height={TREND_H} axes={false} />}
          <ChartExpandButton title={tile.name} op="line" axes series={trendSeries} />
        </div>
      )}
      {tile.top && (
        <div className="describe-dash__top">
          {tile.top.values.map((t) => (
            <div key={t.text} className="describe-dash__toprow" title={`${t.text}: ${count(t.count)}`}>
              <span className="describe-dash__toplabel">{t.text === "" ? "(empty)" : tile.type === "number" || tile.type === "date" ? text(Number(t.text)) : t.text}</span>
              <span className="describe-dash__topbar"><span style={{ width: `${topMax ? (t.count / topMax) * 100 : 0}%`, background: viz }} /></span>
              <span className="describe-dash__topcount">{count(t.count)}</span>
            </div>
          ))}
          {tile.top.other > 0 && <div className="describe-dash__other">{count(tile.top.other)} more in other values</div>}
          {tile.top.values.length === 0 && <div className="describe-dash__other">No values</div>}
        </div>
      )}
      {(tile.mean != null || tile.median != null) && (
        <div className="describe-dash__stats">
          {tile.mean != null && <span><span className="describe-dash__statname">Mean</span> {text(tile.mean)}</span>}
          {tile.median != null && <span><span className="describe-dash__statname">Median</span> {text(tile.median)}</span>}
        </div>
      )}

      {!hist && !tile.top && <div className="describe-dash__other">No values</div>}
    </div>
  );
}

/** Hands the table popup its Dashboard view; the app calls it at startup. */
export function installDescribeDashboard(): () => void {
  setDashboardView(DescribeDashboard);
  return () => setDashboardView(null);
}

/** The Dashboard view: one tile per column of the frame Describe read; the filter matches column names. */
export function DescribeDashboard({ tiles, query }: { tiles: readonly DescribeTile[]; query: string }) {
  const { ref, width } = useTileWidth();
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? tiles.filter((t) => words.every((w) => t.name.toLowerCase().includes(w))) : tiles;
  return (
    <div className="describe-dash sol-popup__view">
      <div className="describe-dash__scroll sol-popup__scroll">
        <div ref={ref} className="describe-dash__grid">
          {shown.map((t, i) => <Tile key={`${i}:${t.name}`} tile={t} width={width} />)}
          {shown.length === 0 && <div className="describe-dash__other">{tiles.length ? "No column matches" : "No columns"}</div>}
        </div>
      </div>
    </div>
  );
}
