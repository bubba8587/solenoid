// [[B14]] oneDesignSystem
import { useLayoutEffect, useState } from "react";

export interface PopupChoiceOption<T extends string> { value: T; label: string; title?: string }

/** A popup's one-of-several pick: segments when they fit, else a dropdown in the same pill. */
export function PopupChoice<T extends string>({ value, options, onChange, label, segmented, className }: {
  value: T;
  options: readonly PopupChoiceOption<T>[];
  onChange: (next: T) => void;
  label: string;
  segmented: boolean;
  className?: string;
}) {
  if (segmented) {
    return (
      <div className={`table-popup__view${className ? ` ${className}` : ""}`} role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    );
  }
  return (
    <select className={`sol-pill-select${className ? ` ${className}` : ""}`} value={value} aria-label={label} title={label} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** The width segments need: the label text at the UI face's average advance, plus each segment's padding and divider. */
export function segmentsWidth(labels: readonly string[], touch = false): number {
  const perChar = touch ? 6.1 : 6.7;
  const pad = touch ? 16 : 24;
  return labels.reduce((w, l) => w + l.length * perChar + pad, 2);
}

/**
 * The room a row leaves for one of its items: its inner width less every other item and the gaps.
 * The other items never change size with the measured one, so the answer can't feed back on itself.
 * Attach `ref` to the row.
 */
export function useFreeWidth(itemSelector: string): { ref: (el: HTMLElement | null) => void; free: number } {
  const [row, setRow] = useState<HTMLElement | null>(null);
  // Zero until measured, which happens before the first paint: a dropdown never flashes as segments.
  const [free, setFree] = useState(0);
  // Measured only when the row or one of its items resizes or an item comes or goes, never per render.
  useLayoutEffect(() => {
    if (!row) return;
    const measure = () => {
      const cs = getComputedStyle(row);
      const gap = parseFloat(cs.columnGap) || 0;
      let used = 0, n = 0;
      const count = (el: HTMLElement) => {
        if (el.matches(itemSelector) || el.classList.contains("table-popup__spacer")) return;
        const st = getComputedStyle(el);
        if (st.display === "contents") { for (const c of Array.from(el.children) as HTMLElement[]) count(c); return; }
        // Out of the flow (an open sheet or menu) takes no room in the row.
        if (el.offsetWidth === 0 || st.position === "absolute" || st.position === "fixed") return;
        used += el.offsetWidth; n++;
      };
      for (const child of Array.from(row.children) as HTMLElement[]) count(child);
      const inner = row.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const next = Math.floor(inner - used - gap * n);
      setFree((f) => (f === next ? f : next));
    };
    const ro = new ResizeObserver(measure);
    const watch = () => {
      ro.disconnect();
      ro.observe(row);
      for (const el of Array.from(row.querySelectorAll<HTMLElement>(":scope > *, :scope > * > *"))) if (!el.matches(itemSelector)) ro.observe(el);
    };
    const mo = new MutationObserver(() => { watch(); measure(); });
    mo.observe(row, { childList: true, subtree: true });
    watch();
    measure();
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [row, itemSelector]);
  return { ref: setRow, free };
}
