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

/** One cumulus at the origin's scale: a flat base, a small left puff, a tall middle one and a right shoulder. */
const CLOUD = "M14.5 36h25a7.5 7.5 0 0 0 1.2-14.9A10.5 10.5 0 0 0 20.6 18.4 8.6 8.6 0 0 0 14.5 36z";

function Sun({ x, y, r, rays = 8, from = 0 }: { x: number; y: number; r: number; rays?: number; from?: number }) {
  const lines = Array.from({ length: rays }, (_, i) => {
    const a = from + (i * Math.PI * 2) / 8;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return <line key={i} className="sol-art__ray" x1={x + c * (r + 2.6)} y1={y + s * (r + 2.6)} x2={x + c * (r + 5.4)} y2={y + s * (r + 5.4)} />;
  });
  return <g>{lines}<circle className="sol-art__halo" cx={x} cy={y} r={r + 1.6} /><circle className="sol-art__sun" cx={x} cy={y} r={r} /></g>;
}

/** The current condition as a small picture; nothing fetched yet draws a faded cloud. */
export function SkyIcon({ condition }: { condition: string | null }) {
  const sky = skyOf(condition ?? "");
  return (
    <svg className={`sol-art sol-art--sky${sky ? "" : " sol-art--unknown"}`} viewBox="0 0 54 46" aria-hidden="true">
      <SkyGlyph sky={sky} />
    </svg>
  );
}

/** A condition's picture in a 54×46 box, for an SVG that places several (the forecast figure). */
export function SkyAt({ condition, x, y, width }: { condition: string; x: number; y: number; width: number }) {
  const sky = skyOf(condition);
  if (!sky) return null;
  return (
    <svg className="sol-art" x={x} y={y} width={width} height={(width * 46) / 54} viewBox="0 0 54 46" aria-hidden="true">
      <SkyGlyph sky={sky} />
    </svg>
  );
}

function SkyGlyph({ sky }: { sky: Sky | null }) {
  // A cloud over weather sits high, leaving the bottom of the box for what falls from it; a partly cloudy one sits
  // low and left, clear of the sun.
  const [dx, dy] = sky === "partly" ? [-3, 3] : sky === "rain" || sky === "snow" || sky === "storm" || sky === "fog" ? [0, -5] : [0, 0];
  const front = <path className="sol-art__cloud" d={CLOUD} transform={`translate(${dx} ${dy})`} />;
  return (
    <>
      {sky === "clear" && <Sun x={27} y={23} r={9} />}
      {sky === "partly" && <Sun x={34} y={15} r={7.5} rays={5} from={-Math.PI * 0.75} />}
      {sky === "cloud" && <path className="sol-art__cloud sol-art__cloud--back" d={CLOUD} transform="translate(13 -7) scale(0.78)" />}
      {sky !== "clear" && front}
      {sky === "fog" && [[13, 36, 34], [19, 41, 30]].map(([x, y, w]) => <line key={y} className="sol-art__fog" x1={x} y1={y} x2={x + w} y2={y} />)}
      {sky === "rain" && [18, 26, 34].map((x, i) => <line key={x} className="sol-art__drop" x1={x + 1.5} y1={35 + (i % 2) * 2} x2={x - 1} y2={41 + (i % 2) * 2} />)}
      {sky === "snow" && [[18, 36.5], [27, 41], [36, 36.5]].map(([x, y]) => <Flake key={x} x={x} y={y} />)}
      {sky === "storm" && <path className="sol-art__bolt" d="M28.5 27l-6 9h4.6l-2.6 8.5 9-11h-4.8l3-6.5z" />}
    </>
  );
}

function Flake({ x, y }: { x: number; y: number }) {
  return (
    <g className="sol-art__flake">
      {[0, 60, 120].map((a) => <line key={a} x1={x - 3.2} y1={y} x2={x + 3.2} y2={y} transform={`rotate(${a} ${x} ${y})`} />)}
    </g>
  );
}
