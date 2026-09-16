import { useEffect } from "react";
import { watchVaultFolder } from "../vaultWatch";

/** Subscribe a card to changes under `root/folder` while mounted (desktop only; a no-op
 *  elsewhere). `onChange` gets the changed absolute paths, debounced by the watcher. */
export function useVaultWatch(root: string, folder: string, onChange: (paths: string[]) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled || !root.trim()) return;
    let live = true;
    let unwatch: (() => void) | null = null;
    void watchVaultFolder(root, folder, (paths) => { if (live) onChange(paths); }).then((un) => {
      if (live) unwatch = un; else un();
    });
    return () => { live = false; unwatch?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, folder, enabled]);
}
