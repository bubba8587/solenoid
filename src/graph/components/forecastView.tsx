// [[C100]] chartIsAValue
// The Weather card's forecast figure: a column a day, its sky, the high-to-low band and the rain under it.
import { useId, useState, useSyncExternalStore } from "react";
import type { ForecastPayload } from "../chartValue";
import { appThemeStore } from "../appTheme";
import { resolveColor, themeAccent } from "../palette";
import { serialToJsDate } from "../nodes/dateSerial";
import { SkyAt } from "./CardArt";
import "./CardArt.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Column widths (at font scale 1) below which a day drops its weekday name, its own temperatures, its rain amount
 *  and its icon; the hottest high and the coldest low stay labelled. */
const NAME_COL = 19;
const TEMP_COL = 17;
const RAIN_COL = 20;
const ICON_COL = 12;
const TODAY_COL = 34;

function dayName(serial: number, today: number, colW: number): string {
  if (serial === today && colW >= TODAY_COL) return "Today";
  const d = serialToJsDate(serial);
  return colW >= NAME_COL ? WEEKDAYS[d.getUTCDay()] : String(d.getUTCDate());
}

function dayLong(serial: number): string {
  const d = serialToJsDate(serial);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const deg = (v: number) => `${Math.round(v)}°`;
const mm = (v: number) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ""));

/** A smooth path through the points that never overshoots between two of them (a monotone cubic in x). */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dx = (x1 - x0) / 3;
    const slope = (j: number) => {
      const a = pts[j - 1], b = pts[j], c = pts[j + 1];
      if (!a || !c) return 0;
      const s0 = (b[1] - a[1]) / (b[0] - a[0]), s1 = (c[1] - b[1]) / (c[0] - b[0]);
      return s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
    };
    d += ` C${x0 + dx},${y0 + slope(i) * dx} ${x1 - dx},${y1 - slope(i + 1) * dx} ${x1},${y1}`;
  }
  return d;
}

/** Runs of consecutive known values, so a missing day breaks the line rather than bridging it. */
function runs(vals: (number | null)[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  vals.forEach((v, i) => {
    if (v === null) { if (cur.length) out.push(cur); cur = []; } else cur.push(i);
  });
  if (cur.length) out.push(cur);
  return out;
}

export function ForecastView({ payload: p, width: W, height: H, fscale = 1 }: { payload: ForecastPayload; width: number; height: number; fscale?: number }) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const mode = appThemeStore.getMode();
  const grad = useId();
  const [hover, setHover] = useState<number | null>(null);
  const n = p.days.length;
  if (n === 0 || W <= 0 || H <= 0) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;

  const warm = themeAccent(resolveColor("amber"), mode);
  const cool = themeAccent(resolveColor("blue"), mode);
  const pad = 4;
  const colW = (W - pad * 2) / n;
  // A big box (a Dashboard tile, the popup) grows the type and icons with it, so they don't shrink to specks.
  const fs = fscale * Math.max(1, Math.min(1.7, W / 480, H / 240, colW / 30));
  const cx = (i: number) => pad + (i + 0.5) * colW;
  const tick = Math.min(9, Math.max(7.5, colW / 2.6)) * fs;
  const valueFont = Math.min(9.5, Math.max(7.5, colW / 2.3)) * fs;
  const wide = colW >= RAIN_COL * fs;

  // Rows top to bottom: day name, sky, the temperature band with its labels, the rain bars.
  const dayH = tick + 4;
  const iconW = colW >= ICON_COL ? Math.min(colW * 0.95, 30 * fs, H * 0.17) : 0;
  const iconH = iconW > 0 ? (iconW * 46) / 54 + 2 : 0;
  const rainH = Math.max(28 * fs, H * 0.22);
  const rainTop = H - rainH;
  const bandTop = dayH + iconH + valueFont + 4;
  const bandBot = rainTop - valueFont - 6;

  const temps = [...p.high, ...p.low].filter((v): v is number => v !== null);
  const tMin = temps.length ? Math.min(...temps) : 0;
  const tMax = temps.length ? Math.max(...temps) : 1;
  const tSpan = Math.max(tMax - tMin, p.unit === "F" ? 6 : 3);
  const tMid = (tMax + tMin) / 2;
  const ty = (t: number) => bandTop + ((tMid + tSpan / 2 - t) / tSpan) * Math.max(8, bandBot - bandTop);

  const rainMax = Math.max(5, ...p.rainMm.map((v) => v ?? 0));
  const barW = Math.max(2, Math.min(colW * 0.56, 22 * fs));
  const rainLabelH = wide ? valueFont + 2 : 0;
  const ry = (v: number) => (H - 2) - (v / rainMax) * (rainH - rainLabelH - 4);

  const hiPts = p.high.map((v, i) => (v === null ? null : [cx(i), ty(v)] as [number, number]));
  const loPts = p.low.map((v, i) => (v === null ? null : [cx(i), ty(v)] as [number, number]));
  // The band fills only where a day has both ends.
  const both = p.high.map((h, i) => (h !== null && p.low[i] !== null ? 1 : null));
  const bands = runs(both).map((r) => {
    const top = smoothPath(r.map((i) => hiPts[i]!));
    const bottom = smoothPath(r.map((i) => loPts[i]!).reverse()).replace(/^M/, "L");
    return `${top} ${bottom} Z`;
  });
  const lines = (pts: ([number, number] | null)[], vals: (number | null)[]) =>
    runs(vals).map((r) => smoothPath(r.map((i) => pts[i]!)));

  // Narrow columns label only the hottest high and the coldest low.
  const hiMaxI = p.high.reduce<number>((m, v, i) => (v !== null && (m < 0 || v > (p.high[m] as number)) ? i : m), -1);
  const loMinI = p.low.reduce<number>((m, v, i) => (v !== null && (m < 0 || v < (p.low[m] as number)) ? i : m), -1);
  const labelled = (i: number, extreme: number) => colW >= TEMP_COL * fs || i === extreme;

  const todayI = p.days.indexOf(p.today);
  const pastEnd = p.days.findIndex((d) => d >= p.today);
  const pastCount = pastEnd < 0 ? n : pastEnd;

  const h = hover;
  const tip = h === null ? null : [
    dayLong(p.days[h]),
    p.high[h] !== null || p.low[h] !== null ? `${p.high[h] !== null ? deg(p.high[h]!) : "—"} / ${p.low[h] !== null ? deg(p.low[h]!) : "—"}${p.unit}` : null,
    p.rainMm[h] !== null ? `${mm(p.rainMm[h]!)} mm${p.rainPct[h] !== null ? ` · ${Math.round(p.rainPct[h]!)}%` : ""}` : null,
    p.conditions[h] || null,
  ].filter(Boolean).join("  ·  ");

  const pastX = pad + pastCount * colW;
  const r = Math.max(1.6, Math.min(3, colW / 8)) * fs;
  // The wettest day's amount carries the unit, once.
  const wettest = p.rainMm.reduce<number>((m, v, i) => (v !== null && v > 0 && (m < 0 || v > (p.rainMm[m] as number)) ? i : m), -1);
  const ink = (c: string) => ({ fill: `color-mix(in srgb, ${c} 50%, var(--text))` });
  const col = (i: number, fill: string) => (
    <rect x={pad + i * colW + 1} y={0} width={colW - 2} height={H} rx={Math.min(8, colW / 4)} fill={fill} />
  );
  // Top corners rounded, so a short bar reads as a bar, not a pill.
  const bar = (x: number, y: number, w: number, hgt: number) => {
    const rr = Math.min(3 * fs, w / 3, hgt);
    return `M${x},${y + hgt} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + hgt} Z`;
  };
  const curves = (
    <>
      {bands.map((d, k) => <path key={k} d={d} fill={`url(#${grad})`} />)}
      {lines(hiPts, p.high).map((d, k) => <path key={`h${k}`} d={d} fill="none" stroke={warm} strokeWidth={2 * fs} strokeLinecap="round" />)}
      {lines(loPts, p.low).map((d, k) => <path key={`l${k}`} d={d} fill="none" stroke={cool} strokeWidth={2 * fs} strokeLinecap="round" />)}
    </>
  );

  return (
    <div style={{ position: "relative", width: W, height: H }} onPointerLeave={() => setHover(null)}>
      <svg width={W} height={H} style={{ display: "block", overflow: "visible", fontFamily: "inherit" }}>
        <defs>
          <linearGradient id={grad} x1="0" y1={bandTop} x2="0" y2={bandBot} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={warm} stopOpacity={0.42} />
            <stop offset="1" stopColor={cool} stopOpacity={0.3} />
          </linearGradient>
          <clipPath id={`${grad}p`}><rect x={-20} y={-20} width={pastX + 20} height={H + 40} /></clipPath>
          <clipPath id={`${grad}f`}><rect x={pastX} y={-20} width={W + 20} height={H + 40} /></clipPath>
        </defs>
        {todayI >= 0 && col(todayI, "color-mix(in srgb, var(--text) 7%, transparent)")}
        {h !== null && h !== todayI && col(h, "color-mix(in srgb, var(--text) 4%, transparent)")}
        <line x1={pad} x2={W - pad} y1={H - 1} y2={H - 1} stroke="var(--border)" strokeWidth={1} />

        {p.days.map((d, i) => {
          const past = i < pastCount;
          const step = Math.ceil((NAME_COL * 0.8 * fs) / colW);
          const show = step <= 1 || i === todayI || (i % step === 0 && Math.abs(i - todayI) >= step);
          return (
            <g key={d} opacity={past ? 0.4 : 1}>
              {show && (
                <text x={cx(i)} y={tick} textAnchor="middle" fontSize={tick}
                  fontWeight={i === todayI ? 700 : 500} fill={i === todayI ? "var(--text)" : "var(--text-dim)"}>
                  {dayName(d, p.today, colW / fs)}
                </text>
              )}
              {iconW > 0 && p.conditions[i] && <SkyAt condition={p.conditions[i]} x={cx(i) - iconW / 2} y={dayH} width={iconW} />}
            </g>
          );
        })}

        {pastCount > 0 && <g clipPath={`url(#${grad}p)`} opacity={0.35}>{curves}</g>}
        <g clipPath={`url(#${grad}f)`}>{curves}</g>
        {p.days.map((d, i) => {
          const hi = p.high[i], lo = p.low[i];
          return (
            <g key={d} opacity={i < pastCount ? 0.4 : 1}>
              {hi !== null && <circle cx={cx(i)} cy={ty(hi)} r={r} fill={warm} stroke="var(--surface)" strokeWidth={1} />}
              {lo !== null && <circle cx={cx(i)} cy={ty(lo)} r={r} fill={cool} stroke="var(--surface)" strokeWidth={1} />}
              {hi !== null && labelled(i, hiMaxI) && (
                <text x={cx(i)} y={ty(hi) - r - 3} textAnchor="middle" fontSize={valueFont} fontWeight={650} style={ink(warm)}>{deg(hi)}</text>
              )}
              {lo !== null && labelled(i, loMinI) && (
                <text x={cx(i)} y={ty(lo) + r + 2 + valueFont * 0.8} textAnchor="middle" fontSize={valueFont} fontWeight={550} style={ink(cool)}>{deg(lo)}</text>
              )}
            </g>
          );
        })}

        {p.days.map((d, i) => {
          const v = p.rainMm[i];
          if (v === null || v <= 0) return null;
          const y = ry(v);
          return (
            <g key={d} opacity={i < pastCount ? 0.4 : 1}>
              <path d={bar(cx(i) - barW / 2, y, barW, Math.max(1.5, H - 1.5 - y))} fill="var(--art-rain, #56b4e9)" fillOpacity={0.85} />
              {wide && v >= 0.1 && (
                <text x={cx(i)} y={y - 3} textAnchor="middle" fontSize={valueFont * 0.9} fontWeight={550} style={ink("var(--art-rain, #56b4e9)")}>{i === wettest ? `${mm(v)} mm` : mm(v)}</text>
              )}
            </g>
          );
        })}

        {p.days.map((d, i) => (
          <rect key={d} x={pad + i * colW} y={0} width={colW} height={H} fill="transparent" onPointerEnter={() => setHover(i)} />
        ))}
      </svg>
      {tip && (
        <div style={{
          position: "absolute", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 1, top: dayH + iconH,
          ...(h! >= n / 2 ? { right: W - (pad + h! * colW) + 4 } : { left: pad + (h! + 1) * colW + 4 }),
          fontSize: 11, padding: "2px 6px", background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)",
        }}>{tip}</div>
      )}
    </div>
  );
}

/** At most `count` days from today on (the last `count` when today is past the end), for a small preview. */
export function forecastWindow(p: ForecastPayload, count: number): ForecastPayload {
  if (p.days.length <= count) return p;
  const at = p.days.findIndex((d) => d >= p.today);
  const from = at < 0 ? p.days.length - count : Math.min(at, p.days.length - count);
  const cut = <T,>(xs: T[]) => xs.slice(from, from + count);
  return { ...p, days: cut(p.days), high: cut(p.high), low: cut(p.low), rainMm: cut(p.rainMm), rainPct: cut(p.rainPct), conditions: cut(p.conditions) };
}
