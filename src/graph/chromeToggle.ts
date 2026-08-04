// Registry of collapsible canvas chrome (the navigator, the pinned-values HUD, the
// alerts HUD) so one hotkey (Tab) can expand/collapse them as a group. Each panel
// registers on mount and unregisters on unmount. Module-level singleton (no React
// context) so Canvas's keydown and the panels stay decoupled.

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
