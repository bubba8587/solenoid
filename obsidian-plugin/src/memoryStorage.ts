// [[C107]] obsidianPlugin
// The app's stores keep their picks in `localStorage`. A plugin keeps its data in Obsidian's
// plugin data (`data.json`), and Obsidian's `localStorage` is one origin across every vault, so
// the build points every free `localStorage` / `sessionStorage` in app code here: memory only,
// gone with the session. What must persist (the palette) the plugin saves itself.
const cells = new Map<string, string>();

export const memoryStorage: Storage = {
  get length() { return cells.size; },
  clear: () => cells.clear(),
  getItem: (key) => cells.get(key) ?? null,
  key: (index) => [...cells.keys()][index] ?? null,
  removeItem: (key) => { cells.delete(key); },
  setItem: (key, value) => { cells.set(key, String(value)); },
};
