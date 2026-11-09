import { CABLE_SHAPES, useCableShape, type CableShape } from "./cableShape";
import { useCableFlow } from "./cableFlowStore";
import "./CableShapeSelector.css";

// Schematic, exaggerated so the three shapes stay distinct at icon size; the near-square span makes the diagonal about 45°.
const S = { x: 0, y: 0 };
const T = { x: 32, y: 28 };
const MID_X = (S.x + T.x) / 2;
const SHAPE_ICON: Record<CableShape, string> = {
  diagonal: `M ${S.x},${S.y} L ${T.x},${T.y}`,
  spline: `M ${S.x},${S.y} C ${S.x + 16},${S.y} ${T.x},${T.y - 16} ${T.x},${T.y}`,
  straight: `M ${S.x},${S.y} L ${MID_X},${S.y} L ${MID_X},${T.y} L ${T.x},${T.y}`,
};

/** Shared by the toolbar control and the Cable Inspector chip; the ring's hollow fills with `--icon-bg` from the host. */
export function CableShapeIcon({ shape, className }: { shape: CableShape; className?: string }) {
  return (
    <svg className={className} viewBox="-7 -8 46 44" aria-hidden="true">
      <path
        d={SHAPE_ICON[shape]}
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="miter"
      />
      {/* Source = closed (output); target = open ring (input), its hollow
          filled with the panel bg so the cable doesn't show through. */}
      <circle cx={S.x} cy={S.y} r="5.5" fill="currentColor" />
      <circle cx={T.x} cy={T.y} r="4.5" stroke="currentColor" strokeWidth="2.5" style={{ fill: "var(--icon-bg)" }} />
    </svg>
  );
}

export function CableShapeSelector() {
  const { shape, setShape } = useCableShape();
  const { flow, toggleFlow } = useCableFlow();
  return (
    <div className="solenoid-toolbar">
      <span className="solenoid-toolbar__label">Cable</span>
      <div className="solenoid-toolbar__segmented">
        {CABLE_SHAPES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            title={entry.label}
            aria-label={entry.label}
            aria-pressed={entry.value === shape}
            className={
              entry.value === shape
                ? "solenoid-toolbar__segment solenoid-toolbar__segment--active"
                : "solenoid-toolbar__segment"
            }
            onClick={() => setShape(entry.value)}
          >
            <CableShapeIcon shape={entry.value} className="solenoid-toolbar__icon" />
          </button>
        ))}
      </div>
      {/* Animated mode: toggles the bead flow along every live cable. */}
      <button
        type="button"
        title={flow ? "Stop cable animation" : "Animate data flow"}
        aria-label="Animate data flow"
        aria-pressed={flow}
        className={
          flow
            ? "solenoid-toolbar__flow solenoid-toolbar__flow--active"
            : "solenoid-toolbar__flow"
        }
        onClick={toggleFlow}
      >
        {/* A faint base line, a strip of beads (the cables' round-capped 0.01 dash) sliding one period left → right
            inside a window between the ends, and the two end circles drawn last, so a bead enters and leaves hidden
            beneath them. The strip moves by transform, so the toggle animates on the compositor and never repaints the bar. */}
        <span className="solenoid-toolbar__flow-icon" aria-hidden="true">
          <svg viewBox="0 0 40 16" className="solenoid-toolbar__flow-art">
            <line x1="5" y1="8" x2="35" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
          </svg>
          <span className="solenoid-toolbar__flow-window">
            <svg viewBox="-10.01 0 60.02 16" className="solenoid-toolbar__flow-beads">
              <line x1="-5.01" y1="8" x2="45.01" y2="8" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeDasharray="0.01 10" />
            </svg>
          </span>
          <svg viewBox="0 0 40 16" className="solenoid-toolbar__flow-art">
            <circle cx="5" cy="8" r="3.2" fill="currentColor" />
            <circle cx="35" cy="8" r="3.2" fill="currentColor" />
          </svg>
        </span>
      </button>
    </div>
  );
}

