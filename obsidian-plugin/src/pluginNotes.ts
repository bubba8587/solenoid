// [[C107]] obsidianPlugin, [[obsidian-plugin#What's new]]
// What changed in the plugin, newest first; the What's New tab shows the entry for the manifest's version.
// Marketing copy (DESIGN.md section 7): casual is fine, em dashes and untrue claims are not.
export interface PluginNote {
  title: string;
  body: string;
}
export interface PluginNotes {
  version: string;
  notes: PluginNote[];
}

export const PLUGIN_NOTES: PluginNotes[] = [
  {
    version: "0.1.7",
    notes: [
      {
        title: "Same engine as the app",
        body: "Dates, numbers and everything you type into a cell are now read by Solenoid's Rust core, the exact one the app runs. A property and a Solenoid card always agree on what you meant.",
      },
      {
        title: "Better editor pop-ups",
        body: "They open instantly, resize smoothly on big tables, wrap long titles and column names, and fit a phone screen.",
      },
      {
        title: "Search on every view",
        body: "Grid, Cards and Form all have the same filter in the header, and Form pages through just the matches.",
      },
      {
        title: "No more data loss on a type switch",
        body: "Changing a property's type through Obsidian's dialog used to blank out nested lists and tables on Save. Now every value is kept.",
      },
      {
        title: "Better dates",
        body: "Date columns sort by day, dates before 1900 work, and a cell keeps its time of day.",
      },
      {
        title: "Cards and forms that lay themselves out",
        body: "A table's Cards and Form views arrange your columns on their own.",
      },
    ],
  },
];
