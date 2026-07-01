import "./SegToggle.css";

/**
 * A segmented button toggle — the Format Controller's places/sig-figs button
 * style as a reusable control. Drag-safe (stops pointer/mouse-down so dragging a
 * button doesn't start a node drag, like the FC controls). One button per option;
 * the active one gets `--on`.
 */
export function SegToggle<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
}) {
  return (
    <div className="solenoid-seg" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`solenoid-segbtn${value === o.value ? " solenoid-segbtn--on" : ""}`}
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
