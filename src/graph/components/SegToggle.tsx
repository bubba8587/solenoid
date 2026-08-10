import "./SegToggle.css";
import { stopDragStart } from "../coarse";

/** Stops pointer/mouse-down so dragging a button doesn't start a node drag. */
export function SegToggle<T extends string>({ value, onChange, options, className, arg }: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  className?: string;
  /** A toggle that is NOT the family's op selector — the same declaration OpSelect
   *  takes, because a segmented toggle is the OTHER way a card carries an op picker
   *  (Sparkline's chart type, Surface's view, the resistor's band count all bind `op`
   *  here). Without it VAL-12's source scan could not tell a legitimate argument
   *  binding `mode`/`dir` from a family that misnamed its op field — the PadNode.dir
   *  defect, through the door the OpSelect-only scan did not watch. Purely a
   *  classification: `data-op-arg` rides into the DOM for symmetry with OpSelect and
   *  carries no styling of its own. */
  arg?: boolean;
}) {
  return (
    <div className={`solenoid-seg${className ? ` ${className}` : ""}`} data-op-arg={arg ? "" : undefined} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`solenoid-segbtn${value === o.value ? " solenoid-segbtn--on" : ""}`}
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
