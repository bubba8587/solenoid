// Non-recharts figures — a KPI stat card and a bullet graph. They carry structured
// data (value + prior, value vs target) rather than a numeric series, so they render
// as plain CSS/SVG here instead of going through the lazy recharts chunk (nothing to
// defer — a big number and two bars need no charting lib). Shared by the KPI / Bullet
// node cards AND a wired KPI/Bullet figure inline in a Report (inlineRefDisplay).
import type { KpiPayload, BulletPayload } from "../chartValue";
import { formatScalar } from "./format";
import "./chartCards.css";

// Positive-delta green — a semantic state color (like --sol-error for negatives),
// deliberately NOT a palette slot: a KPI trend reads up=good / down=bad, not "teal".
// Matches the connection "ok" dot so green means the same thing across the app.
const POS = "#2fae7a";

// Text-scale multiplier (FC chartFontScale × options fontsize) — published as a
// CSS var the stylesheet's calc() sizes read, so one factor scales every label.
function fscaleStyle(fscale: number | undefined): React.CSSProperties | undefined {
  return fscale && fscale !== 1 ? ({ "--chart-fscale": fscale } as React.CSSProperties) : undefined;
}

/** A big-number stat card with an optional ↑/↓ delta vs a prior value. */
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

/** A bullet graph — a value bar on a min..max track with a target tick. */
export function BulletBar({ payload, width, fscale }: { payload: BulletPayload; width?: number; fscale?: number }) {
  const { value, target } = payload;
  // Guard the scale bounds: a non-finite min/max (dirty upstream data — a NaN or a
  // #DIV/0! cell) would make every frac() NaN → a "NaN%" bar width + "NaN" labels.
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
