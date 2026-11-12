// [[obsidian-plugin#An Obsidian plugin shows Solenoid's values with the app's own chips]]
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
