// [[B1]] obsidianBet, [[C67]] mdbaseCeiling (the one sanctioned `.base` writer)
// Write Properties' optional `<node>.base` companion: a Bases view over the folder it wrote to. Pure YAML.

import { yamlScalar } from "./obsidianMarkdown";

export function sanitizeBaseName(name: string): string {
  const s = (name || "").replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
  return s || "Solenoid";
}

export function baseRelPath(folder: string, nodeName: string): string {
  const file = `${sanitizeBaseName(nodeName)}.base`;
  return folder ? `${folder}/${file}` : file;
}

/** A blank folder scopes to the whole vault. */
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
