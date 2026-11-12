// [[B14]] oneDesignSystem
// Collapsible canvas chrome, so one hotkey toggles it as a group while Canvas and the panels stay decoupled.

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
  const open = !toggles.some((t) => t.isOpen());
  for (const t of toggles) t.setOpen(open);
  return toggles.length;
}

// Menus, popups and dialogs keep Tab for moving between their own controls.
const TAB_KEEPERS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], ' +
  ".sol-popup, .sol-popup-menu, .sol-mpanel, .solenoid-menubar__top--open, .solenoid-menubar__dropdown, .solenoid-add-menu, " +
  ".solenoid-doctitle__menu, .conn-dialog";

/** Tab toggles the chrome anywhere on the main screen, focused button or card included, rather than walking its
 *  controls; a text field (filtered out by the caller), a popup, or anything outside the app shell keeps native Tab. */
export function tabTogglesChrome(target: Element | null): boolean {
  if (target == null || target === document.body || target === document.documentElement) return true;
  if (!target.closest(".solenoid-app")) return false;
  return !target.closest(TAB_KEEPERS);
}
