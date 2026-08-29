import "./SegToggle.css";
import { stopDragStart } from "../coarse";

type SegProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  className?: string;
};

function Seg<T extends string>({ value, onChange, options, className }: SegProps<T>) {
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

/** An ARGUMENT toggle: a parameter of the node's one function (a direction, a
 *  read-as, a match mode). Neutral, sits in its row, never bound to a field named
 *  `op`. Stops pointer/mouse-down so pressing a segment doesn't start a node drag. */
export function SegToggle<T extends string>(props: SegProps<T>) {
  return <Seg {...props} />;
}

/** The family's OP picker in segmented shape (Sparkline's chart type, Surface's
 *  view): binds `op`, hoists to the top of the body and takes the accent exactly
 *  like OpSelect (nodeCard.css). */
export function OpToggle<T extends string>(props: SegProps<T>) {
  return <Seg {...props} className={`solenoid-seg--op${props.className ? ` ${props.className}` : ""}`} />;
}
