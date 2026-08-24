import { useEffect, useRef, type RefObject } from "react";

// React's onPointerEnter/onMouseEnter do NOT fire when the pointer arrives from a
// DIFFERENT React root (its enter/leave plugin defers to the other root's `out`
// dispatch, which never reaches this root's fibers). Every rete node is its own root,
// so a hover that starts on the canvas never "enters" a card's element through React.
// Native pointerenter/pointerleave do fire (measured 2026-08-24, the frame-hint socket).
// Use this for any enter/leave inside a node-rendered component.
export function useNativeEnterLeave(
  ref: RefObject<HTMLElement | null>,
  onEnter: ((e: PointerEvent) => void) | undefined,
  onLeave: ((e: PointerEvent) => void) | undefined,
): void {
  const enter = useRef(onEnter); enter.current = onEnter;
  const leave = useRef(onLeave); leave.current = onLeave;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onE = (e: PointerEvent) => enter.current?.(e);
    const onL = (e: PointerEvent) => leave.current?.(e);
    el.addEventListener("pointerenter", onE);
    el.addEventListener("pointerleave", onL);
    return () => { el.removeEventListener("pointerenter", onE); el.removeEventListener("pointerleave", onL); };
  }, [ref]);
}
