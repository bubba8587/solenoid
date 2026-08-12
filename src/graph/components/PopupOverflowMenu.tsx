import { useEffect, useRef, useState } from "react";
import "./popupChrome.css";

export type PopupMenuItem = { label: string; onClick: () => void; disabled?: boolean };

/** The value popups live in a fixed overlay, not a rete node, so no drag-plane
 *  pointer dance is needed — `.sol-popup`'s own pointerdown already guards it. */
export function PopupOverflowMenu({ items, label = "More actions" }: { items: PopupMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <div className="sol-popup-menu" ref={ref}>
      <button
        type="button"
        className="sol-popup-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div className="sol-popup-menu__list" role="menu">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className="sol-popup-menu__item"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}
            >{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
