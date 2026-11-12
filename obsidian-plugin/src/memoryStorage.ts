// [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]]
const cells = new Map<string, string>();

export const memoryStorage: Storage = {
  get length() { return cells.size; },
  clear: () => cells.clear(),
  getItem: (key) => cells.get(key) ?? null,
  key: (index) => [...cells.keys()][index] ?? null,
  removeItem: (key) => { cells.delete(key); },
  setItem: (key, value) => { cells.set(key, String(value)); },
};
