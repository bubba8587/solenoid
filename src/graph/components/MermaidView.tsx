import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";

// ─── Mermaid SVG renderer ─────────────────────────────────────────────────────
// Renders a mermaid.js diagram from source → SVG. mermaid is a heavy dep (pulls
// d3/dagre), so it's DYNAMICALLY imported the first time a diagram is on screen —
// keeping it off the main bundle and cold-start path. Rendering is async (mermaid
// returns a promise), so this owns the loading / error states.
//
// Used by the Mermaid node's card and by a wired Mermaid figure inline in a
// Report (inlineRefDisplay). Theme-aware — re-renders with mermaid's dark/default
// theme when the app theme flips.

// One mermaid module + one initialize per session. `securityLevel: "loose"` is
// safe here: the diagram source is authored by the app's single user, not
// untrusted input (same trust model as the report markdown they type).
let _mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid(theme: "dark" | "default") {
  if (!_mermaidPromise) {
    _mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({ startOnLoad: false, theme, securityLevel: "loose", fontFamily: "inherit" });
      return m.default;
    });
  } else {
    // Theme can change between renders — re-initialize the singleton before use.
    void _mermaidPromise.then((mm) => mm.initialize({ startOnLoad: false, theme, securityLevel: "loose", fontFamily: "inherit" }));
  }
  return _mermaidPromise;
}

// A monotonic id source for mermaid.render (it needs a unique DOM id per call and
// can't use Math.random in some sandboxes). Module-level, no persistence concern.
let _renderSeq = 0;

export function MermaidView({ source, className }: { source: string; className?: string }) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const theme = appThemeStore.getMode() === "light" ? "default" : "dark";
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const src = source.trim();
    if (!src) { setError(null); if (hostRef.current) hostRef.current.innerHTML = ""; return; }
    (async () => {
      try {
        const mermaid = await loadMermaid(theme);
        // Validate first so a syntax error surfaces as our own message rather than
        // mermaid injecting its red error graphic into the page.
        await mermaid.parse(src);
        const { svg } = await mermaid.render(`sol-mermaid-${_renderSeq++}`, src);
        if (cancelled) return;
        setError(null);
        if (hostRef.current) hostRef.current.innerHTML = svg;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Invalid diagram");
        if (hostRef.current) hostRef.current.innerHTML = "";
      }
    })();
    return () => { cancelled = true; };
  }, [source, theme]);

  if (error) {
    return <div className="solenoid-mermaid solenoid-mermaid--error" title={error}>Diagram error</div>;
  }
  return <div ref={hostRef} className={className ? `solenoid-mermaid ${className}` : "solenoid-mermaid"} />;
}
