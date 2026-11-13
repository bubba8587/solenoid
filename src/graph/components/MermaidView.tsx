// [[C100]] chartIsAValue (the shared slot order), [[engineering#Untrusted content]]
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { MountOptions, Mounted } from "pele";
import { appThemeStore } from "../appTheme";
import { paletteStore, resolveColor, themeAccent } from "../palette";

// Pele reads eight series colors; these are the first eight slots of the categorical order.
const SERIES_SLOTS = ["blue", "gold", "teal", "pink", "green", "purple", "sky", "vermilion"] as const;

function seriesVars(mode: "dark" | "light"): CSSProperties {
  const vars: Record<string, string> = {};
  SERIES_SLOTS.forEach((slot, i) => { vars[`--pele-series-${i + 1}`] = themeAccent(resolveColor(slot), mode); });
  // A label on a colored fill takes the ink that reads on it (pele 1.12): the palette's light-theme text on a light
  // fill, its dark-theme text on a dark one, in either app theme.
  const chrome = paletteStore.chrome();
  if (chrome.light.text) vars["--pele-fg-on-light"] = chrome.light.text;
  if (chrome.dark.text) vars["--pele-fg-on-dark"] = chrome.dark.text;
  return vars as CSSProperties;
}

/** The same eight colors as Mermaid theme variables, the form pele (1.13) reads to give each series' labels the ink that
 *  contrasts with it. A diagram's own `%%{init}%%` theme variables still win. */
function paletteConfig(mode: "dark" | "light"): MountOptions["config"] {
  const hex = SERIES_SLOTS.map((slot) => themeAccent(resolveColor(slot), mode));
  const vars: Record<string, string | Record<string, string>> = { xyChart: { plotColorPalette: hex.join(",") } };
  hex.forEach((h, i) => {
    vars[`pie${i + 1}`] = h;
    vars[`venn${i + 1}`] = h;
    vars[`git${i}`] = h;
    vars[`cScale${i}`] = h;
  });
  vars.cScale8 = hex[7];
  return { themeVariables: vars };
}

let _peleMod: Promise<typeof import("pele/lazy")> | null = null;
function loadPele(): Promise<typeof import("pele/lazy")> {
  return (_peleMod ??= import("pele/lazy"));
}

export function MermaidView({ source, className }: { source: string; className?: string }) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const palette = useSyncExternalStore(paletteStore.subscribe, paletteStore.version);
  const mode = appThemeStore.getMode();
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
      config: paletteConfig(mode),
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
  }, [source, mode, palette]);

  const hostClass = className ? `solenoid-mermaid nowheel ${className}` : "solenoid-mermaid nowheel";
  return (
    <>
      {error && <div className="solenoid-mermaid solenoid-mermaid--error" title={error}>Diagram error</div>}
      <div
        ref={hostRef}
        className={hostClass}
        style={{ ...seriesVars(mode), ...(error ? { display: "none" } : null) }}
      />
    </>
  );
}
