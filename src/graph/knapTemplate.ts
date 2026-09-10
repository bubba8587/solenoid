// Knap (knap.md, Obsidian's template language) inside a document body: `{{ name }}`,
// `{% if %}`, `{% for %}` and the standard filter set, rendered at compute time. A
// Report's variables are its wired inputs (each root name mints a `trueany` input,
// like a `` `=name` `` ref); a Note's are its own frontmatter fields. The `` `=name` ``
// ref span is NOT template syntax: it survives the render as text and resolves later
// by kind (a chart rasterizes at write time, a frame draws as a grid), so rich values
// keep the ref path and Knap covers text and data. Graph/DOM-free.

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

const TAG_RE = /\{\{|\{%/;

/** True when the body carries a Knap tag at all: a plain body skips the (async)
 *  render entirely, so a Note or Report without templating stays synchronous. */
export function hasKnapSyntax(body: string): boolean {
  return TAG_RE.test(body);
}

/** The name Knap resolves an identifier against: `author.name` reads `author`. */
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

/** Ordered, de-duplicated ROOT variable names a template reads from its host, in
 *  first-use order: `for` iterators, `loop` and `set` names are the template's own.
 *  A body with a syntax error still yields what parsed, so sockets don't vanish
 *  mid-edit. */
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

// ─── Solenoid value → template value ─────────────────────────────────────────

/** A date serial → ISO text, the form Knap's `date` filter parses; a serial with a
 *  time part keeps it. Not the FC's display format: the template picks one. */
function serialToIso(serial: number): string {
  const whole = Number.isInteger(serial);
  return formatDateSerial(serial, whole ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
}

function cellValue(v: unknown, type?: FrameColType): unknown {
  if (isSolError(v)) return v.code;
  if (type === "date" && typeof v === "number" && Number.isFinite(v)) return serialToIso(v);
  return v ?? null;
}

/** Rows of `{column: value}`, the shape `{% for row in frame %}` and the `table`
 *  filter read; date columns arrive as ISO text. */
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

/** A cube as rows whose cells may nest rows or lists. */
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

/** A wired value as the plain data a template reads. `type` is the SOURCE socket's
 *  data type when known: it is the only way to tell a date serial from a number. A
 *  chart, picture or SVG has no text form and reads as null (embed it with a ref). */
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

// ─── Render ──────────────────────────────────────────────────────────────────

const engine = createEngine({ filters: standardFilters });

export interface KnapRender {
  output: string;
  /** Parse or runtime errors; the output is "" when any is present. */
  errors: TemplateError[];
}

/** Render a body against its variables. Never throws: a broken template reports
 *  through `errors`, with the line and column the editor can show. */
export async function renderKnap(body: string, variables: Record<string, unknown>): Promise<KnapRender> {
  if (!hasKnapSyntax(body)) return { output: body, errors: [] };
  const r = await engine.render(body, { variables });
  return { output: r.output, errors: r.errors };
}

/** One line per error, `line:column message`, for an error value or the preview. */
export function knapErrorText(errors: TemplateError[]): string {
  return errors.map((e) => `${e.line}:${e.column} ${e.message}`).join("\n");
}
