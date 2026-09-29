// [[B14]] oneDesignSystem (DESIGN.md § Card sections)
import { useEffect, useRef, useState, type ReactNode } from "react";
import { bumpConnectionVersion } from "../graphSignals";
import { ChevronDownIcon, ChevronRightIcon } from "./Icons";
import "./nodeCard.css";

/** A small caption over a run of card rows; `collapsible` folds the rows away behind it. */
export function CardSection({ label, title, collapsible, defaultOpen = true, pinnedOpen, className, children }: {
  label: string;
  title?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  // A wired socket inside keeps the section open, so no cable ends on an undrawn dot.
  pinnedOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const foldable = !!collapsible && !pinnedOpen;
  const mounted = useRef(false);
  useEffect(() => {
    // The rows below the section moved, so their cables re-route once the fold has laid out.
    if (mounted.current) bumpConnectionVersion();
    mounted.current = true;
  }, [open]);
  const cls = `solenoid-node__section${className ? ` ${className}` : ""}`;

  if (!foldable) {
    return (
      <div className={cls}>
        <div className="solenoid-node__section-caption" title={title}>{label}</div>
        {children}
      </div>
    );
  }
  return (
    <div className={cls}>
      <button
        type="button"
        className="solenoid-node__section-caption solenoid-node__section-caption--toggle"
        title={title ?? (open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`)}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {open ? <ChevronDownIcon size={10} strokeWidth={2.4} /> : <ChevronRightIcon size={10} strokeWidth={2.4} />}
        {label}
      </button>
      {open && children}
    </div>
  );
}
