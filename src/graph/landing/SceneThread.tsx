// [[C2]] realCanvasScenes
import { useLayoutEffect, useRef, useState } from "react";
import { getCablePath, Position } from "../cablePaths";

// A decorative thread down the marketing page: a soft, socketless bezier from the
// bottom-center of each live flow-canvas viewport to the top-center of the next, so the
// scenes read as one continuous flow. Pure overlay — measured from the DOM, no sockets,
// no interaction. It reuses the app's cable spline (getCablePath), entering/leaving each
// point VERTICALLY (Bottom -> Top). Mounts as the first child of `.sol-landing__inner`
// (made position:relative) and spans its full scroll height; the SVG is sized in px with
// no viewBox, so 1 unit = 1 px and the coordinates never scale. Recomputes as the scenes
// lay out (async) and on resize.

// Live canvas viewports plus the static diagram scenes (e.g. the presenter slideshow),
// so the thread runs through every scene, not only the real flow canvases.
const STAGE_SELECTOR = ".sol-scene-stage, .sol-landing__stage, .sol-diagram";

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
      // Bottom-center and top-center of each viewport, in the inner's own coordinates
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
        ds.push(getCablePath("spline", {
          sourceX: a.cx, sourceY: a.bottom, sourcePosition: Position.Bottom,
          targetX: b.cx, targetY: b.top, targetPosition: Position.Top,
        }));
      }
      setPaths(ds);
      setSize({ w: inner.offsetWidth, h: inner.offsetHeight });
    };

    // rAF-coalesced recompute so bursts (scroll, observer floods) run at most once a frame.
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; compute(); });
    };

    compute();
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(inner);
    for (const el of inner.querySelectorAll(STAGE_SELECTOR)) ro.observe(el);
    window.addEventListener("resize", schedule);
    // The scroll container: scrolling means the page has settled, so recompute then too —
    // this is what self-heals a thread measured before fonts/reveals landed (the same fix
    // a browser zoom was doing by hand).
    const scroller = inner.parentElement;
    scroller?.addEventListener("scroll", schedule, { passive: true });
    // Web fonts reflow the prose (and move the scenes) after first paint.
    document.fonts?.ready.then(schedule).catch(() => {});
    // Scenes lay out asynchronously (headless ELK, async reads); a couple of late passes.
    const t1 = window.setTimeout(compute, 500);
    const t2 = window.setTimeout(compute, 1600);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      scroller?.removeEventListener("scroll", schedule);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  return (
    <svg
      ref={ref}
      className="sol-scene-thread"
      style={{ width: size.w, height: size.h }}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
