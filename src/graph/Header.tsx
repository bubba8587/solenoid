import { useEffect, useRef } from "react";
import { MenuBar } from "./MenuBar";
import { TopBar } from "./TopBar";
import "./Header.css";

/**
 * App header: the menu bar stacked above the toolbar, pinned full-width to the
 * top edge. The two rows together are the "app bar"; the bottom accent
 * highlight lives on the toolbar (TopBar).
 *
 * It also PUBLISHES its own measured height as `--chrome-top`, which the
 * top-anchored floating overlays derive their offsets from (nav pill,
 * Navigator, align pill, HUD stack, docked report, web-demo banner — see
 * docs/layout-chrome.md).
 *
 * Why measured rather than written down: those offsets were six hand-keyed
 * magic numbers all encoding the same 66px envelope, and keeping them in sync
 * by hand is the documented source of the recurring "overlay overlaps a bar"
 * bug (the align pill shipped at 56px against an 82px bar and landed inside the
 * toolbar). Once the bar's height became CONDITIONAL — a tablet wraps it to two
 * rows, and where it wraps depends on the viewport — a written-down number
 * stopped being knowable at all. Measuring is the only form that can't drift.
 *
 * The CSS keeps a static fallback in every `var()` call, so the layout is right
 * on the first paint before the observer fires, and right if it never fires.
 * Mobile keeps its own explicit overrides (they carry safe-area insets and win
 * later in the cascade) — untouched here.
 */
export function Header() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Written to the ROOT, not to the header: the overlays are siblings
    // elsewhere in the tree, so the var must inherit from :root to reach them.
    const publish = () =>
      document.documentElement.style.setProperty(
        "--chrome-top",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--chrome-top");
    };
  }, []);

  return (
    <div className="solenoid-header" ref={ref}>
      <MenuBar />
      <TopBar />
    </div>
  );
}
