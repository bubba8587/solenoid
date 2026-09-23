// [[C68]] knapIsTheDocumentSyntax, [[B1]] obsidianBet

import { type FrameValue, formatFrameCell, isFrameValue } from "./frame";
import { isMermaidValue, type MermaidValue } from "./mermaidValue";
import { isDocumentValue, type DocumentValue } from "./documentValue";
import { isLambdaValue, type LambdaValue } from "./lambdaValue";
import { formulaToLatex } from "./excelFormula";
import { parseNoteFrontmatter } from "./noteFrontmatter";

const INLINE_REF_RE = /`=([A-Za-z_][A-Za-z0-9_]*)(!?)`/g;

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

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

export function mermaidToMarkdown(m: MermaidValue): string {
  return "```mermaid\n" + m.source.trim() + "\n```";
}

export function mathToMarkdown(latex: string): string {
  return `$$\n${latex.trim()}\n$$`;
}

export function lambdaToMarkdown(v: LambdaValue): string {
  const expr = (v.expr ?? "").trim();
  const bodyTex = expr ? formulaToLatex(expr) : null;
  const sig = `λ(${v.params.join(", ")})`;
  const head = bodyTex
    ? mathToMarkdown(`f(${v.params.map((p) => p.replace(/[\\{}]/g, "")).join(",\\,")}) = ${bodyTex}`)
    : `\`${expr ? `${sig} = ${expr}` : sig}\``;
  const desc = v.descriptions;
  const described = desc
    ? [...v.params, ...Object.keys(desc).filter((k) => !v.params.includes(k))].filter((k) => desc[k]?.trim())
    : [];
  if (described.length === 0) return head;
  return `${head}\n\nwhere\n${described.map((k) => `- *${k}* — ${desc![k].trim()}`).join("\n")}`;
}


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
    /^[-+]?\.?\d/.test(s) ||
    /^[*&!|>%@`~']/.test(s) ||
    /^[-?](\s|$)/.test(s) ||
    /^[-+]?\.(inf|nan)$/i.test(s);
  if (!ambiguous) return s;
  const esc = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${esc}"`;
}

export function yamlKey(key: string): string {
  return key === "" || /[:#\[\]{}",'|>%@`]|^[-?!&*\s]|\s$/.test(key) ? yamlScalar(key) : key;
}

function yamlLine(key: string, v: unknown): string {
  const k = yamlKey(key);
  if (Array.isArray(v)) {
    if (v.length === 0) return `${k}: []`;
    return `${k}:\n${v.map((x) => `  - ${yamlScalar(x)}`).join("\n")}`;
  }
  return `${k}: ${yamlScalar(v)}`;
}

export function frontmatterToYaml(fm: Record<string, unknown>): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return "";
  return `---\n${keys.map((k) => yamlLine(k, fm[k])).join("\n")}\n---\n`;
}


export type ObsidianBlock =
  | { kind: "md"; md: string; plain?: true }
  | { kind: "chart"; value: unknown };

export function valueToObsidianBlock(value: unknown): ObsidianBlock {
  if (isFrameValue(value)) return { kind: "md", md: frameToMarkdownTable(value) };
  if (isMermaidValue(value)) return { kind: "md", md: mermaidToMarkdown(value) };
  if (isDocumentValue(value)) return { kind: "md", md: parseNoteFrontmatter(value.body).body };
  if (isLambdaValue(value)) return { kind: "md", md: lambdaToMarkdown(value) };
  if (typeof value === "object" && value !== null && "__chart" in (value as object)) {
    return { kind: "chart", value };
  }
  return { kind: "md", md: value === null || value === undefined ? "" : String(value), plain: true };
}


export async function assembleDocumentMarkdown(
  doc: DocumentValue,
  resolveRef: (name: string, value: unknown) => string | Promise<string>,
): Promise<string> {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(INLINE_REF_RE);
  while ((m = re.exec(doc.body))) names.add(m[1]);
  const resolved = new Map<string, string>();
  for (const name of names) {
    resolved.set(name, await resolveRef(name, doc.refs[name]));
  }
  const body = doc.body.replace(INLINE_REF_RE, (_full, name: string, flag: string) => {
    const v = resolved.get(name) ?? "";
    return flag === "!" && v !== "" && !v.includes("\n") ? `==${v}==` : v;
  });
  const front = doc.frontmatter ? frontmatterToYaml(doc.frontmatter) : "";
  return front + body;
}
