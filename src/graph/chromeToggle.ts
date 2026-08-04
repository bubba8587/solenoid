// Registry of collapsible canvas chrome so one hotkey toggles them as a group; a
// module singleton, so Canvas's keydown and the panels stay decoupled.

type ChromeToggle = { isOpen: () => boolean; setOpen: (open: boolean) => void };

const registry = new Map<string, ChromeToggle>();

export function registerChrome(key: string, toggle: ChromeToggle): () => void {
  registry.set(key, toggle);
  return () => { if (registry.get(key) === toggle) registry.delete(key); };
}

export function toggleChrome(key: string): void {
  const t = registry.get(key);
  if (t) t.setOpen(!t.isOpen());
}

export function toggleAllChrome(): number {
  const toggles = [...registry.values()];
  if (toggles.length === 0) return 0;
  const open = !toggles.some((t) => t.isOpen()); // any open → collapse; none open → expand
  for (const t of toggles) t.setOpen(open);
  return toggles.length;
}
