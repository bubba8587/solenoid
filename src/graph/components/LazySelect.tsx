import {
  Children, isValidElement, useLayoutEffect, useRef, useState,
  type ReactNode, type SelectHTMLAttributes,
} from "react";

/**
 * A drop-in `<select>` that keeps its option list OUT of the DOM until the user
 * is about to open it. Native options render zero pixels while the dropdown is
 * closed, yet a mounted catalog-sized list (the FC's unit dropdown, Convert's
 * unit pickers) was the single largest DOM-weight bucket on a formula-heavy
 * graph — thousands of invisible <option>/<optgroup> elements.
 *
 * Width: node cards are max-content-sized, so the WIDEST option is what holds a
 * select (and its card) wide — dropping to one option would shrink the card,
 * then re-grow it on hover. So the first render mounts the full list, a
 * pre-paint layout effect measures the natural width and locks it as an inline
 * min-width, and only then does the list drop to the single selected option —
 * the card's width is pixel-identical to a plain <select> at every moment.
 * Re-measures if the option set changes (pack units, an async file list).
 *
 * Interaction: pointerenter/focus re-mount the real list — both precede the
 * mousedown/keydown that opens the native picker, so the swap is unobservable.
 * Options unmount again on blur / un-focused pointerleave (never while focused:
 * the native popup may be open, and yanking options out from under it breaks
 * the pick).
 */
export function LazySelect({
  children, value, style, onPointerEnter, onPointerLeave, onFocus, onBlur, ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  const [hot, setHot] = useState(false);
  const [minWidth, setMinWidth] = useState<number | null>(null);

  // Any change to the option set invalidates the width lock and forces a
  // re-measure pass (rendered armed, measured pre-paint, locked, dropped).
  const sig = optionsSignature(children);
  const [measuredSig, setMeasuredSig] = useState<string | null>(null);
  const needMeasure = measuredSig !== sig;
  useLayoutEffect(() => {
    if (!needMeasure) return;
    const el = ref.current;
    // 0 width = not laid out (hidden/collapsed) — stay armed rather than lock
    // a bogus width; the next visible render measures for real.
    const w = el ? el.offsetWidth : 0;
    if (w > 0) {
      setMeasuredSig(sig);
      setMinWidth(w);
    }
  }, [sig, needMeasure]);

  const armed = needMeasure || hot;
  return (
    <select
      {...rest}
      ref={ref}
      value={value}
      style={minWidth != null ? { ...style, minWidth } : style}
      onPointerEnter={(e) => { setHot(true); onPointerEnter?.(e); }}
      onFocus={(e) => { setHot(true); onFocus?.(e); }}
      onBlur={(e) => { setHot(false); onBlur?.(e); }}
      onPointerLeave={(e) => {
        if (document.activeElement !== e.currentTarget) setHot(false);
        onPointerLeave?.(e);
      }}
    >
      {armed
        ? children
        : <option value={value as string | number | undefined}>{selectedLabel(children, String(value))}</option>}
    </select>
  );
}

/** Walk the option tree (through optgroups/fragments/arrays), calling `fn` for
 *  each <option>'s (value, label). */
function walkOptions(children: ReactNode, fn: (value: string, label: ReactNode) => void): void {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode };
    if (child.type === "option") fn(String(props.value), props.children);
    else if (props.children != null) walkOptions(props.children, fn);
  });
}

/** A cheap identity for the option set — labels + values — so a changed list
 *  (async file listing, pack units) re-measures the width lock. */
function optionsSignature(children: ReactNode): string {
  let sig = "";
  walkOptions(children, (value, label) => { sig += `${value}|${String(label)};`; });
  return sig;
}

/** The label the closed select should display: the child <option> matching
 *  `value`, else the first option — mirroring what the native select shows
 *  when no value matches. */
function selectedLabel(children: ReactNode, value: string): ReactNode {
  let match: ReactNode | undefined;
  let first: ReactNode | undefined;
  walkOptions(children, (v, label) => {
    if (first === undefined) first = label;
    if (match === undefined && v === value) match = label;
  });
  return match ?? first ?? "";
}
