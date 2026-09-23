// [[C97]] rechartsLazyChunk (mermaid follows the same rule), [[C100]] chartIsAValue (the shared slot order), [[C103]] untrustedContentSeams
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, themeAccent } from "../palette";


const SERIES_SLOTS = [
  "blue", "gold", "teal", "pink", "green", "purple",
  "sky", "vermilion", "lime", "violet", "amber", "gray",
] as const;

function readVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Over-specifying is safe: mermaid ignores any variable a diagram type doesn't use.
function buildThemeVariables(mode: "dark" | "light"): Record<string, string | boolean> {
  const surface = readVar("--surface", mode === "dark" ? "#1e1e1e" : "#fbfcfd");
  const sunken = readVar("--surface-sunken", surface);
  const text = readVar("--text", mode === "dark" ? "#e8e8e8" : "#1b1e23");
  const muted = readVar("--text-muted", "#80868e");
  const border = readVar("--border", mode === "dark" ? "#2d2d2d" : "#ccd2da");
  const accent = readVar("--accent", "#56b4e9");

  const series: Record<string, string> = {};
  SERIES_SLOTS.forEach((slot, i) => { series[`pie${i + 1}`] = themeAccent(resolveColor(slot), mode); });

  return {
    darkMode: mode === "dark",
    background: "transparent",
    fontFamily: "inherit",
    primaryColor: surface,
    primaryBorderColor: accent,
    primaryTextColor: text,
    secondaryColor: sunken,
    secondaryBorderColor: border,
    secondaryTextColor: text,
    tertiaryColor: sunken,
    tertiaryBorderColor: border,
    tertiaryTextColor: text,
    lineColor: muted,
    textColor: text,
    mainBkg: surface,
    nodeBorder: accent,
    nodeTextColor: text,
    clusterBkg: sunken,
    clusterBorder: border,
    titleColor: text,
    edgeLabelBackground: surface,
    actorBkg: surface,
    actorBorder: accent,
    actorTextColor: text,
    noteBkgColor: sunken,
    noteBorderColor: accent,
    noteTextColor: text,
    pieTitleTextColor: text,
    pieSectionTextColor: text,
    pieStrokeColor: border,
    pieOuterStrokeColor: border,
    ...series,
  };
}

let _mermaidMod: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid(config: Record<string, unknown>): Promise<typeof import("mermaid").default> {
  if (!_mermaidMod) _mermaidMod = import("mermaid").then((m) => m.default);
  return _mermaidMod.then((mm) => { mm.initialize(config); return mm; });
}

// mermaid.render needs a unique DOM id per call; Math.random is unavailable in some sandboxes.
let _renderSeq = 0;

export function MermaidView({ source, className }: { source: string; className?: string }) {
  const themeTick = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const src = source.trim();
    if (!src) { setError(null); if (hostRef.current) hostRef.current.innerHTML = ""; return; }
    (async () => {
      try {
        const config = {
          startOnLoad: false,
          // strict: the source can ride in any shared document, so labels stay text and click and href callbacks stay inert.
          securityLevel: "strict",
          fontFamily: "inherit",
          theme: "base",
          themeVariables: buildThemeVariables(appThemeStore.getMode()),
        };
        const mermaid = await loadMermaid(config);
        await mermaid.parse(src);
        const { svg } = await mermaid.render(`sol-mermaid-${_renderSeq++}`, src);
        if (canceled) return;
        setError(null);
        if (hostRef.current) hostRef.current.innerHTML = svg;
      } catch (e) {
        if (canceled) return;
        setError(e instanceof Error ? e.message : "Invalid diagram");
        if (hostRef.current) hostRef.current.innerHTML = "";
      }
    })();
    return () => { canceled = true; };
  }, [source, themeTick]);

  if (error) {
    return <div className="solenoid-mermaid solenoid-mermaid--error" title={error}>Diagram error</div>;
  }
  return <div ref={hostRef} className={className ? `solenoid-mermaid nowheel ${className}` : "solenoid-mermaid nowheel"} />;
}
