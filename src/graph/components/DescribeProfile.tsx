// [[table-popup#The Profile view]], [[engineering#Performance]]
import { useEffect, useMemo, useRef, useState } from "react";
import { MasonryGallery } from "./MasonryGallery";
import type { DescribeTile } from "../describeProfile";
import { defaultCellText } from "../cellText";
import { APP_LOCALE } from "../locale";
import { ChartView, useChartColors } from "./chartView";
import { ChartExpandButton } from "./ChartExpandButton";
import { TypeIcon } from "./TypeIcon";
import { setProfileView } from "../tablePopupStore";
import "./DescribeProfile.css";

/** A tile's track: the masonry fits as many as it can between these widths ([[chart-figures#The Record figure]]). */
const TILE_TRACK = { ideal: 250, min: 200, max: 340 };
const GAP = 10;
/** A tile's padding and border, which its charts sit inside. */
const TILE_INSET = 2 * 10 + 2;
const HIST_H = 64;
const TREND_H = 28;

const count = (n: number) => n.toLocaleString(APP_LOCALE);
const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "");
/** A computed figure (a mean) to four significant figures where its column sets no format: 176.5625 reads 176.6. */
const roundStat = (v: number): number => {
  if (!Number.isFinite(v) || v === 0) return v;
  const places = Math.max(0, 3 - Math.floor(Math.log10(Math.abs(v))));
  return Number(v.toFixed(Math.min(places, 10)));
};

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
  // A number or date column's few values read in their own order, as a distribution does; text, most first.
  const numeric = tile.type === "number" || tile.type === "date";
  const topValues = tile.top
    ? numeric ? [...tile.top.values].sort((a, b) => Number(a.text) - Number(b.text)) : tile.top.values
    : [];
  const topMax = topValues.reduce((m, t) => Math.max(m, t.count), 0);
  // `marked`: the stat the histogram's dashed line stands at, whose label wears the same dash.
  const allBlank = rows > 0 && tile.count === 0;
  const unique = tile.count > 1 && tile.distinct === tile.count;
  // A text or logical key: its values listed as samples, not counted.
  const listsSamples = unique && !hist && !numeric;
  const otherValues = Math.max(1, tile.distinct - (tile.top?.values.length ?? 0));
  const label = (t: string) => (t === "" ? "(empty)" : numeric && !t.startsWith("#") ? text(Number(t)) : t);
  // A number's least and greatest read to four figures where its column sets no format, as its mean does.
  const bound = (v: number) => (tile.type === "number" && !tile.format ? roundStat(v) : v);
  const stat = (label: string, value: string, marked = false) => (
    <span className="describe-profile__stat">
      <span className={`describe-profile__statname${marked && medianAt != null ? " describe-profile__statname--marked" : ""}`}>{label}</span>
      <span className="describe-profile__statvalue">{value}</span>
    </span>
  );
  // The median's place on the histogram: its bins run evenly from min to max across the plot, inset 2 pixels a side.
  const medianAt = hist && tile.median != null && hist.max > hist.min
    ? 2 + ((tile.median - hist.min) / (hist.max - hist.min)) * (plotW - 4)
    : null;
  return (
    <div ref={ref} className="describe-profile__tile" style={{ width }}>
      <div className="describe-profile__head">
        <span className="describe-profile__icon"><TypeIcon type={tile.type} size={11} /></span>
        <span className="describe-profile__name">{tile.name}</span>
        {/* A column whose every row differs is a key; one whose rows all match carries a single value. */}
        <span className="describe-profile__distinct">
          {allBlank ? "all blank" : unique ? "all unique" : tile.count > 0 && tile.distinct === 1 ? "one value" : `${count(tile.distinct)} distinct`}
        </span>
      </div>
      {allBlank ? (
        <div className="describe-profile__fill describe-profile__fill--full">{count(rows)} rows, all blank</div>
      ) : tile.blank > 0 ? (
        // Only a column with blanks draws the bar: the filled share on the empty track.
        <div className="describe-profile__fill">
          <span className="describe-profile__fillbar"><span style={{ width: `${filled * 100}%` }} /></span>
          <span className="describe-profile__filltext">{count(tile.count)} filled · {count(tile.blank)} blank</span>
        </div>
      ) : (
        <div className="describe-profile__fill describe-profile__fill--full">{count(rows)} rows, none blank</div>
      )}

      {hist && (
        <div className="describe-profile__chart" style={{ height: HIST_H }}>
          {seen && <ChartView op="column" series={histSeries} width={plotW} height={HIST_H} axes={false} labels={binLabels} />}
          {medianAt != null && <span className="describe-profile__median" style={{ left: medianAt }} />}
          <ChartExpandButton title={`${tile.name}: distribution`} op="column" axes series={histSeries} labels={binLabels} />
        </div>
      )}
      {hist && (
        <div className="describe-profile__stats">
          {stat(tile.type === "date" ? "Earliest" : "Min", text(bound(hist.min)))}
          {tile.median != null && stat("Median", text(roundStat(tile.median)), true)}
          {tile.mean != null && stat("Mean", text(tile.format ? tile.mean : roundStat(tile.mean)))}
          {stat(tile.type === "date" ? "Latest" : "Max", text(bound(hist.max)))}
        </div>
      )}
      {hist && tile.type === "date" && hist.max > hist.min && (
        <div className="describe-profile__caption">Spans {count(Math.round(hist.max - hist.min))} days</div>
      )}
      {tile.trend && (
        <>
          <div className="describe-profile__caption">In row order</div>
          <div className="describe-profile__chart describe-profile__trend" style={{ height: TREND_H }}>
            {seen && <ChartView op="line" series={trendSeries} width={plotW} height={TREND_H} axes={false} />}
            <ChartExpandButton title={tile.name} op="line" axes series={trendSeries} />
          </div>
        </>
      )}
      {tile.top && listsSamples && (
        // A key's values each appear once, so counts and bars would say nothing: a few of them show what it holds.
        <div className="describe-profile__samples">
          {tile.top.values.map((t) => <span key={t.text} className="describe-profile__sample">{label(t.text)}</span>)}
          {tile.distinct > tile.top.values.length && <span className="describe-profile__other">and {count(tile.distinct - tile.top.values.length)} more</span>}
        </div>
      )}
      {tile.top && !listsSamples && !allBlank && (
        <div className="describe-profile__top">
          {topValues.map((t) => (
            <div key={t.text} className="describe-profile__toprow">
              <span className="describe-profile__toplabel">{label(t.text)}</span>
              <span className="describe-profile__topbar"><span style={{ width: `${topMax ? (t.count / topMax) * 100 : 0}%`, background: viz }} /></span>
              <span className="describe-profile__topcount">{count(t.count)}</span>
              <span className="describe-profile__topshare">{share(t.count, tile.count)}</span>
            </div>
          ))}
          {tile.top.other > 0 && (
            <div className="describe-profile__other">
              {count(tile.top.other)} {tile.top.other === 1 ? "row" : "rows"} in {otherValues === 1 ? "1 other value" : `${count(otherValues)} other values`}
            </div>
          )}
          {tile.top.values.length === 0 && <div className="describe-profile__other">No values</div>}
        </div>
      )}
      {!hist && tile.top && (tile.mean != null || tile.median != null) && (
        <div className="describe-profile__stats">
          {tile.median != null && stat("Median", text(roundStat(tile.median)))}
          {tile.mean != null && stat("Mean", text(tile.format ? tile.mean : roundStat(tile.mean)))}
        </div>
      )}

      {!hist && !tile.top && !allBlank && <div className="describe-profile__other">No values</div>}
    </div>
  );
}

/** Hands the table popup its Profile view; the app calls it at startup. */
export function installDescribeProfile(): () => void {
  setProfileView(DescribeProfile);
  return () => setProfileView(null);
}

/** The Profile view: one tile per column of the frame Describe read; the filter matches column names. */
export function DescribeProfile({ tiles, query }: { tiles: readonly DescribeTile[]; query: string }) {
  // One array while the filter holds, so the masonry measures again only when the tiles change.
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? tiles.filter((t) => words.every((w) => t.name.toLowerCase().includes(w))) : tiles;
  }, [tiles, query]);
  return (
    <div className="describe-profile sol-popup__view">
      <div className="describe-profile__scroll sol-popup__scroll">
        {/* A masonry, as a Record figure's Gallery packs, so a short tile leaves no hole under it. */}
        <MasonryGallery count={shown.length} track={TILE_TRACK} gap={GAP} className="describe-profile__grid" layoutKey={shown}
          tile={(i, width) => <Tile key={`${i}:${shown[i].name}`} tile={shown[i]} width={width} />} />
        {shown.length === 0 && <div className="describe-profile__other">{tiles.length ? "No column matches" : "No columns"}</div>}
      </div>
    </div>
  );
}
