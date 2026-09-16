// Write Properties' optional `<node>.base` companion (bundle 24 item B, writeBase): a
// Bases view over the folder Write Properties wrote to, so a managed block can embed
// `![[<node>.base#View]]` and Obsidian renders a live table of what B produced. Pure YAML
// building; graph/DOM-free.

import { yamlScalar } from "./obsidianMarkdown";

/** A safe single filename segment for the `.base` file (mirrors graphStub's rule). */
export function sanitizeBaseName(name: string): string {
  const s = (name || "").replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
  return s || "Solenoid";
}

/** The `.base` file's vault-relative path, beside the notes in `folder` ("" = vault root). */
export function baseRelPath(folder: string, nodeName: string): string {
  const file = `${sanitizeBaseName(nodeName)}.base`;
  return folder ? `${folder}/${file}` : file;
}

/** A Bases view YAML: a table over `folder`, ordered by file.name then the written keys.
 *  A blank folder scopes to the whole vault (no folder filter). */
export function buildBaseView(folder: string, keys: readonly string[], viewName: string): string {
  const lines: string[] = [];
  if (folder) {
    // The folder sits inside a JS string literal in the filter expression.
    lines.push("filters:", "  and:", `    - file.inFolder("${folder.replace(/["\\]/g, "\\$&")}")`);
  }
  lines.push("views:");
  lines.push("  - type: table");
  lines.push(`    name: ${yamlScalar(viewName || "Solenoid")}`);
  lines.push("    order:");
  lines.push("      - file.name");
  for (const k of keys) lines.push(`      - ${yamlScalar(k)}`);
  return lines.join("\n") + "\n";
}
