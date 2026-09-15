import { useLayoutEffect, useRef, useState } from "react";

// A decorative thread down the marketing page: a soft, socketless bezier from the
// bottom-center of each live flow-canvas viewport to the top-center of the next, so the
// scenes read as one continuous flow. Pure overlay — measured from the DOM, no sockets,
// no interaction. Mounts as the first child of `.sol-landing__inner` (which is made
// position:relative) and spans its full scroll height. Recomputes as the scenes lay out
// (they settle async) and on resize.

const STAGE_SELECTOR = ".sol-scene-stage, .sol-landing__stage";

export function SceneThread() {
  const ref = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const svg = ref.current;
    const inner = svg?.parentElement;
    if (!inner) return;

    const compute = () => {
      const innerRect = inner.getBoundingClientRect();
      const stages = Array.from(inner.querySelectorAll<HTMLElement>(STAGE_SELECTOR));
      // Bottom-center of each viewport, and top-center, in the inner's own coordinates
      // (the difference of two viewport rects is scroll-independent).
      const pts = stages.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          cx: r.left - innerRect.left + r.width / 2,
          top: r.top - innerRect.top,
          bottom: r.bottom - innerRect.top,
        };
      });
      const ds: string[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const gap = b.top - a.bottom;
        // Vertical control handles that ease out of the bottom and into the top; longer
        // for a bigger gap so a long run between scenes stays a gentle S.
        const c = Math.max(48, gap * 0.42);
        ds.push(`M ${a.cx.toFixed(1)} ${a.bottom.toFixed(1)} C ${a.cx.toFixed(1)} ${(a.bottom + c).toFixed(1)}, ${b.cx.toFixed(1)} ${(b.top - c).toFixed(1)}, ${b.cx.toFixed(1)} ${b.top.toFixed(1)}`);
      }
      setPaths(ds);
      setSize({ w: inner.offsetWidth, h: inner.offsetHeight });
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(inner);
    for (const el of inner.querySelectorAll(STAGE_SELECTOR)) ro.observe(el);
    window.addEventListener("resize", compute);
    // The scenes lay out asynchronously (headless ELK, async connection reads); recompute
    // a couple of times after mount so the thread lands on their settled positions.
    const t1 = window.setTimeout(compute, 400);
    const t2 = window.setTimeout(compute, 1400);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  return (
    <svg
      ref={ref}
      className="sol-scene-thread"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
