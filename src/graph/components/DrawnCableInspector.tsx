// The panel for ONE selected drawn cable, in the cable inspector's corner and chrome.
// The wired-cable CableInspector is untouched; selections are mutually exclusive.
import { useSyncExternalStore } from "react";
import {
  drawnCableStore, nearestOption, commitDrawn,
  DRAWN_WIDTHS, DRAWN_HEAD_SCALES, DRAWN_ANGLE_STEP,
} from "../drawnCables";
import {
  DRAWN_ARROWS, drawnHeadings, hasAngleOverride, type DrawnArrows,
} from "../drawnCablePath";
import { AngleDial } from "../AngleDial";
import { CABLE_SHAPES, type CableShape } from "../cableShape";
import { CableShapeIcon } from "../CableShapeSelector";
import { SwatchGrid } from "./SwatchGrid";
import { CloseIcon } from "./CloseIcon";
import "./cableInspector.css";
import "./drawnCableInspector.css";

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

  const commit = (fn: () => void) => { fn(); commitDrawn(); };

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

      <SizeSelect
        label="Head"
        options={DRAWN_HEAD_SCALES}
        value={cable.headScale}
        disabled={cable.arrows === "none"}
        onPick={(v) => commit(() => drawnCableStore.setHeadScale(cable.id, v))}
      />

      <div className="solenoid-drawn-inspector__row">
        <span className="solenoid-cable-inspector__role">Point</span>
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
        <button
          type="button"
          className="solenoid-drawn-inspector__pointbtn"
          aria-label="Add a point"
          title="Add a point"
          onClick={() => commit(() => {
            const i = drawnCableStore.splitAt(cable.id, point);
            if (i !== null) drawnCableStore.setActivePoint(i);
          })}
        >
          +
        </button>
        <button
          type="button"
          className="solenoid-drawn-inspector__pointbtn solenoid-drawn-inspector__pointbtn--drop"
          aria-label="Remove this point"
          title="Remove this point"
          disabled={count <= 2}
          onClick={() => commit(() => drawnCableStore.removePoint(cable.id, point))}
        >
          <CloseIcon size={11} />
        </button>
      </div>

      <div className="solenoid-drawn-inspector__row solenoid-drawn-inspector__row--dial">
        <span className="solenoid-cable-inspector__role">Angle</span>
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
