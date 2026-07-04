// Registry of collapsible canvas chrome (the navigator, the pinned-values HUD, the
// alerts HUD) so one hotkey (Tab) can expand/collapse them as a group. Each panel
// registers an open-state getter + setter on mount and unregisters on unmount;
// `toggleAllChrome` reads the group and flips it. Module-level singleton — the
// panels live in the main React tree, but so does Canvas's keydown, so a plain
// registry (no React context) keeps them decoupled.

type ChromeToggle = { isOpen: () => boolean; setOpen: (open: boolean) => void };

const registry = new Map<string, ChromeToggle>();

export function registerChrome(key: string, toggle: ChromeToggle): () => void {
  registry.set(key, toggle);
  return () => { if (registry.get(key) === toggle) registry.delete(key); };
}

/**
 * Expand/collapse all registered chrome as a group: if ANY panel is open, collapse
 * them all; otherwise expand them all. Returns how many panels were toggled (0 when
 * nothing is registered, so the caller can leave the key alone).
 */
/** Toggle a single registered panel by key (no-op if it isn't registered). */
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
