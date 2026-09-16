// Obsidian URI links (bundle item D): `obsidian://open?vault=<vault name>&file=<path>` opens
// a note in the running Obsidian. The vault name is the vault folder's base name; the file
// is vault-relative, forward slashes, no `.md`. Pure; `openExternal` (fileBridge) launches it.

/** The vault's name as Obsidian knows it: the folder's base name. */
export function vaultName(vaultPath: string): string {
  const parts = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? "";
}

/** A vault-relative path → the `file` parameter: forward slashes, no leading slash, no `.md`. */
export function obsidianFileParam(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
}

/** The URI that opens `relPath` in the vault at `vaultPath`; null when either is blank. */
export function obsidianOpenUrl(vaultPath: string, relPath: string): string | null {
  const v = vaultName(vaultPath.trim());
  const f = obsidianFileParam(relPath.trim());
  if (!v || !f) return null;
  return `obsidian://open?vault=${encodeURIComponent(v)}&file=${encodeURIComponent(f)}`;
}
