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
    // FLOOR, never round or ceil — the same rule as chromeBottom.ts: `top: var`
    // puts a panel's top edge AT the published height, so publishing above the
    // bar's true fractional height opens a subpixel gap below it.
    const publish = () =>
      document.documentElement.style.setProperty(
        "--chrome-top",
        `${Math.floor(el.getBoundingClientRect().height)}px`,
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
