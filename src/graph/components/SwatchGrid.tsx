import { COLOR_PALETTE, resolveColor } from "../palette";
import "./SwatchGrid.css";

/**
 * Reusable color-swatch grid. The Group header color picker and the app-wide accent
 * picker render it interactively; Settings renders it `readOnly` as a legend of the
 * active palette's colors. The host owns the trigger button + open/close state and
 * positions this via `className`. `value`/`onPick` deal in palette SLOT ids (not
 * hexes); each swatch resolves its slot to a hex only to paint the disc. In
 * `readOnly` mode the swatches are plain (non-clickable) spans — no buttons, no
 * selected ring — just a swatch display.
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
  return (
    <div className={`solenoid-swatchgrid${readOnly ? " solenoid-swatchgrid--readonly" : ""}${className ? ` ${className}` : ""}`}>
      {colors.map((slot) =>
        readOnly ? (
          <span key={slot} className="solenoid-swatchgrid__opt" title={slot}>
            <Swatch color={resolveColor(slot)} on={false} />
          </span>
        ) : (
          <button
            key={slot}
            type="button"
            className="solenoid-swatchgrid__opt"
            title={slot}
            onClick={() => onPick?.(slot)}
          >
            <Swatch color={resolveColor(slot)} on={slot === value} />
          </button>
        ),
      )}
    </div>
  );
}

/**
 * SVG disc instead of a CSS border-radius button. A CSS circle inscribes its own
 * border box, so its edge sits on the box boundary and gets clipped a side at a
 * time on fractional device pixels (the grid lives inside the zoom-scaled canvas).
 * Drawing it as SVG with overflow:visible and a padded viewBox keeps the disc —
 * and the selected ring, which overflows the 16px button like the old box-shadow —
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
