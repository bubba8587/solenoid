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
 * The height is CONDITIONAL (a tablet wraps the bar to two rows), so it must be
 * measured, never written down. The CSS keeps a static fallback in every `var()`
 * call, so the layout is right on the first paint before the observer fires, and
 * right if it never fires. Mobile keeps its own explicit overrides (they carry
 * safe-area insets and win later in the cascade).
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
