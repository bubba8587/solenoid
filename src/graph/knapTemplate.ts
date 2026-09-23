// [[C68]]

import { createEngine, parse, standardFilters, type ASTNode, type Expression, type TemplateError } from "knap";
import { type FrameValue, type CubeValue, type CubeCell, type FrameColType, isFrameValue, isCubeValue, frameRowCount } from "./frame";
import { isDocumentValue } from "./documentValue";
import { isMermaidValue } from "./mermaidValue";
import { isLambdaValue } from "./lambdaValue";
import { isUnitCell } from "./unitValue";
import { displayMagnitudeOf } from "./unitBridge";
import { isSolError } from "./errorValue";
import { formatDateSerial } from "./nodes/dateSerial";
import { mermaidToMarkdown, lambdaToMarkdown } from "./obsidianMarkdown";
import { isDateType, type SocketDataType } from "./sockets";

const TAG_RE = /\{\{|\{%|\{#/;

export function hasKnapSyntax(body: string): boolean {
  return TAG_RE.test(body);
}

function rootOf(e: Expression & { type: "identifier" }): string {
  return e.path?.[0] ?? e.name.split(".")[0];
}

function walkExpr(e: Expression, hit: (name: string, line: number, column: number) => void): void {
  switch (e.type) {
    case "identifier": hit(rootOf(e), e.line, e.column); return;
    case "literal": return;
    case "binary": walkExpr(e.left, hit); walkExpr(e.right, hit); return;
    case "unary": walkExpr(e.argument, hit); return;
    case "filter": walkExpr(e.value, hit); for (const a of e.args) walkExpr(a, hit); return;
    case "group": walkExpr(e.expression, hit); return;
    case "member": walkExpr(e.object, hit); if (e.computed) walkExpr(e.property, hit); return;
  }
}

function walkNodes(nodes: ASTNode[], locals: Set<string>, hit: (name: string, line: number, column: number) => void): void {
  for (const n of nodes) {
    switch (n.type) {
      case "text": break;
      case "variable": walkExpr(n.expression, hit); break;
      case "if":
        walkExpr(n.condition, hit);
        walkNodes(n.consequent, locals, hit);
        for (const b of n.elseifs) { walkExpr(b.condition, hit); walkNodes(b.body, locals, hit); }
        if (n.alternate) walkNodes(n.alternate, locals, hit);
        break;
      case "for": {
        walkExpr(n.iterable, hit);
        const inner = new Set(locals);
        inner.add(n.iterator);
        inner.add("loop");
        walkNodes(n.body, inner, (name, l, c) => { if (!inner.has(name)) hit(name, l, c); });
        break;
      }
      case "set":
        walkExpr(n.value, hit);
        locals.add(n.variable);
        break;
    }
  }
}

export function extractKnapVariables(body: string): string[] {
  if (!hasKnapSyntax(body)) return [];
  const { ast } = parse(body);
  const first = new Map<string, number>();
  const lineStart: number[] = [0];
  for (let i = 0; i < body.length; i++) if (body[i] === "\n") lineStart.push(i + 1);
  const offset = (line: number, column: number) => (lineStart[line - 1] ?? 0) + column;
  const locals = new Set<string>();
  walkNodes(ast, locals, (name, line, column) => {
    if (locals.has(name)) return;
    const at = offset(line, column);
    const prev = first.get(name);
    if (prev === undefined || at < prev) first.set(name, at);
  });
  for (const l of locals) first.delete(l);
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

export function embedBareVariables(body: string, inputs: readonly string[]): string {
  if (inputs.length === 0 || !body.includes("{{")) return body;
  const wired = new Set(inputs);
  const shadow: string[] = [];
  const setNames = new Set<string>();
  return body.replace(/\{#[\s\S]*?#\}|\{%\s*([\s\S]*?)\s*%\}|\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\|\s*highlight\s*)?\}\}/g, (tag, block?: string, name?: string, hl?: string) => {
    if (block !== undefined) {
      const forM = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/.exec(block);
      if (forM) shadow.push(forM[1]);
      else if (/^endfor\b/.test(block)) shadow.pop();
      else { const setM = /^set\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(block); if (setM) setNames.add(setM[1]); }
      return tag;
    }
    if (!name || !wired.has(name) || shadow.includes(name) || setNames.has(name)) return tag;
    return `\`=${name}${hl ? "!" : ""}\``;
  });
}

function templateLocals(body: string): Set<string> {
  const out = new Set<string>();
  const { ast } = parse(body);
  const visit = (nodes: ASTNode[]) => {
    for (const n of nodes) {
      switch (n.type) {
        case "if": visit(n.consequent); for (const b of n.elseifs) visit(b.body); if (n.alternate) visit(n.alternate); break;
        case "for": out.add(n.iterator); out.add("loop"); visit(n.body); break;
        case "set": out.add(n.variable); break;
        default: break;
      }
    }
  };
  visit(ast);
  return out;
}


function serialToIso(serial: number): string {
  const whole = Number.isInteger(serial);
  return formatDateSerial(serial, whole ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
}

function cellValue(v: unknown, type?: FrameColType): unknown {
  if (isSolError(v)) return v.code;
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) return serialToIso(v);
  return v ?? null;
}

export function frameToTemplateRows(f: FrameValue): Record<string, unknown>[] {
  const n = frameRowCount(f);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const c of f.columns) r[c.name] = cellValue(c.values[i], c.type);
    rows.push(r);
  }
  return rows;
}

function cubeCell(cell: CubeCell, type?: FrameColType): unknown {
  if (cell == null) return null;
  if (isCubeValue(cell)) return cubeToTemplateRows(cell);
  if (isFrameValue(cell)) return frameToTemplateRows(cell);
  if (isUnitCell(cell)) return displayMagnitudeOf(cell);
  if (Array.isArray(cell)) return cell.map((c) => cubeCell(c));
  return cellValue(cell, type);
}

export function cubeToTemplateRows(c: CubeValue): Record<string, unknown>[] {
  const n = c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const r: Record<string, unknown> = {};
    for (const col of c.columns) r[col.name] = cubeCell(col.cells[i] ?? null, col.type);
    rows.push(r);
  }
  return rows;
}

export function toTemplateValue(v: unknown, type?: SocketDataType | null): unknown {
  if (v === undefined || v === null) return null;
  if (isSolError(v)) return v.code;
  if (isFrameValue(v)) return frameToTemplateRows(v);
  if (isCubeValue(v)) return cubeToTemplateRows(v);
  if (isDocumentValue(v)) return v.body;
  if (isMermaidValue(v)) return mermaidToMarkdown(v);
  if (isLambdaValue(v)) return lambdaToMarkdown(v);
  if (isUnitCell(v)) return displayMagnitudeOf(v);
  if (Array.isArray(v)) {
    const date = !!type && isDateType(type);
    return v.map((x) => toTemplateValue(x, date ? "date" : null));
  }
  if (typeof v === "number") return type && isDateType(type) && Number.isFinite(v) ? serialToIso(v) : v;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "object" && ("__chart" in v || "__svg" in v || "__image" in v)) return null;
  return v;
}


const engine = createEngine({ filters: standardFilters });

export interface KnapRender {
  output: string;
  errors: TemplateError[];
}

const HOLD = "\u0001";
const HOLD_RE = /\u0001(\d+)\u0001/g;

/** The tag's first variable read, by position; an operator (`not`) or a literal (`true`) is not one. */
function leadingRoot(tag: string): string | undefined {
  const { ast } = parse(tag);
  const node = ast.length === 1 ? ast[0] : undefined;
  if (node?.type !== "variable") return /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(tag)?.[1];
  let lead: { name: string; line: number; column: number } | undefined;
  walkExpr(node.expression, (name, line, column) => {
    if (!lead || line < lead.line || (line === lead.line && column < lead.column)) lead = { name, line, column };
  });
  return lead?.name;
}

function holdUnknownTags(body: string, known: ReadonlySet<string>): { src: string; held: string[] } {
  const held: string[] = [];
  const src = body.replace(/\{\{[\s\S]*?\}\}/g, (tag) => {
    const root = leadingRoot(tag);
    if (!root || known.has(root)) return tag;
    return `${HOLD}${held.push(tag) - 1}${HOLD}`;
  });
  return { src, held };
}

export async function renderKnap(body: string, variables: Record<string, unknown>, opts?: { keepUnknown?: boolean }): Promise<KnapRender> {
  if (!hasKnapSyntax(body)) return { output: body, errors: [] };
  if (!opts?.keepUnknown) {
    const r = await engine.render(body, { variables });
    return { output: r.output, errors: r.errors };
  }
  const { src, held } = holdUnknownTags(body, new Set([...Object.keys(variables), ...templateLocals(body)]));
  const r = await engine.render(src, { variables });
  return { output: r.output.replace(HOLD_RE, (_m, i: string) => held[Number(i)] ?? ""), errors: r.errors };
}

export interface KnapPage { name: string; body: string }

export const MAX_PAGES = 500;

export function batchTruncation(total: number): { truncated: boolean; shown: number; total: number } {
  const truncated = total > MAX_PAGES;
  return { truncated, shown: truncated ? MAX_PAGES : total, total };
}

export async function renderKnapPages(
  body: string, variables: Record<string, unknown>, records: Record<string, unknown>[], nameTemplate: string,
): Promise<{ pages: KnapPage[]; errors: TemplateError[]; total: number }> {
  const pages: KnapPage[] = [];
  const total = records.length;
  const taken = new Set<string>();
  const uniq = (n: string) => { let k = n, i = 2; while (taken.has(k.toLowerCase())) k = `${n} (${i++})`; taken.add(k.toLowerCase()); return k; };
  for (let i = 0; i < Math.min(total, MAX_PAGES); i++) {
    const vars = { ...variables, record: records[i], index: i + 1 };
    const r = await renderKnap(body, vars);
    if (r.errors.length) return { pages, errors: r.errors, total };
    const n = await renderKnap(nameTemplate, vars);
    if (n.errors.length) return { pages, errors: n.errors, total };
    pages.push({ name: uniq(n.output.trim() || String(i + 1)), body: r.output });
  }
  return { pages, errors: [], total };
}

export function knapErrorText(errors: TemplateError[]): string {
  return errors.map((e) => `${e.line}:${e.column} ${e.message}`).join("\n");
}
