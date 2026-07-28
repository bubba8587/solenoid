import { useId } from "react";
import { COLOR_PALETTE, resolveColor, NEUTRAL_HEX, NEUTRAL_WHITE, NEUTRAL_DARK, isNeutralShade, nextNeutral } from "../palette";
import "./SwatchGrid.css";

/**
 * Reusable color-swatch grid. The Group header color picker and the app-wide accent
 * picker render it interactively; Settings renders it `readOnly` as a legend of the
 * active palette's colors. The host owns the trigger button + open/close state and
 * positions this via `className`. `value`/`onPick` deal in palette SLOT ids (not
 * hexes); each swatch resolves its slot to a hex only to paint the disc. In
 * `readOnly` mode the swatches are plain (non-clickable) spans — no buttons, no
 * selected ring — just a swatch display.
 *
 * The `gray` slot is special: it renders as a tri-diagonal split disc (upper-left
 * white, middle the palette gray, bottom-right a much darker gray) and clicking it
 * CYCLES through those three neutral shades (white → gray → dark) rather than picking
 * a single color. The two extreme neutrals are sentinel slot ids (see palette.ts).
 */
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

/**
 * SVG disc instead of a CSS border-radius button. A CSS circle inscribes its own
 * border box, so its edge sits on the box boundary and gets clipped a side at a
 * time on fractional device pixels (the grid lives inside the zoom-scaled canvas).
 * Drawing it as SVG with overflow:visible and a padded viewBox keeps the disc —
 * and the selected ring, which overflows the 16px button —
 * off every clip boundary, so it stays a clean circle at any zoom.
 */
function Swatch({ color, on }: { color: string; on: boolean }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="-1 -1 18 18"
      style={{ overflow: "visible", display: "block" }}
    >
      {/* Two circles: the colored disc, and (when selected) a ring in the theme
          foreground (white on the dark panel, dark on the light one) hugging the
          disc edge with NO gap — its inner edge overlaps the disc so the panel never
          shows through as a hairline between them. */}
      <circle cx="8" cy="8" r="8" fill={color} />
      {on && <circle cx="8" cy="8" r="8.6" fill="none" stroke="var(--text)" strokeWidth="1.8" />}
    </svg>
  );
}

/**
 * The neutral (gray) swatch: one disc split into three diagonal bands by two lines
 * perpendicular to the upper-left→bottom-right axis — upper-left white, the middle
 * band the palette gray, bottom-right a much darker gray. Clicking it cycles those
 * three (see SwatchGrid). A thin outline keeps the white band visible on a light
 * panel. Same padded viewBox + overflow:visible as `Swatch` so it never clips.
 */
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
        {/* Middle band fills the whole disc; the two extreme regions paint over it.
            Dividing lines x+y = 12.5 and x+y = 19.5 (symmetric about the center 8,8). */}
        <rect x="0" y="0" width="16" height="16" fill={resolveColor("gray")} />
        <polygon points="0,0 12.5,0 0,12.5" fill={NEUTRAL_HEX[NEUTRAL_WHITE]} />
        <polygon points="16,3.5 16,16 3.5,16" fill={NEUTRAL_HEX[NEUTRAL_DARK]} />
      </g>
      {/* Base outline so the white band reads on any background. */}
      <circle cx="8" cy="8" r="8" fill="none" stroke="var(--border)" strokeWidth="1" />
      {on && <circle cx="8" cy="8" r="8.6" fill="none" stroke="var(--text)" strokeWidth="1.8" />}
    </svg>
  );
}
