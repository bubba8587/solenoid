// [[C107]] obsidianPlugin
export function isDesktop(): boolean {
  return false;
}

/** Export CSV: the web build's download path; Obsidian's Electron shell shows a save dialog. */
export function saveCsvFileDialog(suggestedName: string, content: string): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return Promise.resolve(null);
}
