// [[C26]] opArgDistinct
import type { ReactNode } from "react";
import "./SegToggle.css";
import "./colType.css";
import { stopDragStart } from "../coarse";

type SegProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  /** An icon label takes its `title` as its accessible name. */
  options: ReadonlyArray<{ value: T; label: ReactNode; title?: string }>;
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
          aria-label={typeof o.label === "string" ? undefined : o.title}
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

/** Never bound to a field named `op` ([[C26]] opArgDistinct); stops pointer and mouse down so a press doesn't start a node drag. */
export function SegToggle<T extends string>(props: SegProps<T>) {
  return <Seg {...props} />;
}

/** Binds `op`, and hoists and takes the accent like OpSelect (DESIGN.md § Op pickers). */
export function OpToggle<T extends string>(props: SegProps<T>) {
  return <Seg {...props} className={`solenoid-seg--op${props.className ? ` ${props.className}` : ""}`} />;
}

/** An op picker drawn as the column type button (`sol-coltype`) in the op accent: one button showing the current op,
 *  a click cycling to the next. It rides the field it types instead of hoisting (Value Input, DESIGN.md § Op pickers). */
export function OpCycle<T extends string>({ value, onChange, options, className }: SegProps<T>) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const cur = options[at];
  const next = options[(at + 1) % options.length];
  return (
    <button
      type="button"
      className={`sol-coltype sol-coltype--op${className ? ` ${className}` : ""}`}
      title={`${cur?.title ?? cur?.value}. Cycles ${options.map((o) => o.title ?? o.value).join(" / ")}.`}
      aria-label={cur?.title ?? cur?.value}
      onClick={(e) => { e.stopPropagation(); if (next) onChange(next.value); }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {cur?.label}
    </button>
  );
}
