// [[B14]] oneDesignSystem (DESIGN.md § Card sections)
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { bumpConnectionVersion } from "../graphSignals";
import { sectionFoldStore } from "../sectionFoldStore";
import { scheduleAutosave } from "../persistence";
import { useHostNodeId } from "./nodeContext";
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
  // A hand fold or open is saved with the document; until then the section follows defaultOpen.
  const nodeId = useHostNodeId();
  const saved = useSyncExternalStore(sectionFoldStore.subscribe, () => (nodeId ? sectionFoldStore.get(nodeId, label) : undefined));
  const [local, setLocal] = useState<boolean | undefined>(undefined);
  const open = (nodeId ? saved : local) ?? defaultOpen;
  const setOpen = (next: boolean) => {
    if (!nodeId) { setLocal(next); return; }
    sectionFoldStore.set(nodeId, label, next);
    scheduleAutosave();
  };
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
        {open ? <ChevronDownIcon size={8} strokeWidth={3} /> : <ChevronRightIcon size={8} strokeWidth={3} />}
        {label}
      </button>
      {open && children}
    </div>
  );
}
