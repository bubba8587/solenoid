// [[A1]] visualGraphCalculator
// The What's New deck: the [slide] entries of docs/release-notes-features.md, kept in step with
// WHATS_NEW_VERSION. Marketing copy, so the UI-copy sweep skips this file (DESIGN.md section 7).
export type Slide = { title: string; body: string };
export const SLIDES: Slide[] = [
  {
    title: "Cards",
    body: "Too many columns in your table? Try the Cards view to reshape your data into compact cards based on some intelligent rules about data type and string length.",
  },
  {
    title: "Cube Input",
    body: "You can now directly create Cubes and insert other object types into Cube cells.",
  },
  {
    title: "Solenoid Properties for Obsidian",
    body: "The plugin adds List, Matrix, Frame, Cube and Complex property types, shown as Solenoid's chips and kept as plain YAML. Turn on the Solenoid look and Obsidian takes your palette and accent.",
  },
  {
    title: "Knap notes",
    body: "Put knap: true in a note and its body renders live from its own properties. A {{ budget }} in the text shows the property's chip, and editing it edits the property.",
  },
  {
    title: "Frame Input",
    body: "Improvements to Formula columns and overall UI in the Frame Input node.",
  },
  {
    title: "XY plots",
    body: "Scatter, the new XY Line and Bubble plot real x against y, with size, color and labels from named columns.",
  },
  {
    title: "Sparklines in cells",
    body: "SPARKLINE draws a line, column or win/loss sparkline in a table cell. In a Cube, SPARKLINE(@history) gives every row its own trend.",
  },
  {
    title: "New palettes",
    body: "Try Dawn & Dusk for a relaxing vibe, or Neon to melt your eyes with blazing colors and high contrast.",
  },
];
