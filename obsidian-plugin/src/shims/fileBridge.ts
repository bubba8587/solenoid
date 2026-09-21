// [[C107]] obsidianPlugin
export function isDesktop(): boolean {
  return false;
}

/** Export CSV: the web build's download path; Obsidian's Electron shell shows a save dialog. */
export function saveCsvFileDialog(suggestedName: string, content: string): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  createEl("a", { href: url, attr: { download: suggestedName } }).click();
  URL.revokeObjectURL(url);
  return Promise.resolve(null);
}
