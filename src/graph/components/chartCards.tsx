// [[B11]] maximalMerge, [[C100]] chartIsAValue, [[C114]] cardsView
import { CellImage } from "./cubeCell";
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor } from "../palette";
import { boxTintVars, namedColor } from "./boxTint";
import type { KpiPayload, ScalePayload, RecordPayload, RecordSize } from "../chartValue";
import { recordFieldText, recordLaneText, recordNumberText, titleIndexFor } from "../chartValue";
import { formatScalar } from "./format";
import { formatNumberWithAnnotation, type FormatAnnotation } from "../formatAnnotationStore";
import { planColumns, packMasonry } from "./masonryLayout";
import { stopDragStart } from "../coarse";
import { AutoCard, cardChipColors } from "./AutoCard";
import "./chartCards.css";

function fscaleStyle(fscale: number | undefined): React.CSSProperties | undefined {
  return fscale && fscale !== 1 ? ({ "--chart-fscale": fscale } as React.CSSProperties) : undefined;
}

/** `format` is the format on the KPI's Value input (a Format Controller there or upstream): the value and its change wear it. */
export function KpiCard({ payload, fscale, format }: { payload: KpiPayload; fscale?: number; format?: FormatAnnotation }) {
  const num = (n: number) => (format ? formatNumberWithAnnotation(n, format) : formatScalar(n));
  const { value, prev, unit, goodUp } = payload;
  const has = value !== null && Number.isFinite(value);
  const delta = has && prev !== null && Number.isFinite(prev) ? value! - prev : null;
  const pct = delta !== null && prev !== null && prev !== 0 ? (delta / Math.abs(prev)) * 100 : null;
  const dir = delta === null ? 0 : Math.sign(delta);
  const good = (dir > 0 && goodUp) || (dir < 0 && !goodUp);
  const color = dir === 0 ? "var(--text-dim)" : `color-mix(in srgb, ${good ? "var(--sol-ok)" : "var(--sol-error)"} 70%, var(--text))`;
  return (
    <div className="sol-kpi" style={fscaleStyle(fscale)}>
      <div className="sol-kpi__value" style={{ "--chars": (has ? num(value!) : "—").length + (unit?.length ?? 0) } as React.CSSProperties}>
        {has ? num(value!) : "—"}
        {unit ? <span className="sol-kpi__unit">{unit}</span> : null}
      </div>
      {delta !== null && (
        <div className="sol-kpi__delta" style={{ color }}>
          <span className="sol-kpi__arrow">{dir > 0 ? "▲" : dir < 0 ? "▼" : "▬"}</span>
          {num(Math.abs(delta))}
          {pct !== null ? ` (${formatScalar(Math.round(Math.abs(pct) * 10) / 10)}%)` : ""}
        </div>
      )}
    </div>
  );
}

/** `flow` (no layout written) lets the stacked boxes wrap into as many columns as the figure's width fits. */
function RecordGrid({ fields, cols, flow }: { fields: RecordPayload["cards"][number]; cols: number; flow?: boolean }) {
  return (
    <div
      className={`sol-record${flow ? " sol-record--flow" : ""}`}
      style={flow ? undefined : { gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}
    >
      {fields.map((f, i) => (
        <div
          key={i}
          className={`sol-record__box${f.isTitle ? " sol-record__box--title" : ""}`}
          style={flow ? undefined : { gridRow: `${f.row} / span ${f.rowSpan}`, gridColumn: `${f.col} / span ${f.colSpan}` }}
        >
          {f.isTitle ? null : <div className="sol-record__label">{f.label}</div>}
          {f.image ? (
            <CellImage className="sol-record__img" src={f.image} alt={f.label} />
          ) : (
            <div className={`sol-record__value${f.value === null ? (f.hint ? " sol-record__value--hint" : " sol-record__value--empty") : ""}`}>
              {recordFieldText(f)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const GALLERY_GAP = 6;
const GALLERY_TRACK_BY_SIZE: Record<RecordSize, { ideal: number; min: number; max: number }> = {
  s: { ideal: 120, min: 100, max: 150 },
  m: { ideal: 170, min: 145, max: 210 },
  l: { ideal: 250, min: 215, max: 310 },
};

type Track = { ideal: number; min: number; max: number };

/** The masonry both galleries pack into; `layoutKey` changes when the tiles do, so they are re-measured. */
function MasonryGallery({ count, track, className, layoutKey, tile }: {
  count: number;
  track: Track;
  className: string;
  layoutKey: unknown;
  tile: (i: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const shownOnce = useRef(false);
  const n = count;
  const [box, setBox] = useState<{ w: number; heights: number[]; settled: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const tiles = tileRefs.current.slice(0, n);
      const heights = tiles.map((t) => (t ? t.offsetHeight : 0));
      const want = Math.round(planColumns(w, GALLERY_GAP, { ...track, items: n }).colWidth);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, layoutKey]);

  const plan = planColumns(box?.w ?? 0, GALLERY_GAP, { ...track, items: n });
  const colWidth = Math.round(plan.colWidth);
  if (box?.settled) shownOnce.current = true;
  const show = box !== null && (box.settled || shownOnce.current);
  const packed = box ? packMasonry(box.heights, plan.count, GALLERY_GAP) : null;
  return (
    <div ref={ref} className={className} style={show && packed ? { height: packed.height } : undefined}>
      {Array.from({ length: n }, (_, i) => (
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
          {tile(i)}
        </div>
      ))}
    </div>
  );
}

function RecordGallery({ payload }: { payload: RecordPayload }) {
  return (
    <MasonryGallery
      count={payload.cards.length}
      track={GALLERY_TRACK_BY_SIZE[payload.size ?? "m"]}
      className="sol-record-gallery"
      layoutKey={payload}
      tile={(i) => <RecordGrid fields={payload.cards[i]} cols={payload.cols} flow={payload.flow} />}
    />
  );
}

// Wider than Gallery's tracks: a card carries a header row and a grid of field tiles.
const CARDS_TRACK_BY_SIZE: Record<RecordSize, Track> = {
  s: { ideal: 230, min: 200, max: 270 },
  m: { ideal: 300, min: 260, max: 350 },
  l: { ideal: 390, min: 340, max: 450 },
};
const NO_COMPUTED: ReadonlySet<number> = new Set();

function RecordCards({ payload, colorBy }: { payload: RecordPayload; colorBy?: string }) {
  const deck = payload.deck;
  const mode = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.getMode);
  const tints = useMemo(() => cardTints(deck, colorBy, mode), [deck, colorBy, mode]);
  const tintColumn = deck && colorBy ? deck.names.findIndex((n) => n.trim().toLowerCase() === colorBy.trim().toLowerCase()) : -1;
  const texts = useMemo(() => (deck?.rows ?? []).map((row) => row.map((v, c) => {
    if (v === null) return "";
    return typeof v === "number" ? recordNumberText(v, deck!.formats[c]) : v;
  })), [deck]);
  const chipColors = useMemo(() => (deck
    ? cardChipColors(deck.plan, new Set(deck.chipCols), deck.rows.length, (r, c) => String(deck.rows[r]?.[c] ?? ""))
    : new Map<number, Map<string, number>>()), [deck]);
  if (!deck) return null;
  return (
    <MasonryGallery
      count={deck.rows.length}
      track={CARDS_TRACK_BY_SIZE[payload.size ?? "m"]}
      className="sol-record-gallery"
      layoutKey={`${deck.rows.length}|${payload.clamp ? 1 : 0}`}
      tile={(r) => (
        <AutoCard
          plan={deck.plan}
          layout={deck.layout}
          tint={tints?.[r]}
          tintColumn={tintColumn}
          names={deck.names}
          types={deck.types}
          computed={NO_COMPUTED}
          chipColors={chipColors}
          texts={texts[r]}
          raw={(c) => String(deck.rows[r]?.[c] ?? "")}
          rowNumber={deck.rowNumbers[r] ?? r + 1}
        />
      )}
    />
  );
}

/**
 * Each card's colors from the `colorBy` column's cell: a hex color or a palette slot's name as itself, anything else
 * (another word, a blank) the gray slot. No such column leaves every card plain.
 */
function cardTints(deck: RecordPayload["deck"], colorBy: string | undefined, mode: "dark" | "light"): CSSProperties[] | null {
  const key = colorBy?.trim().toLowerCase();
  if (!deck || !key) return null;
  const c = deck.names.findIndex((n) => n.trim().toLowerCase() === key);
  if (c < 0) return null;
  const gray = resolveColor("gray");
  return deck.rows.map((row) => boxTintVars(namedColor(row[c] === null || row[c] === undefined ? "" : String(row[c])) ?? gray, mode));
}

function NavChevron({ back }: { back?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d={back ? "M6.5 1l-4 4 4 4" : "M3.5 1l4 4-4 4"}
        fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function RecordList({ payload }: { payload: RecordPayload }) {
  return (
    <div className="sol-record-list">
      {payload.cards.map((fields, i) => {
        const ti = titleIndexFor(fields);
        return (
          <div key={i} className="sol-record-list__item">
            <div className="sol-record-list__title">{ti >= 0 ? recordFieldText(fields[ti]) : "—"}</div>
            {fields.map((f, j) => j === ti ? null : (
              <div key={j} className="sol-record-list__field">
                <span className="sol-record-list__flabel">{f.label}</span>
                <span className="sol-record-list__fvalue">{recordFieldText(f)}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const RECORD_TILE_MIN: Record<RecordSize, number> = { s: 110, m: 150, l: 200 };
const RECORD_LANE_MIN: Record<RecordSize, number> = { s: 140, m: 180, l: 240 };
const RECORD_LIST_MIN: Record<RecordSize, number> = { s: 160, m: 220, l: 300 };

export function RecordCardView({ payload, width, fscale, title, onStep, colorBy }: {
  payload: RecordPayload; width?: number; fscale?: number; title?: string; onStep?: (delta: number) => void;
  /** Cards only: the column whose cell colors each card (the options' `c`). */
  colorBy?: string;
}) {
  // Tile size and clamp reach every view: the size sets the no-layout columns' and Board lanes' minimum width.
  const size = payload.size ?? "m";
  const outer = {
    ...(width ? { width } : undefined),
    ...fscaleStyle(fscale),
    "--record-tile": `${RECORD_TILE_MIN[size]}px`,
    "--record-lane": `${RECORD_LANE_MIN[size]}px`,
    "--record-list": `${RECORD_LIST_MIN[size]}px`,
  } as React.CSSProperties;
  const figClass = payload.clamp ? "sol-record-fig sol-record-fig--clamp" : "sol-record-fig";
  const titleLine = title ? <div className="sol-record-figtitle">{title}</div> : null;
  const moreLine = payload.more ? <div className="sol-record__more">+{payload.more} more</div> : null;
  if (payload.view === "cards") {
    return (
      <div className={figClass} style={outer}>
        {titleLine}
        <RecordCards payload={payload} colorBy={colorBy} />
        {moreLine}
      </div>
    );
  }
  if (payload.view === "gallery") {
    return (
      <div className={figClass} style={outer}>
        {titleLine}
        <RecordGallery payload={payload} />
        {moreLine}
      </div>
    );
  }
  if (payload.view === "list") {
    return (
      <div className={figClass} style={outer}>
        {titleLine}
        <RecordList payload={payload} />
        {moreLine}
      </div>
    );
  }
  if (payload.view === "board") {
    return (
      <div className={figClass} style={outer}>
        {titleLine}
        <div className="sol-record-board">
          {(payload.lanes ?? []).map((lane, li) => (
            <div key={li} className="sol-record-lane">
              <div className="sol-record-lane__label">{recordLaneText(lane)}</div>
              {lane.cards.map((ci) => <RecordGrid key={ci} fields={payload.cards[ci] ?? []} cols={payload.cols} flow={payload.flow} />)}
            </div>
          ))}
        </div>
        {moreLine}
      </div>
    );
  }
  // The column fills a definite height and only the grid gives, so a short host never clips the pager away.
  return (
    <div className={`sol-record-card ${figClass}`} style={outer}>
      {titleLine}
      <div className="sol-record-card__grid">
        <RecordGrid fields={payload.cards[0] ?? []} cols={payload.cols} flow={payload.flow} />
      </div>
      {onStep && payload.total > 1 && (
        <div className="sol-record-nav">
          <button
            type="button" className="sol-record-nav__btn" title="Previous record"
            disabled={payload.index <= 1}
            onClick={(e) => { e.stopPropagation(); onStep(-1); }}
            onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
          >
            <NavChevron back />
          </button>
          <span className="sol-record-nav__count">{payload.index > 0 ? payload.index : "–"} / {payload.total}</span>
          <button
            type="button" className="sol-record-nav__btn" title="Next record"
            disabled={payload.index >= payload.total}
            onClick={(e) => { e.stopPropagation(); onStep(1); }}
            onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}
          >
            <NavChevron />
          </button>
        </div>
      )}
    </div>
  );
}

export function BulletBar({ payload, width, fscale }: { payload: ScalePayload; width?: number; fscale?: number }) {
  const { value, target } = payload;
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
            style={{ width: `${vFrac * 100}%`, background: met ? "var(--sol-ok)" : "var(--accent)" }}
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
