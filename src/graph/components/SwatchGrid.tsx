import { useId } from "react";
import { COLOR_PALETTE, resolveColor, NEUTRAL_HEX, NEUTRAL_WHITE, NEUTRAL_DARK, isNeutralShade, nextNeutral } from "../palette";
import "./SwatchGrid.css";

/** `value`/`onPick` deal in palette SLOT ids, not hexes. The `gray` slot is special:
 *  clicking it CYCLES white → gray → dark (the extremes are sentinel slot ids). */
export function SwatchGrid({
  value,
  onPick,
  colors = COLOR_PALETTE,
  className = "",
  readOnly = false,
}: {
  value?: string;
  onPick?: (slot: string) => void;
  colors?: readonly string[];
  className?: string;
  readOnly?: boolean;
}) {
  const neutralSelected = value === "gray" || isNeutralShade(value ?? "");
  return (
    <div className={`solenoid-swatchgrid${readOnly ? " solenoid-swatchgrid--readonly" : ""}${className ? ` ${className}` : ""}`}>
      {colors.map((slot) => {
        const isGray = slot === "gray";
        const disc = isGray
          ? <NeutralSwatch on={!readOnly && neutralSelected} />
          : <Swatch color={resolveColor(slot)} on={slot === value} />;
        const title = isGray ? "Neutral: cycles white / gray / dark." : slot;
        return readOnly ? (
          <span key={slot} className="solenoid-swatchgrid__opt" title={title}>
            {disc}
          </span>
        ) : (
          <button
            key={slot}
            type="button"
            className="solenoid-swatchgrid__opt"
            title={title}
            onClick={() => onPick?.(isGray ? nextNeutral(value) : slot)}
          >
            {disc}
          </button>
        );
      })}
    </div>
  );
}

/** An SVG disc, never a CSS border-radius button: a CSS circle inscribes its border
 *  box and clips a side at a time on fractional device pixels under canvas zoom. */
function Swatch({ color, on }: { color: string; on: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="-1 -1 18 18"
      style={{ overflow: "visible", display: "block" }}
    >
      {/* The ring's inner edge OVERLAPS the disc, so the panel never shows through
          as a hairline between them. */}
      <circle cx="8" cy="8" r="8" fill={color} />
      {on && <circle cx="8" cy="8" r="8.6" fill="none" stroke="var(--text)" strokeWidth="1.8" />}
    </svg>
  );
}

/** One disc split into three diagonal bands (white, palette gray, dark), with the
 *  same padded viewBox as `Swatch` so it never clips. */
function NeutralSwatch({ on }: { on: boolean }) {
  const clipId = useId();
  return (
    <svg
      width={16}
      height={16}
      viewBox="-1 -1 18 18"
      style={{ overflow: "visible", display: "block" }}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="8" cy="8" r="8" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {/* Middle band fills the disc; the extremes paint over it, divided along
            x+y = 12.5 and x+y = 19.5 (symmetric about the centre). */}
        <rect x="0" y="0" width="16" height="16" fill={resolveColor("gray")} />
        <polygon points="0,0 12.5,0 0,12.5" fill={NEUTRAL_HEX[NEUTRAL_WHITE]} />
        <polygon points="16,3.5 16,16 3.5,16" fill={NEUTRAL_HEX[NEUTRAL_DARK]} />
      </g>
      <circle cx="8" cy="8" r="8" fill="none" stroke="var(--border)" strokeWidth="1" />
      {on && <circle cx="8" cy="8" r="8.6" fill="none" stroke="var(--text)" strokeWidth="1.8" />}
    </svg>
  );
}
