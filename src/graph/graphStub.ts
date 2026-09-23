// [[B1]] obsidianBet, [[C101]] onePatchPath
import { yamlScalar } from "./obsidianMarkdown";
import { parseNoteFrontmatter, type FrontmatterRow } from "./noteFrontmatter";

export interface StubWrite { node: string; target: string; }

export function sanitizeDocName(doc: string): string {
  const s = (doc || "").replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();
  return s || "Untitled";
}

export function stubRelPath(doc: string): string {
  return `Solenoid/${sanitizeDocName(doc)}.md`;
}

export function stubLink(doc: string, node: string): string {
  return `[[Solenoid/${sanitizeDocName(doc)}]] › ${node}`;
}

export function buildStub(doc: string, writes: readonly StubWrite[], updated: string): string {
  const fm = [
    "---",
    "type: solenoid",
    writes.length ? `nodes: [${writes.map((w) => yamlScalar(w.node)).join(", ")}]` : "nodes: []",
    "writes:",
    ...writes.flatMap((w) => [`  - node: ${yamlScalar(w.node)}`, `    target: ${yamlScalar(w.target)}`]),
    `updated: ${updated}`,
    "---",
  ].join("\n");
  const body = [
    "",
    `# ${doc}`,
    "",
    `Notes in this vault written by the **${doc}** Solenoid graph:`,
    "",
    ...writes.map((w) => `- **${w.node}** → \`${w.target}\``),
    "",
    writes.length ? `Run headless: \`run-graph "${doc}" --run "${writes[0].node}"\`` : "",
    "",
  ].join("\n");
  return `${fm}\n${body}`;
}

export function mergeStub(existing: string | null, doc: string, node: string, target: string, updated: string): string {
  const map = new Map<string, string>();
  if (existing) {
    const w = parseNoteFrontmatter(existing).fields.find((f) => f.key === "writes");
    if (w && Array.isArray(w.value)) {
      for (const row of w.value as FrontmatterRow[]) {
        if (row && typeof row.node === "string") map.set(row.node, typeof row.target === "string" ? row.target : "");
      }
    }
  }
  map.set(node, target);
  return buildStub(doc, [...map].map(([n, t]) => ({ node: n, target: t })), updated);
}
