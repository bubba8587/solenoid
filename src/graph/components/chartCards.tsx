// Structured-payload figures, so they render as plain CSS/SVG rather than going
// through the lazy recharts chunk.
import type { KpiPayload, BulletPayload, RecordPayload } from "../chartValue";
import { formatScalar } from "./format";
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

// The record card: labeled boxes on a CSS grid, placements resolved in the node.
// Height is content-driven (layouts vary), so the passed figure height is ignored.
export function RecordCardView({ payload, width, fscale }: { payload: RecordPayload; width?: number; fscale?: number }) {
  return (
    <div
      className="sol-record"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, payload.cols)}, minmax(0, 1fr))`,
        ...(width ? { width } : undefined),
        ...fscaleStyle(fscale),
      }}
    >
      {payload.fields.map((f, i) => (
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
