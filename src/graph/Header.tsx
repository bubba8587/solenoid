// [[C99]] chromeEnvelopeVars (publishes --chrome-top)
import { useEffect, useRef } from "react";
import { MenuBar } from "./MenuBar";
import { TopBar } from "./TopBar";
import "./Header.css";

/** Publishes its measured height as `--chrome-top`; the height varies (a tablet wraps to two rows), so never hard-code it. */
export function Header() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // On the root, so sibling overlays inherit it. Floor, never round: publishing above the true fractional height
    // opens a subpixel gap below the bar.
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
