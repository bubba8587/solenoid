import { useEffect, useRef } from "react";
import { MenuBar } from "./MenuBar";
import { TopBar } from "./TopBar";
import { chromeZoomStore } from "./chromeZoom";
import "./Header.css";

/** Publishes its measured height as `--chrome-top`; the height varies (a tablet wraps to two rows), so never hard-code it. */
export function Header() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // On the root, so sibling overlays inherit it. Floor, never round: publishing above the true fractional height
    // opens a subpixel gap below the bar.
    // `--chrome-top-px` is the same height under a name zoomed chrome can divide by its zoom (chromeZoom.css).
    const publish = () => {
      const h = `${Math.floor(el.getBoundingClientRect().height)}px`;
      document.documentElement.style.setProperty(
        "--chrome-top",
        h,
      );
      document.documentElement.style.setProperty("--chrome-top-px", h);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    // A zoom change moves the on-screen height without resizing the header in its own pixels.
    const unZoom = chromeZoomStore.subscribe(() => requestAnimationFrame(publish));
    return () => {
      ro.disconnect();
      unZoom();
      document.documentElement.style.removeProperty("--chrome-top");
      document.documentElement.style.removeProperty("--chrome-top-px");
    };
  }, []);

  return (
    <div className="solenoid-header" ref={ref}>
      <MenuBar />
      <TopBar />
    </div>
  );
}
