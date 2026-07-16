// ─── Obsidian-flavored markdown serialization ────────────────────────────────
// The PURE half of writing a Solenoid Report/Note to an Obsidian vault: turn the
// document's parts into portable markdown that Obsidian renders NATIVELY — no HTML
// unless a construct genuinely can't be expressed in markdown (none of ours can):
//   • frontmatter  → a `---`-fenced YAML block
//   • frame/table  → a GitHub-flavored pipe table (Obsidian renders these)
//   • mermaid      → a ```mermaid fenced block (Obsidian renders from the source)
//   • lambda/math  → `$$…$$` (Obsidian math)
//   • image        → `![[asset]]` (handled at write time — see the Run-time half)
//   • chart        → a rendered image asset (DOM render, so it's the Run-time half)
// This module is pure + unit-tested; the chart-render + file-write half lives with
// the Write node's Run handler (it needs the DOM + the vault path).

import { type FrameValue, formatFrameCell, isFrameValue } from "./frame";
import { isMermaidValue, type MermaidValue } from "./mermaidValue";
import { type DocumentValue } from "./documentValue";

// Matches a `` `=name` `` inline-ref code span — the same grammar noteInlineRefs.ts
// mints input sockets from. Duplicated (not imported) so this module stays a pure,
// dependency-light serializer; the identifier grammar is fixed and machine-checked
// against noteInlineRefs in obsidianMarkdown.test.ts.
const INLINE_REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)`/g;

/** Escape the markdown table-breaking characters in a cell (pipe, newline). */
function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** A frame → a GitHub-flavored markdown pipe table (header row, `---` separator,
 *  one row per record). Cells format by column type (dates as dates, etc.) via the
 *  shared `formatFrameCell`; a null/blank cell is an empty cell. An empty frame (no
 *  columns) yields "". */
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

/** A mermaid value → a fenced ```mermaid block. Obsidian renders the diagram from
 *  the source directly, so this is the ideal (editable, themeable) embed — no image. */
export function mermaidToMarkdown(m: MermaidValue): string {
  return "```mermaid\n" + m.source.trim() + "\n```";
}

/** A LaTeX string → a display-math block (`$$…$$`), Obsidian's native math. */
export function mathToMarkdown(latex: string): string {
  return `$$\n${latex.trim()}\n$$`;
}

// ─── Frontmatter YAML ─────────────────────────────────────────────────────────

/** A single scalar → its YAML form. Numbers/booleans emit bare; a string is quoted
 *  ONLY when it would otherwise be ambiguous YAML (has a leading/trailing space, a
 *  `:`/`#`, an embedded newline/tab, looks like a number/bool, or is empty) — so
 *  clean text stays unquoted and readable. A quoted value uses a double-quoted flow
 *  scalar with `\`, `"`, and newlines/tabs escaped, so a multi-line frontmatter
 *  value stays valid YAML on ONE line (a raw newline would splice the block). */
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
    // Leading YAML indicators: anchors/aliases/tags/block scalars/directives
    // (*&!|>%@`), a bare or space-followed -/?/~, or a leading-dot number (.5/.inf).
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

/** A record → a `---`-fenced YAML frontmatter block (with a trailing newline), or ""
 *  when there are no keys. Insertion order is preserved. */
export function frontmatterToYaml(fm: Record<string, unknown>): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return "";
  return `---\n${keys.map((k) => yamlLine(k, fm[k])).join("\n")}\n---\n`;
}

// ─── The value-kind dispatcher ────────────────────────────────────────────────

/** A resolved embed value serialized to a markdown BLOCK, OR a deferral for a chart
 *  (which must be rendered to an image at write time — it needs the DOM). The caller
 *  substitutes `md` inline, or resolves `chart` at Run. A plain scalar/string is the
 *  caller's job (it already has the FC-formatted preview text). */
export type ObsidianBlock =
  | { kind: "md"; md: string }
  | { kind: "chart"; value: unknown }; // render to an image asset at Run time

/** Serialize a resolved embed value to an Obsidian markdown block by its KIND. A
 *  frame/mermaid/math value gets native markdown; a chart is deferred to the
 *  DOM-render pass; anything else falls back to its plain string form. */
export function valueToObsidianBlock(value: unknown): ObsidianBlock {
  if (isFrameValue(value)) return { kind: "md", md: frameToMarkdownTable(value) };
  if (isMermaidValue(value)) return { kind: "md", md: mermaidToMarkdown(value) };
  // Charts (recharts / hand-drawn SVG) can't be markdown — render at write time.
  if (typeof value === "object" && value !== null && "__chart" in (value as object)) {
    return { kind: "chart", value };
  }
  return { kind: "md", md: value === null || value === undefined ? "" : String(value) };
}

// ─── Document assembly (the walk) ─────────────────────────────────────────────
// The pure half of writing a DocumentValue out: prepend the frontmatter block and
// substitute every `` `=name` `` inline ref with a resolved markdown string. The
// per-ref resolution is a CALLBACK — the Write node passes one that serializes each
// value via valueToObsidianBlock and, for a chart/image, writes an image asset to
// the vault and returns the `![[asset]]` embed. That keeps the DOM-render + file-io
// out of this module (it stays testable with a synchronous stub resolver). A
// `![[Note]]` embed is left INTACT — it's already native Obsidian transclusion.

/** Assemble a document's final Obsidian markdown: `frontmatter + body`, with each
 *  `` `=name` `` span replaced by `resolveRef(name, value)` (all occurrences). The
 *  resolver may be async (a chart write). A ref with no resolver result ("") drops
 *  the span. */
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
  const body = doc.body.replace(INLINE_REF_RE, (_full, name: string) => resolved.get(name) ?? "");
  const front = doc.frontmatter ? frontmatterToYaml(doc.frontmatter) : "";
  return front + body;
}
