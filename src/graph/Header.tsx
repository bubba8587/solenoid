import { useEffect, useRef } from "react";
import { MenuBar } from "./MenuBar";
import { TopBar } from "./TopBar";
import "./Header.css";

/** Publishes its own MEASURED height as `--chrome-top`, which every top-anchored overlay
 *  offsets from; the height is conditional (a tablet wraps to two rows) so it must never be
 *  written down, and every `var()` call keeps a static fallback for the first paint. */
export function Header() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The ROOT, not the header: the overlays are siblings, so the var must inherit to reach.
    // Ceil, never round — the same rule as chromeBottom.ts: published short,
    // a top-anchored panel gaps below the bar at fractional device pixel ratios.
    const publish = () =>
      document.documentElement.style.setProperty(
        "--chrome-top",
        `${Math.ceil(el.getBoundingClientRect().height)}px`,
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
