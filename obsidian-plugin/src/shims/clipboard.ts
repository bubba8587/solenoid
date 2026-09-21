// [[C107]] obsidianPlugin
// Obsidian is always a secure context, so the app's execCommand fallback cannot be reached.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
