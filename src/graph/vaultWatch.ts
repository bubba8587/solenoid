// Vault change watcher (Obsidian bundle E): a desktop-only, debounced watch on a vault
// folder so a Vault Folder card re-reads and an Import Note reloads when Obsidian saves.
// Off desktop it does nothing; the refresh cadence (`refreshMinutes`) stays the stopgap.

import { isDesktop, joinPath } from "./fileBridge";

export type Unwatch = () => void;

/** Watch `root/folder` (recursively; "" = the vault root). `onChange` receives the
 *  changed absolute paths, at most once per `delayMs`. Resolves to the unwatch. */
export async function watchVaultFolder(
  root: string,
  folder: string,
  onChange: (paths: string[]) => void,
  delayMs = 1000,
): Promise<Unwatch> {
  if (!isDesktop() || !root.trim()) return () => {};
  const rel = folder.trim().replace(/^\/+|\/+$/g, "");
  const abs = rel ? await joinPath(root, ...rel.split("/")) : root;
  try {
    // Dynamic import so the browser bundle never pulls the Tauri plugin.
    const { watch } = await import("@tauri-apps/plugin-fs");
    const un = await watch(abs, (ev) => { if (ev.paths.length) onChange(ev.paths); }, { recursive: true, delayMs });
    return () => { void un(); };
  } catch {
    return () => {};
  }
}

/** True when a change list touches `root/relPath` (slashes normalized). */
export function touches(paths: readonly string[], root: string, relPath: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const target = norm(`${root.replace(/[\\/]+$/, "")}/${relPath}`);
  return paths.some((p) => norm(p) === target);
}
