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
    ],
  },
];
