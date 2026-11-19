// [[obsidian-plugin]], [[obsidian-plugin#What's new]]
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
    version: "0.1.12",
    notes: [
      {
        title: "Solenoid Look plays nicely with TaskNotes",
        body: "",
      },
      {
        title: "Crisper rounded borders on everyday screens",
        body: "",
      },
      {
        title: "A guide for AI agents working in your vault",
        body: "",
      },
    ],
  },
  {
    version: "0.1.11",
    notes: [
      {
        title: "Updated theming",
        body: "",
      },
    ],
  },
  {
    version: "0.1.10",
    notes: [
      {
        title: "General improvements to the editor pop-ups",
        body: "",
      },
      {
        title: "Search filters on all views",
        body: "",
      },
      {
        title: "Fixes for data loss when switching property types via Obsidian",
        body: "",
      },
      {
        title: "Improved date handling",
        body: "",
      },
    ],
  },
];
