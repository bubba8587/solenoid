// [[D87]] knapNotes
import { embedBareVariables, hasKnapSyntax, renderKnap } from "../../src/graph/knapTemplate";
import { guessScalarText } from "../../src/graph/scalarText";

export const KNAP_PROPERTY = "knap";

/** The internal span a bare tag on an object property becomes (`=name`, or `=name!` when highlighted). */
export const SPAN_RE = /^=([A-Za-z_][A-Za-z0-9_]*)!?$/;

export function isKnapNote(frontmatter: unknown): frontmatter is Record<string, unknown> {
  return !!frontmatter && typeof frontmatter === "object" && (frontmatter as Record<string, unknown>)[KNAP_PROPERTY] === true;
}

/** The first line after the frontmatter block, or 0 when the note has none. */
export function bodyStartLine(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].trim() === "---") return i + 1;
  return 0;
}

const MARK = "\u0002";
const MARK_RE = new RegExp(`${MARK}(\\d+)${MARK}`);
const CLOSE: Record<string, string> = { "{{": "}}", "{%": "%}", "{#": "#}" };

/** The tag still open at the end of `line`, by its closing delimiter. */
function openTagAfter(line: string, open: string | null): string | null {
  let i = 0;
  while (i < line.length) {
    if (open) {
      const j = line.indexOf(open, i);
      if (j < 0) return open;
      i = j + 2;
      open = null;
    } else {
      const m = /\{[{%#]/.exec(line.slice(i));
      if (!m) return null;
      open = CLOSE[m[0]];
      i += m.index + 2;
    }
  }
  return open;
}

const markOf = (line: number) => `${MARK}${line}${MARK}`;

/** Lines `from` on, each that starts outside a tag led by its own line number. */
function markLines(lines: readonly string[], from: number): { text: string; marked: Set<number> } {
  let open: string | null = null;
  let text = "";
  const marked = new Set<number>();
  for (let i = from; i < lines.length; i++) {
    if (open === null) { text += markOf(i); marked.add(i); }
    text += lines[i] + (i < lines.length - 1 ? "\n" : "");
    open = openTagAfter(lines[i], open);
  }
  return { text, marked };
}

export interface KnapNoteRender {
  bodyStart: number;
  /** What lines `lineStart`..`lineEnd` render to, in output order: a loop repeats them, a false `if` drops them. */
  slice(lineStart: number, lineEnd: number): string;
  /** The source of those lines, as the note holds them. */
  source(lineStart: number, lineEnd: number): string;
  /** `line:column message` lines, counted in the note, "" when the render succeeded. */
  error: string;
  /** The note's first body line that is not blank, where the error shows; -1 when none. */
  errorLine: number;
}

/**
 * Renders a note's whole body once, with each source line marked, so every section Obsidian
 * draws on its own can take its share of the output and a block may span sections. `chips` are
 * the names whose bare tag becomes the internal `=name` span.
 */
export async function renderKnapNote(text: string, variables: Record<string, unknown>, chips: readonly string[]): Promise<KnapNoteRender> {
  const lines = text.split("\n");
  const bodyStart = bodyStartLine(lines);
  const source = (a: number, b: number) => lines.slice(a, b + 1).join("\n");
  const { text: marked, marked: markedLines } = markLines(lines, bodyStart);
  const r = await renderKnap(embedBareVariables(marked, chips), variables, { keepUnknown: true });
  if (r.errors.length) {
    const error = r.errors.map((e) => {
      const line = bodyStart + e.line - 1;
      const column = markedLines.has(line) ? Math.max(1, e.column - markOf(line).length) : e.column;
      return `${line + 1}:${column} ${e.message}`;
    }).join("\n");
    let errorLine = bodyStart;
    while (errorLine < lines.length - 1 && !lines[errorLine].trim()) errorLine++;
    return { bodyStart, slice: source, source, error, errorLine };
  }
  const parts = r.output.split(MARK_RE);
  const seq: [number, string][] = [];
  for (let i = 1; i < parts.length; i += 2) seq.push([Number(parts[i]), parts[i + 1]]);
  const slice = (a: number, b: number) => {
    let s = "";
    for (const [n, t] of seq) if (n >= a && n <= b) s += t;
    return s.replace(/\n+$/, "");
  };
  return { bodyStart, slice, source, error: "", errorLine: -1 };
}

/** A note's properties as its template reads them; a quoted Knap field reads as what it renders to, as in a Note. */
export async function knapVariables(frontmatter: Record<string, unknown>): Promise<Record<string, unknown>> {
  const vars: Record<string, unknown> = { ...frontmatter };
  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value !== "string" || !hasKnapSyntax(value)) continue;
    const r = await renderKnap(value, frontmatter, { keepUnknown: true });
    if (r.errors.length) continue;
    const guess = guessScalarText(r.output);
    vars[key] = guess.kind === "date" ? r.output.trim() : guess.value;
  }
  return vars;
}

export interface KnapUnit { from: number; to: number; output: string }

/** The body's top-level template pieces, by offset: each tag outside a block, and each `if` or `for` block whole. */
export function knapUnits(body: string): { from: number; to: number }[] {
  const units: { from: number; to: number }[] = [];
  let depth = 0;
  let start = 0;
  for (const m of body.matchAll(/\{#[\s\S]*?#\}|\{%\s*([A-Za-z]*)[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g)) {
    const from = m.index;
    const to = from + m[0].length;
    const word = m[1];
    if (word === "if" || word === "for") {
      if (depth++ === 0) start = from;
    } else if (word === "endif" || word === "endfor") {
      if (depth > 0 && --depth === 0) units.push({ from: start, to });
    } else if (depth === 0) {
      units.push({ from, to });
    }
  }
  return units;
}

const UNIT_OPEN = "\u0003";
const UNIT_CLOSE = "\u0004";
const UNIT_RE = new RegExp(`${UNIT_OPEN}(\\d+)${UNIT_OPEN}([^${UNIT_CLOSE}]*)${UNIT_CLOSE}`, "g");

/**
 * Renders a body once with each top-level piece fenced, so each piece gets its own output with
 * the whole note in scope (a `set` above it, a loop around nothing). `failed` when Knap refused
 * the body; then there are no units.
 */
export async function renderKnapUnits(body: string, variables: Record<string, unknown>, chips: readonly string[]): Promise<{ units: KnapUnit[]; failed: boolean }> {
  const spans = knapUnits(body);
  if (spans.length === 0) return { units: [], failed: false };
  let text = "";
  let at = 0;
  spans.forEach((s, i) => {
    text += `${body.slice(at, s.from)}${UNIT_OPEN}${i}${UNIT_OPEN}${body.slice(s.from, s.to)}${UNIT_CLOSE}`;
    at = s.to;
  });
  const r = await renderKnap(embedBareVariables(text + body.slice(at), chips), variables, { keepUnknown: true });
  if (r.errors.length) return { units: [], failed: true };
  const out = new Map<number, string>();
  for (const m of r.output.matchAll(UNIT_RE)) out.set(Number(m[1]), m[2]);
  return { units: spans.flatMap((s, i) => (out.has(i) ? [{ ...s, output: out.get(i)! }] : [])), failed: false };
}
