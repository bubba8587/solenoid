// [[C100]] chartIsAValue (the shared slot order), [[C103]] untrustedContentSeams
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { MountOptions, Mounted } from "pele";
import { appThemeStore } from "../appTheme";
import { resolveColor, themeAccent } from "../palette";

// Pele reads eight series colors; these are the first eight slots of the categorical order.
const SERIES_SLOTS = ["blue", "gold", "teal", "pink", "green", "purple", "sky", "vermilion"] as const;

function seriesVars(mode: "dark" | "light"): CSSProperties {
  const vars: Record<string, string> = {};
  SERIES_SLOTS.forEach((slot, i) => { vars[`--pele-series-${i + 1}`] = themeAccent(resolveColor(slot), mode); });
  return vars as CSSProperties;
}

let _peleMod: Promise<typeof import("pele/lazy")> | null = null;
function loadPele(): Promise<typeof import("pele/lazy")> {
  return (_peleMod ??= import("pele/lazy"));
}

export function MermaidView({ source, className }: { source: string; className?: string }) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const src = source.trim();
    if (!host) return;
    if (!src) { setError(null); host.replaceChildren(); return; }
    let canceled = false;
    let mounted: Mounted | null = null;
    const options: MountOptions = {
      // The source can ride in any shared document, so links stay inert and no image is fetched.
      links: false,
      images: false,
      zoom: false,
      onRender: () => { if (!canceled) setError(null); },
      onError: (e) => { if (!canceled) setError(e instanceof Error ? e.message : "Invalid diagram"); },
    };
    loadPele()
      .then((pele) => pele.mountAsync(host, src, options))
      .then((m) => { if (canceled) m.destroy(); else mounted = m; })
      .catch((e: unknown) => { if (!canceled) setError(e instanceof Error ? e.message : "Invalid diagram"); });
    return () => { canceled = true; mounted?.destroy(); };
  }, [source]);

  const hostClass = className ? `solenoid-mermaid nowheel ${className}` : "solenoid-mermaid nowheel";
  return (
    <>
      {error && <div className="solenoid-mermaid solenoid-mermaid--error" title={error}>Diagram error</div>}
      <div
        ref={hostRef}
        className={hostClass}
        style={{ ...seriesVars(appThemeStore.getMode()), ...(error ? { display: "none" } : null) }}
      />
    </>
  );
}
