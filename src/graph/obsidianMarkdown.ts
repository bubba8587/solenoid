// The PURE half of writing a Report/Note to an Obsidian vault: markdown Obsidian renders
// NATIVELY, never HTML. The chart-render + file-write half lives with the Write node's Run
// handler, which has the DOM and the vault path.

import { type FrameValue, formatFrameCell, isFrameValue } from "./frame";
import { isMermaidValue, type MermaidValue } from "./mermaidValue";
import { isDocumentValue, type DocumentValue } from "./documentValue";

// Duplicates noteInlineRefs.ts's grammar rather than importing it, so this module stays
// dependency-light; obsidianMarkdown.test.ts machine-checks the two agree.
const INLINE_REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)(!?)`/g;

/** Escape the markdown table-breaking characters in a cell (pipe, newline). */
function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** A frame → a GitHub-flavored pipe table; cells format by column type via the shared
 *  `formatFrameCell`, a blank cell is empty, and a frame with no columns yields "". */
export function frameToMarkdownTable(frame: FrameValue): string {
  const cols = frame.columns;
  if (cols.length === 0) return "";
  const rows = cols.reduce((m, c) => Math.max(m, c.values.length), 0);
  const fmt = (colType: FrameValue["columns"][number]["type"], v: unknown): string => {
    const f = formatFrameCell(colType, v as never);
    return f === null || f === undefined ? "" : String(f);
  };
  const header = `| ${cols.map((c) => mdCell(c.name)).join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = Array.from({ length: rows }, (_, i) =>
    `| ${cols.map((c) => mdCell(fmt(c.type, c.values[i] ?? null))).join(" | ")} |`,
  );
  return [header, sep, ...body].join("\n");
}

/** A mermaid value → a fenced ```mermaid block, which Obsidian renders from the source. */
export function mermaidToMarkdown(m: MermaidValue): string {
  return "```mermaid\n" + m.source.trim() + "\n```";
}

/** A LaTeX string → a display-math block (`$$…$$`), Obsidian's native math. */
export function mathToMarkdown(latex: string): string {
  return `$$\n${latex.trim()}\n$$`;
}

// ─── Frontmatter YAML ─────────────────────────────────────────────────────────

/** A scalar → its YAML form, quoted ONLY when it would otherwise be ambiguous YAML, so
 *  clean text stays readable. A quoted value is a double-quoted flow scalar with newlines
 *  and tabs escaped, keeping a multi-line value valid on ONE line. */
export function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : `"${v}"`;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  const ambiguous =
    s === "" ||
    s !== s.trim() ||
    /[:#\[\]{}",]/.test(s) ||
    /[\n\r\t]/.test(s) ||
    /^(true|false|null|yes|no|on|off)$/i.test(s) ||
    /^-?\d/.test(s) ||
    // Leading YAML indicators: anchors/aliases/tags/block scalars/directives (*&!|>%@`),
    // a bare or space-followed -/?/~, or a leading-dot number (.5/.inf).
    /^[*&!|>%@`~]/.test(s) ||
    /^[-?](\s|$)/.test(s) ||
    /^\.\d|^\.(inf|nan)$/i.test(s);
  if (!ambiguous) return s;
  const esc = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${esc}"`;
}

/** One frontmatter key → its YAML line(s): a list becomes a block sequence, a scalar
 *  a `key: value` line. */
function yamlLine(key: string, v: unknown): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return `${key}: []`;
    return `${key}:\n${v.map((x) => `  - ${yamlScalar(x)}`).join("\n")}`;
  }
  return `${key}: ${yamlScalar(v)}`;
}

/** A record → a `---`-fenced YAML block with a trailing newline, or "" when there are no
 *  keys; insertion order is preserved. */
export function frontmatterToYaml(fm: Record<string, unknown>): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return "";
  return `---\n${keys.map((k) => yamlLine(k, fm[k])).join("\n")}\n---\n`;
}

// ─── The value-kind dispatcher ────────────────────────────────────────────────

/** A markdown BLOCK, or a deferral for a chart (which needs the DOM at write time); a plain
 *  scalar is the caller's job, since it already has the FC-formatted preview text. */
export type ObsidianBlock =
  | { kind: "md"; md: string }
  | { kind: "chart"; value: unknown }; // render to an image asset at Run time

/** Frame/mermaid/math get native markdown, a chart is deferred to the DOM-render pass, and
 *  anything else falls back to its plain string form. A DOCUMENT (a wired Note embed)
 *  inlines its markdown body. */
export function valueToObsidianBlock(value: unknown): ObsidianBlock {
  if (isFrameValue(value)) return { kind: "md", md: frameToMarkdownTable(value) };
  if (isMermaidValue(value)) return { kind: "md", md: mermaidToMarkdown(value) };
  if (isDocumentValue(value)) return { kind: "md", md: value.body };
  // Charts (recharts / hand-drawn SVG) can't be markdown — render at write time.
  if (typeof value === "object" && value !== null && "__chart" in (value as object)) {
    return { kind: "chart", value };
  }
  return { kind: "md", md: value === null || value === undefined ? "" : String(value) };
}

// Per-ref resolution is a CALLBACK so the DOM-render and file-io stay out of this module,
// which keeps it testable with a synchronous stub resolver.

/** `frontmatter + body`, with every `` `=name` `` span replaced by `resolveRef(name,
 *  value)`; the resolver may be async, and an empty result drops the span. */
export async function assembleDocumentMarkdown(
  doc: DocumentValue,
  resolveRef: (name: string, value: unknown) => string | Promise<string>,
): Promise<string> {
  // Resolve every distinct ref once (order-independent; a name repeats verbatim).
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_REF_RE);
  while ((m = re.exec(doc.body))) names.add(m[1]);
  const resolved = new Map<string, string>();
  for (const name of names) {
    resolved.set(name, await resolveRef(name, doc.refs[name]));
  }
  // The `!` flag exports as ==mark==, skipped for a block — an embed can't sit in a mark.
  const body = doc.body.replace(INLINE_REF_RE, (_full, name: string, flag: string) => {
    const v = resolved.get(name) ?? "";
    return flag === "!" && v !== "" && !v.includes("\n") ? `==${v}==` : v;
  });
  const front = doc.frontmatter ? frontmatterToYaml(doc.frontmatter) : "";
  return front + body;
}
