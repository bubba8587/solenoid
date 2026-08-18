// Structured-payload figures, so they render as plain CSS/SVG rather than going
// through the lazy recharts chunk.
import { useLayoutEffect, useRef, useState } from "react";
import type { KpiPayload, BulletPayload, RecordPayload } from "../chartValue";
import { formatScalar } from "./format";
import { planColumns, packMasonry } from "./masonryLayout";
import "./chartCards.css";

// A semantic state color, deliberately NOT a palette slot: a KPI trend reads
// up=good / down=bad, not "teal".
const POS = "#2fae7a";

// Published as a CSS var the stylesheet's calc() sizes read, so one factor scales
// every label.
function fscaleStyle(fscale: number | undefined): React.CSSProperties | undefined {
  return fscale && fscale !== 1 ? ({ "--chart-fscale": fscale } as React.CSSProperties) : undefined;
}

export function KpiCard({ payload, fscale }: { payload: KpiPayload; fscale?: number }) {
  const { value, prev, unit, goodUp } = payload;
  const has = value !== null && Number.isFinite(value);
  const delta = has && prev !== null && Number.isFinite(prev) ? value! - prev : null;
  const pct = delta !== null && prev !== null && prev !== 0 ? (delta / Math.abs(prev)) * 100 : null;
  const dir = delta === null ? 0 : Math.sign(delta);
  const good = (dir > 0 && goodUp) || (dir < 0 && !goodUp);
  const color = dir === 0 ? "var(--text-dim)" : good ? POS : "var(--sol-error)";
  return (
    <div className="sol-kpi" style={fscaleStyle(fscale)}>
      <div className="sol-kpi__value">
        {has ? formatScalar(value!) : "—"}
        {unit ? <span className="sol-kpi__unit">{unit}</span> : null}
      </div>
      {delta !== null && (
        <div className="sol-kpi__delta" style={{ color }}>
          <span className="sol-kpi__arrow">{dir > 0 ? "▲" : dir < 0 ? "▼" : "▬"}</span>
          {formatScalar(Math.abs(delta))}
          {pct !== null ? ` (${formatScalar(Math.abs(pct))}%)` : ""}
        </div>
      )}
    </div>
  );
}

// One card of labeled boxes on a CSS grid, placements resolved in the node.
function RecordGrid({ fields, cols }: { fields: RecordPayload["cards"][number]; cols: number }) {
  return (
    <div className="sol-record" style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}>
      {fields.map((f, i) => (
        <div
          key={i}
          className="sol-record__box"
          style={{ gridRow: `${f.row} / span ${f.rowSpan}`, gridColumn: `${f.col} / span ${f.colSpan}` }}
        >
          <div className="sol-record__label">{f.label}</div>
          {f.image ? (
            <img className="sol-record__img" src={f.image} alt={f.label} draggable={false} />
          ) : (
            <div className={`sol-record__value${f.value === null ? " sol-record__value--empty" : ""}`}>
              {f.value === null ? "—" : typeof f.value === "number" ? formatScalar(f.value) : f.value}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const GALLERY_GAP = 6;
// Track band: aim at `ideal`, compress to `min` before dropping a column, and
// never stretch past `max` (a lone wide track reads as a stacked list).
const GALLERY_TRACK = { ideal: 170, min: 140, max: 260 };

// Masonry gallery (see masonryLayout.ts): tracks justified to the measured
// container, each card packed into the shortest column. Card heights are
// text-driven, so they are measured from the DOM; the ResizeObserver re-packs
// on container resizes, wrap changes, and fscale changes. Tiles stay hidden
// until the first measurement at the final track width, so the mount never
// paints a mispacked frame.
function RecordGallery({ payload }: { payload: RecordPayload }) {
  const ref = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shownOnce = useRef(false);
  const n = payload.cards.length;
  const [box, setBox] = useState<{ w: number; heights: number[]; settled: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const tiles = tileRefs.current.slice(0, n);
      const heights = tiles.map((t) => (t ? t.offsetHeight : 0));
      const want = Math.round(planColumns(w, GALLERY_GAP, { ...GALLERY_TRACK, items: n }).colWidth);
      const settled = tiles.every((t) => !t || t.offsetWidth === want);
      setBox((prev) =>
        prev && prev.w === w && prev.settled === settled &&
        prev.heights.length === heights.length && prev.heights.every((h, i) => h === heights[i])
          ? prev
          : { w, heights, settled },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const t of tileRefs.current.slice(0, n)) if (t) ro.observe(t);
    return () => ro.disconnect();
  }, [n, payload]);

  const plan = planColumns(box?.w ?? 0, GALLERY_GAP, { ...GALLERY_TRACK, items: n });
  const colWidth = Math.round(plan.colWidth);
  if (box?.settled) shownOnce.current = true;
  const show = box !== null && (box.settled || shownOnce.current);
  const packed = box ? packMasonry(box.heights, plan.count, GALLERY_GAP) : null;
  return (
    <div ref={ref} className="sol-record-gallery" style={show && packed ? { height: packed.height } : undefined}>
      {payload.cards.map((c, i) => (
        <div
          key={i}
          ref={(t) => { tileRefs.current[i] = t; }}
          className="sol-record-tile"
          style={
            show && packed
              ? { width: colWidth, transform: `translate(${packed.slots[i].col * (colWidth + GALLERY_GAP)}px, ${Math.round(packed.slots[i].y)}px)` }
              : { width: colWidth, visibility: "hidden" }
          }
        >
          <RecordGrid fields={c} cols={payload.cols} />
        </div>
      ))}
    </div>
  );
}

// The record figure: the picked card, a gallery of cards, or board lanes.
// Height is content-driven (layouts vary), so the passed figure height is ignored.
export function RecordCardView({ payload, width, fscale }: { payload: RecordPayload; width?: number; fscale?: number }) {
  const outer = { ...(width ? { width } : undefined), ...fscaleStyle(fscale) };
  const moreLine = payload.more ? <div className="sol-record__more">+{payload.more} more</div> : null;
  if (payload.view === "gallery") {
    return (
      <div style={outer}>
        <RecordGallery payload={payload} />
        {moreLine}
      </div>
    );
  }
  if (payload.view === "board") {
    return (
      <div style={outer}>
        <div className="sol-record-board">
          {(payload.lanes ?? []).map((lane) => (
            <div key={lane.label} className="sol-record-lane">
              <div className="sol-record-lane__label">{lane.label}</div>
              {lane.cards.map((ci) => <RecordGrid key={ci} fields={payload.cards[ci] ?? []} cols={payload.cols} />)}
            </div>
          ))}
        </div>
        {moreLine}
      </div>
    );
  }
  return (
    <div style={outer}>
      <RecordGrid fields={payload.cards[0] ?? []} cols={payload.cols} />
    </div>
  );
}

export function BulletBar({ payload, width, fscale }: { payload: BulletPayload; width?: number; fscale?: number }) {
  const { value, target } = payload;
  // A non-finite min/max from dirty upstream data makes every frac() NaN — a
  // "NaN%" bar width and "NaN" labels.
  const min = Number.isFinite(payload.min) ? payload.min : 0;
  const max = Number.isFinite(payload.max) ? payload.max : min + 1;
  const span = max - min || 1;
  const frac = (x: number) => Math.max(0, Math.min(1, (x - min) / span));
  const has = value !== null && Number.isFinite(value);
  const vFrac = has ? frac(value!) : 0;
  const tFrac = target !== null && Number.isFinite(target) ? frac(target) : null;
  const met = has && target !== null && value! >= target;
  return (
    <div className="sol-bullet" style={{ ...(width ? { width } : undefined), ...fscaleStyle(fscale) }}>
      <div className="sol-bullet__row">
        <div className="sol-bullet__track">
          <div
            className="sol-bullet__value"
            style={{ width: `${vFrac * 100}%`, background: met ? POS : "var(--accent)" }}
          />
          {tFrac !== null && <div className="sol-bullet__target" style={{ left: `${tFrac * 100}%` }} />}
        </div>
        <div className="sol-bullet__num">{has ? formatScalar(value!) : "—"}</div>
      </div>
      <div className="sol-bullet__scale">
        <span>{formatScalar(min)}</span>
        {target !== null && Number.isFinite(target) ? <span className="sol-bullet__tgt-label">target {formatScalar(target)}</span> : null}
        <span>{formatScalar(max)}</span>
      </div>
    </div>
  );
}
