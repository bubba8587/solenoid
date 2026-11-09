// [[A1]] visualGraphCalculator
// The What's New deck: the [slide] entries of docs/release-notes-features.md, kept in step with
// WHATS_NEW_VERSION. Marketing copy, so the UI-copy sweep skips this file (DESIGN.md section 7).
export type Slide = { title: string; body: string };
export const SLIDES: Slide[] = [
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
];
