// The panel for exactly ONE selected free-drawn cable. It takes the cable inspector's
// slot and chrome (same corner, same overlay tokens) but not its content: a drawn cable
// carries no value, no ends and no run, so it offers what it DOES have — its own drawer,
// its arrowheads and its color.
//
// The wired-cable CableInspector is untouched; selections are mutually exclusive, so
// only one of the two is ever mounted.
import { useSyncExternalStore } from "react";
import {
  drawnCableStore, nearestOption,
  DRAWN_WIDTHS, DRAWN_HEAD_SCALES, DRAWN_ANGLE_STEP,
} from "../drawnCables";
import {
  DRAWN_ARROWS, drawnHeadings, hasAngleOverride, type DrawnArrows,
} from "../drawnCablePath";
import { AngleDial } from "../AngleDial";
import "../AngleDial.css";
import { CABLE_SHAPES, type CableShape } from "../cableShape";
import { CableShapeIcon } from "../CableShapeSelector";
import { SwatchGrid } from "./SwatchGrid";
import { CloseIcon } from "./CloseIcon";
import { scheduleAutosave } from "../persistence";
import "./cableInspector.css";
import "./drawnCableInspector.css";

/** A horizontal cable with the heads the setting turns on, so the four options read as
 *  one drawing that gains and loses tips. */
function ArrowIcon({ arrows }: { arrows: DrawnArrows }) {
  const head = (x: number, dir: 1 | -1) =>
    `M ${x},9 L ${x - dir * 7},4.5 L ${x - dir * 7},13.5 Z`;
  const start = arrows === "start" || arrows === "both";
  const end = arrows === "end" || arrows === "both";
  return (
    <svg viewBox="0 0 32 18" aria-hidden="true" className="solenoid-drawn-inspector__arrow-icon">
      <path
        d={`M ${start ? 8 : 3},9 L ${end ? 24 : 29},9`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {start && <path d={head(2, -1)} fill="currentColor" />}
      {end && <path d={head(30, 1)} fill="currentColor" />}
    </svg>
  );
}

/** A plain size dropdown. Native `<select>`, like every other picker on a card. */
function SizeSelect({
  label,
  options,
  value,
  onPick,
  disabled,
}: {
  label: string;
  options: readonly { value: number; label: string }[];
  value: number;
  onPick: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="solenoid-drawn-inspector__row">
      <span className="solenoid-cable-inspector__role">{label}</span>
      <select
        className="solenoid-drawn-inspector__select"
        value={nearestOption(options, value)}
        disabled={disabled}
        onChange={(e) => onPick(parseFloat(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onPick,
  render,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
  render: (v: T) => React.ReactNode;
}) {
  return (
    <div className="solenoid-drawn-inspector__row">
      <span className="solenoid-cable-inspector__role">{label}</span>
      <div className="solenoid-drawn-inspector__segmented">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.label}
            aria-label={o.label}
            aria-pressed={o.value === value}
            className={
              o.value === value
                ? "solenoid-drawn-inspector__segment solenoid-drawn-inspector__segment--active"
                : "solenoid-drawn-inspector__segment"
            }
            onClick={() => onPick(o.value)}
          >
            {render(o.value)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DrawnCableInspector() {
  useSyncExternalStore(drawnCableStore.subscribe, drawnCableStore.version);

  const id = drawnCableStore.selected();
  const cable = id ? drawnCableStore.get(id) : undefined;
  if (!cable) return null;

  const commit = (fn: () => void) => { fn(); scheduleAutosave(); };

  // The stepper reaches every point, so a handle too small to click at low zoom is
  // still editable; clicking one on the canvas sets the same index.
  const count = cable.points.length;
  const point = Math.min(drawnCableStore.activePoint() ?? 0, count - 1);
  const heads = drawnHeadings(cable.points);
  const pinned = hasAngleOverride(cable.points[point]);

  return (
    <div className="solenoid-cable-inspector" role="dialog" aria-label="Drawn cable">
      <div className="solenoid-cable-inspector__head">
        <span className="solenoid-cable-inspector__title">Drawn cable</span>
        <button
          type="button"
          className="solenoid-cable-inspector__close"
          aria-label="Deselect"
          title="Deselect"
          onClick={() => drawnCableStore.select(null)}
        >
          <CloseIcon size={12} />
        </button>
      </div>

      <Segmented<CableShape>
        label="Shape"
        options={CABLE_SHAPES}
        value={cable.shape}
        onPick={(v) => commit(() => drawnCableStore.setShape(cable.id, v))}
        render={(v) => <CableShapeIcon shape={v} className="solenoid-drawn-inspector__shape-icon" />}
      />

      <Segmented<DrawnArrows>
        label="Ends"
        options={DRAWN_ARROWS}
        value={cable.arrows}
        onPick={(v) => commit(() => drawnCableStore.setArrows(cable.id, v))}
        render={(v) => <ArrowIcon arrows={v} />}
      />

      <SizeSelect
        label="Width"
        options={DRAWN_WIDTHS}
        value={cable.width}
        onPick={(v) => commit(() => drawnCableStore.setWidth(cable.id, v))}
      />

      {/* Nothing to size when neither end carries a head. */}
      <SizeSelect
        label="Head"
        options={DRAWN_HEAD_SCALES}
        value={cable.headScale}
        disabled={cable.arrows === "none"}
        onPick={(v) => commit(() => drawnCableStore.setHeadScale(cable.id, v))}
      />

      {/* One point's heading, pinned. The dial reads the LIVE heading whether pinned or
          derived, so dragging it takes over from where the curve already runs. Because
          both spans at a point read the same heading, this rotates the cable THROUGH the
          point rather than opening a kink. */}
      <div className="solenoid-drawn-inspector__row">
        <span className="solenoid-cable-inspector__role">Angle</span>
        <div className="solenoid-drawn-inspector__stepper">
          <button
            type="button"
            aria-label="Previous point"
            title="Previous point"
            onClick={() => drawnCableStore.setActivePoint((point + count - 1) % count)}
          >
            ‹
          </button>
          <span className="solenoid-drawn-inspector__point">
            {point + 1} / {count}
          </span>
          <button
            type="button"
            aria-label="Next point"
            title="Next point"
            onClick={() => drawnCableStore.setActivePoint((point + 1) % count)}
          >
            ›
          </button>
        </div>
      </div>

      <div className="solenoid-drawn-inspector__row solenoid-drawn-inspector__row--dial">
        <AngleDial
          value={heads[point]}
          step={DRAWN_ANGLE_STEP}
          size={40}
          onChange={(deg) => commit(() => drawnCableStore.setPointAngle(cable.id, point, deg))}
        />
        <button
          type="button"
          className="solenoid-drawn-inspector__auto"
          disabled={!pinned}
          title="Hand this point's heading back to the curve"
          onClick={() => commit(() => drawnCableStore.setPointAngle(cable.id, point, null))}
        >
          Auto
        </button>
      </div>

      <div className="solenoid-drawn-inspector__row solenoid-drawn-inspector__row--color">
        <span className="solenoid-cable-inspector__role">Color</span>
        <SwatchGrid
          value={cable.color}
          onPick={(slot) => commit(() => drawnCableStore.setColor(cable.id, slot))}
        />
      </div>

      <button
        type="button"
        className="solenoid-drawn-inspector__remove"
        onClick={() => commit(() => drawnCableStore.remove(cable.id))}
      >
        Remove
      </button>
    </div>
  );
}
