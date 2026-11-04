// [[B1]] obsidianBet
import { isTreePath, treeLabel } from "./androidFolders";

export function vaultName(vaultPath: string): string {
  // An Android granted folder names the vault by its folder on the phone, not by its content:// address.
  const parts = (isTreePath(vaultPath) ? treeLabel(vaultPath) : vaultPath).replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] ?? "";
}

export function obsidianFileParam(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "");
}

export function obsidianOpenUrl(vaultPath: string, relPath: string): string | null {
  const v = vaultName(vaultPath.trim());
  const f = obsidianFileParam(relPath.trim());
  if (!v || !f) return null;
  return `obsidian://open?vault=${encodeURIComponent(v)}&file=${encodeURIComponent(f)}`;
}
