import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { resolveColor, themeAccent } from "../palette";

// ─── Mermaid SVG renderer ─────────────────────────────────────────────────────
// Renders a mermaid.js diagram from source → SVG. mermaid is a heavy dep (pulls
// d3/dagre), so it's DYNAMICALLY imported the first time a diagram is on screen —
// keeping it off the main bundle and cold-start path. Rendering is async (mermaid
// returns a promise), so this owns the loading / error states.
//
// Used by the Mermaid node's card and by a wired Mermaid figure inline in a
// Report (inlineRefDisplay). Themed with OUR palette (not mermaid's stock
// blue/purple) via the "base" theme + themeVariables built from the app's live
// theme — so a diagram tracks light/dark, the accent, and any palette switch.

// The 12-way categorical set for pie slices / series, drawn from the palette in a
// hue-distinct order (leads with the vivid families, gray last). Resolved through
// the ACTIVE palette + mode at build time, so a palette switch re-colors series.
const SERIES_SLOTS = [
  "blue", "gold", "teal", "pink", "green", "purple",
  "sky", "vermilion", "lime", "violet", "amber", "gray",
] as const;

/** Read one CSS custom property off <html>, with a fallback if unset/SSR. */
function readVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Build mermaid themeVariables from the same CSS vars the rest of the chrome reads
// (surface/text/border/accent) plus the palette's categorical set — so the diagram
// is unmistakably Solenoid's palette. Over-specifying is safe: mermaid ignores any
// variable a given diagram type doesn't use.
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
    // Structural trio — flowchart / class / state / ER node fills, borders, text.
    primaryColor: surface,
    primaryBorderColor: accent,
    primaryTextColor: text,
    secondaryColor: sunken,
    secondaryBorderColor: border,
    secondaryTextColor: text,
    tertiaryColor: sunken,
    tertiaryBorderColor: border,
    tertiaryTextColor: text,
    // Edges + labels.
    lineColor: muted,
    textColor: text,
    // Flowchart aliases some diagram types read directly.
    mainBkg: surface,
    nodeBorder: accent,
    nodeTextColor: text,
    clusterBkg: sunken,
    clusterBorder: border,
    titleColor: text,
    edgeLabelBackground: surface,
    // Sequence actors + notes.
    actorBkg: surface,
    actorBorder: accent,
    actorTextColor: text,
    noteBkgColor: sunken,
    noteBorderColor: accent,
    noteTextColor: text,
    // Pie / categorical series.
    pieTitleTextColor: text,
    pieSectionTextColor: text,
    pieStrokeColor: border,
    pieOuterStrokeColor: border,
    ...series,
  };
}

// One mermaid module per session; re-initialized with the current config before
// every render (theme can change between renders). `securityLevel: "loose"` is
// safe here: the diagram source is authored by the app's single user, not
// untrusted input (same trust model as the report markdown they type). initialize
// is synchronous, so returning after it in the .then keeps render() ordered after
// the (re)configure — the old fire-and-forget re-init was racy.
let _mermaidMod: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid(config: Record<string, unknown>): Promise<typeof import("mermaid").default> {
  if (!_mermaidMod) _mermaidMod = import("mermaid").then((m) => m.default);
  return _mermaidMod.then((mm) => { mm.initialize(config); return mm; });
}

// A monotonic id source for mermaid.render (it needs a unique DOM id per call and
// can't use Math.random in some sandboxes). Module-level, no persistence concern.
let _renderSeq = 0;

export function MermaidView({ source, className }: { source: string; className?: string }) {
  // Re-render (and re-run the render effect) on ANY theme change — mode, accent, or
  // a palette switch all notify this store, so the diagram re-themes each time.
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
          securityLevel: "loose",
          fontFamily: "inherit",
          theme: "base",
          themeVariables: buildThemeVariables(appThemeStore.getMode()),
        };
        const mermaid = await loadMermaid(config);
        // Validate first so a syntax error surfaces as our own message rather than
        // mermaid injecting its red error graphic into the page.
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
  return <div ref={hostRef} className={className ? `solenoid-mermaid ${className}` : "solenoid-mermaid"} />;
}
