// [[B1]] obsidianBet

export function vaultName(vaultPath: string): string {
  const parts = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
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
