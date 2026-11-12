// [[B1]] obsidianBet, [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]]
// Where the app, reading a vault from outside Obsidian, finds Solenoid Properties' data. Its own module so the
// plugin's bundle, which asks Obsidian for the config folder, never carries a hard-coded `.obsidian`.
export const PLUGIN_DATA_PATH = ".obsidian/plugins/solenoid-properties/data.json";
