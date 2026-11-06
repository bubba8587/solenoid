// [[A1]] visualGraphCalculator
// The What's New deck: the [slide] entries of docs/release-notes-features.md, kept in step with
// WHATS_NEW_VERSION. Marketing copy, so the UI-copy sweep skips this file (DESIGN.md section 7).
export type Slide = { title: string; body: string };
export const SLIDES: Slide[] = [
  {
    title: "We rewrote it in Rust",
    body: "Yes, us too. The difference is we have numbers: a million rows through a filter, a group, a join and a sort in 160 ms. A RANK or SUMIFS column over 20,000 rows used to take long enough to make coffee. Now it's milliseconds.",
  },
  {
    title: "Dashboards",
    body: "Wire your charts, numbers and tables into a Dashboard card and open it full screen. Drag things around, color-code them, refresh live data, and check it on your phone like a stock ticker. The Dashboard showcase example has one ready to poke at.",
  },
  {
    title: "Pivot tables, the real kind",
    body: "PIVOTBY opens on an honest-to-god pivot table: Compact, Outline or Tabular, subtotals that fold, a number format per field, and the rows behind any number one click away.",
  },
  {
    title: "Coming from Excel?",
    body: "The Function Reference's Excel Coverage tab lists Excel's functions under Excel's own headings, each with the card that does it. 326 give Excel's exact answers, down to 0.1 + 0.2 = 0.3, and the rest tell you how they differ.",
  },
  {
    title: "A date is a date",
    body: "Dates stay dates through every formula, lookup, sort and pivot. A date plus 7 is next week, two dates subtracted are the days between, and you'll never squint at 45000 again wondering what it used to be.",
  },
  {
    title: "All your files, one search",
    body: "Folders for your documents, drag and drop, and a globe search in the Navigator that looks through everything at once and drops you on the exact card.",
  },
  {
    title: "Units that do the math",
    body: "Divide a km column by an hr column and you get km/h, no conversion factor scribbled on a sticky note. A payment on a dollar loan comes back in dollars.",
  },
  {
    title: "32 kinds of diagram",
    body: "The Mermaid card has a starter for every diagram it draws: Sankey, Venn, Kanban, Treemap, even Wardley maps for the strategy people. All in your theme, no Visio required.",
  },
];
