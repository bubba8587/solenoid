import "./SegToggle.css";
import { stopDragStart } from "../coarse";

/** A segmented button toggle. Drag-safe: it stops pointer/mouse-down so dragging a
 *  button doesn't start a node drag. The active option gets `--on`. */
export function SegToggle<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  /** Extra class on the group — e.g. the FC's inline-row sizing variant. */
  className?: string;
}) {
  return (
    <div className={`solenoid-seg${className ? ` ${className}` : ""}`} role="group">
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
