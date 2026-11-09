import { useId } from "react";
import "./CardArt.css";

/** The sun's arc over a horizon, as wide as the day is long; no day length draws it faded at half. */
export function DayArc({ hours }: { hours: number | null }) {
  const known = hours !== null && Number.isFinite(hours);
  const frac = known ? Math.min(1, Math.max(0, hours / 24)) : 0.5;
  const W = 160, cx = W / 2, horizon = 48;
  const half = 8 + frac * (cx - 14);
  const rise = 8 + frac * 32;
  const sunY = frac > 0 ? horizon - rise : horizon + 2;
  const clip = useId();
  return (
    <svg className={`sol-art sol-art--day${known ? "" : " sol-art--unknown"}`} viewBox={`0 0 ${W} 56`} aria-hidden="true">
      <defs>
        <clipPath id={clip}><rect x="0" y="0" width={W} height={horizon} /></clipPath>
      </defs>
      {frac > 0 && (
        <path className="sol-art__path" d={`M${cx - half} ${horizon} Q${cx} ${horizon - rise * 2} ${cx + half} ${horizon}`} />
      )}
      <g clipPath={`url(#${CSS.escape(clip)})`}>
        <circle className="sol-art__halo" cx={cx} cy={sunY} r="9" />
        <circle className="sol-art__sun" cx={cx} cy={sunY} r="5" />
      </g>
      <line className="sol-art__horizon" x1="10" y1={horizon} x2={W - 10} y2={horizon} />
      {frac > 0 && frac < 1 && (
        <>
          <circle className="sol-art__tick" cx={cx - half} cy={horizon} r="1.6" />
          <circle className="sol-art__tick" cx={cx + half} cy={horizon} r="1.6" />
        </>
      )}
    </svg>
  );
}

type Sky = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

/** Reads the card's condition text (Open-Meteo's WMO words, `providers.rs`). */
function skyOf(condition: string): Sky | null {
  const c = condition.toLowerCase();
  if (!c) return null;
  if (c.includes("thunder")) return "storm";
  if (c.includes("snow")) return "snow";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "rain";
  if (c.includes("fog")) return "fog";
  if (c.includes("partly")) return "partly";
  if (c.includes("overcast")) return "cloud";
  if (c.includes("clear")) return "clear";
  return "cloud";
}

const CLOUD = "M17 34h20a7 7 0 0 0 .6-14 10 10 0 0 0-19.2-2.6A8.3 8.3 0 0 0 17 34z";

function Sun({ x, y, r }: { x: number; y: number; r: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return <line key={i} className="sol-art__ray" x1={x + c * (r + 3)} y1={y + s * (r + 3)} x2={x + c * (r + 6)} y2={y + s * (r + 6)} />;
  });
  return <g>{rays}<circle className="sol-art__sun" cx={x} cy={y} r={r} /></g>;
}

/** The current condition as a small picture; nothing fetched yet draws a faded cloud. */
export function SkyIcon({ condition }: { condition: string | null }) {
  const sky = skyOf(condition ?? "");
  return (
    <svg className={`sol-art sol-art--sky${sky ? "" : " sol-art--unknown"}`} viewBox="0 0 54 46" aria-hidden="true">
      {sky === "clear" && <Sun x={27} y={23} r={8} />}
      {sky === "partly" && <Sun x={20} y={17} r={6} />}
      {sky === "cloud" && <path className="sol-art__cloud sol-art__cloud--back" d={CLOUD} transform="translate(8 -7) scale(0.8)" />}
      {sky !== "clear" && <path className="sol-art__cloud" d={CLOUD} />}
      {sky === "fog" && [38, 42].map((y, i) => <line key={y} className="sol-art__fog" x1={14 + i * 4} y1={y} x2={40 + i * 2} y2={y} />)}
      {sky === "rain" && [20, 27, 34].map((x) => <line key={x} className="sol-art__drop" x1={x} y1="38" x2={x - 2} y2="43" />)}
      {sky === "snow" && [20, 27, 34].map((x, i) => <circle key={x} className="sol-art__flake" cx={x} cy={i % 2 ? 42 : 39} r="1.5" />)}
      {sky === "storm" && <path className="sol-art__bolt" d="M29 33l-5 7h4l-2 6 7-8h-4l2-5z" />}
    </svg>
  );
}
