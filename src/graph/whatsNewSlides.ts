// [[A1]] visualGraphCalculator
// The What's New deck: the [slide] entries of docs/release-notes-features.md. Marketing copy, so the UI-copy sweep
// skips this file (DESIGN.md section 7).
import { compareRelease, type Release } from "./release";

export type Slide = { title: string; body: string };
export type ReleaseSlides = { version: Release; slides: Slide[] };

/** Every release's slides, newest first. A patch release (x.y.z) goes on top of its x.y; the dialog shows the newest x.y
 *  with its patches combined (`deckReleases`), so 1.6.1 opens "What's new in 1.6 and 1.6.1" and 1.7 starts a fresh deck. */
export const RELEASES: ReleaseSlides[] = [
  {
    version: "1.6.1",
    slides: [
      {
        title: "Pivot calculated fields",
        body: "Give a PIVOTBY a calculated field, like Profit / Sales, and it's worked out from each cell's own rows, not by adding up a column. See the Pivot calculated fields example.",
      },
      {
        title: "Updated theming",
        body: "The light palettes got retuned. Orchard keeps its warm ground under any accent, Dawn wakes up apricot instead of lime, and links read brighter in dark mode.",
      },
      {
        title: "GPU renderer, now on Chrome's stable API",
        body: "The HTML-in-Canvas renderer (Settings, Renderer) runs on Chrome's shipped API, no flag needed from Chrome 157. Big graphs pan and zoom on one canvas, cables, charts and all.",
      },
      {
        title: "Edit Frame",
        body: "Change cells of any table by hand, even a computed one. Every edit is kept, listed, and finds its row again when the table above it changes.",
      },
    ],
  },
  {
    version: "1.6",
    slides: [
      {
        title: "Rust port (yes, us too)",
        body: "The app's core now runs Rust via WebAssembly for much faster row operations. Try the Rust engine speed test example with a high row count.",
      },
      {
        title: "Dashboards",
        body: "Wire any number of charts, tables, numbers or documents to the new Dashboard card.",
      },
      {
        title: "Pivot view",
        body: "The PIVOTBY card now has familiar options for your reporting layouts.",
      },
      {
        title: "Pipeline",
        body: "A manual-refresh Composite card mode which lists its steps on the outer card. Useful for building Power Query-esque data transformations.",
      },
      {
        title: "New and refurbished cards",
        body: "Try out the Conditional Regions card, the new Geometry Solvers, & the comparison helper functions ABOVE/BELOW/etc.",
      },
      {
        title: "Revamped Function Reference",
        body: "The Function Reference (that book icon in the top-right of your screen) was bad before and now it's good. Check it out!",
      },
      {
        title: "Revamped Navigator",
        body: "The Navigator sidebar (open with N) now holds a traditional file tree.",
      },
      {
        title: "Mermaid → Pele",
        body: "Solenoid now uses Obsidian's Pele renderer for improved Mermaid diagrams.",
      },
    ],
  },
];

/** The releases the dialog shows: the newest and every release that shares its x.y, newest first. */
export function deckReleases(all: ReleaseSlides[] = RELEASES): ReleaseSlides[] {
  const newest = all.reduce((a, r) => (compareRelease(r.version, a.version) > 0 ? r : a));
  const [major, minor] = newest.version.split(".");
  return all
    .filter((r) => { const [a, b] = r.version.split("."); return a === major && b === minor; })
    .sort((a, b) => compareRelease(b.version, a.version));
}

/** "1.6", "1.6 and 1.6.1", "1.6, 1.6.1 and 1.6.2": oldest first. */
export function versionsLabel(versions: string[]): string {
  const v = [...versions].sort(compareRelease);
  return v.length < 2 ? (v[0] ?? "") : `${v.slice(0, -1).join(", ")} and ${v[v.length - 1]}`;
}

const shown = deckReleases();
/** The slides in order, newest release first, each with its release. */
export const SLIDES: (Slide & { version: Release })[] = shown.flatMap((r) => r.slides.map((sl) => ({ ...sl, version: r.version })));
/** The newest release with slides: the dialog shows itself once per change of it. */
export const WHATS_NEW_VERSION: Release = shown[0].version;
export const WHATS_NEW_TITLE = `What's new in ${versionsLabel(shown.map((r) => r.version))}`;
