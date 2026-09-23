import {
  Children, isValidElement, useLayoutEffect, useRef, useState,
  type ReactNode, type SelectHTMLAttributes,
} from "react";

/** Options stay out of the DOM until hover or focus, which both precede the native picker, and never unmount while focused; the first render mounts them all to lock a min-width, since a max-content card is held wide by its widest option. */
export function LazySelect({
  children, value, style, onPointerEnter, onPointerLeave, onFocus, onBlur, ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  const [hot, setHot] = useState(false);
  const [minWidth, setMinWidth] = useState<number | null>(null);

  const sig = optionsSignature(children);
  const [measuredSig, setMeasuredSig] = useState<string | null>(null);
  const needMeasure = measuredSig !== sig;
  useLayoutEffect(() => {
    if (!needMeasure) return;
    const el = ref.current;
    // The used width, rounded up, not offsetWidth: an integer-rounded fractional width re-grows on every hover swap; 0 means not laid out, so stay armed.
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
        : <option value={value}>{selectedLabel(children, String(value))}</option>}
    </select>
  );
}

function walkOptions(children: ReactNode, fn: (value: string, label: ReactNode) => void): void {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: ReactNode };
    if (child.type === "option") fn(String(props.value), props.children);
    else if (props.children != null) walkOptions(props.children, fn);
  });
}

function optionsSignature(children: ReactNode): string {
  let sig = "";
  walkOptions(children, (value, label) => { sig += `${value}|${String(label)};`; });
  return sig;
}

function selectedLabel(children: ReactNode, value: string): ReactNode {
  let match: ReactNode | undefined;
  let first: ReactNode | undefined;
  walkOptions(children, (v, label) => {
    if (first === undefined) first = label;
    if (match === undefined && v === value) match = label;
  });
  return match ?? first ?? "";
}
