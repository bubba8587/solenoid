import {
  Children, isValidElement, useLayoutEffect, useRef, useState,
  type ReactNode, type SelectHTMLAttributes,
} from "react";

/** A drop-in `<select>` that keeps its option list out of the DOM until hover/focus
 *  (both precede the event that opens the native picker, so the swap is unobservable;
 *  never unmounts while FOCUSED, which would break an open popup). The first render
 *  mounts the full list to measure and lock a min-width — a card is max-content sized,
 *  so the widest option is what holds it wide. */
export function LazySelect({
  children, value, style, onPointerEnter, onPointerLeave, onFocus, onBlur, ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  const [hot, setHot] = useState(false);
  const [minWidth, setMinWidth] = useState<number | null>(null);

  // Any change to the option set invalidates the width lock and re-measures.
  const sig = optionsSignature(children);
  const [measuredSig, setMeasuredSig] = useState<string | null>(null);
  const needMeasure = measuredSig !== sig;
  useLayoutEffect(() => {
    if (!needMeasure) return;
    const el = ref.current;
    // The used width, not offsetWidth: that rounds to an integer, and a fractional
    // max-content width then re-grows by the fraction on every hover swap (the docked
    // FC chip visibly stepped 1px on mouse-over). Round UP so the lock covers it.
    // 0 width = not laid out — stay armed rather than lock a bogus width.
    const w = el ? Math.ceil(parseFloat(getComputedStyle(el).width) || 0) : 0;
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

/** A cheap identity for the option set, so a changed list re-measures the lock. */
function optionsSignature(children: ReactNode): string {
  let sig = "";
  walkOptions(children, (value, label) => { sig += `${value}|${String(label)};`; });
  return sig;
}

/** The option matching `value`, else the first — what a native select shows. */
function selectedLabel(children: ReactNode, value: string): ReactNode {
  let match: ReactNode | undefined;
  let first: ReactNode | undefined;
  walkOptions(children, (v, label) => {
    if (first === undefined) first = label;
    if (match === undefined && v === value) match = label;
  });
  return match ?? first ?? "";
}
