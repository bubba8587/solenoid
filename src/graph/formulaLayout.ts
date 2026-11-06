// [[B16]] oneFormulaSurface, [[formula-language#Editor support]]
// Formula layout by parentheses. A run that fits its line stays as typed. One that doesn't breaks first before its
// top-level + - &, then * /, packing the pieces onto lines; a group too long for a line of its own puts each argument
// on its own line, one indent deeper, closing at the opening line's indent. Only line breaks and indentation change:
// text inside a string, and every space within a line, is kept.

/** One level of indent: a tab, drawn two columns wide (the editor's tab-size). */
export const FORMULA_INDENT = "\t";
const TAB_COLS = 2;
/** How many columns an indent takes on screen. */
const cols = (indent: string) => indent.length + (TAB_COLS - 1) * (indent.split("\t").length - 1);
/** Characters a line may hold before its groups break; sized for a card's formula field. */
export const FORMULA_WIDTH = 40;

type Group = { kind: "group"; open: string; close: string; args: Item[][] };
type Item = string | Group;

/** Joins lines back into one: a break beside a bracket or a comma vanishes, any other becomes one space. */
export function flattenFormula(text: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inStr = !inStr;
    if (inStr || (ch !== "\n" && ch !== "\r")) { out += ch; continue; }
    let j = i;
    while (j < text.length && /\s/.test(text[j])) j++;
    out = out.replace(/[ \t]+$/, "");
    const prev = out[out.length - 1];
    const next = text[j];
    if (!(prev === undefined || prev === "(" || prev === "{" || prev === "," || next === ")" || next === "}" || next === undefined)) out += " ";
    i = j - 1;
  }
  return out;
}

function parse(text: string): Item[] {
  const root: Item[][] = [[]];
  const stack: { group: Group; outer: Item[][] }[] = [];
  let args = root;
  let buf = "";
  let inStr = false;
  const flush = () => { if (buf) args[args.length - 1].push(buf); buf = ""; };
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    if (inStr) { buf += ch; continue; }
    if (ch === "(" || ch === "{") {
      flush();
      const group: Group = { kind: "group", open: ch, close: ch === "(" ? ")" : "}", args: [[]] };
      args[args.length - 1].push(group);
      stack.push({ group, outer: args });
      args = group.args;
    } else if ((ch === ")" || ch === "}") && stack.length && stack[stack.length - 1].group.close === ch) {
      flush();
      args = stack.pop()!.outer;
    } else if (ch === "," && stack.length) {
      flush();
      args.push([]);
    } else buf += ch;
  }
  flush();
  // An unclosed group (a formula mid-typing) keeps what was typed; the caller sees it fit or break the same way.
  return root[0];
}

const flat = (items: Item[]): string =>
  items.map((it) => (typeof it === "string" ? it : it.open + it.args.map(flat).join(",") + it.close)).join("");

/** Splits items before each top-level binary operator in `ops`, the operator leading its piece. */
function split(items: Item[], ops: string): Item[][] {
  const out: Item[][] = [[]];
  for (const it of items) {
    if (typeof it !== "string") { out[out.length - 1].push(it); continue; }
    let piece = "";
    let inStr = false;
    for (let i = 0; i < it.length; i++) {
      const ch = it[i];
      if (ch === '"') inStr = !inStr;
      const before = (flat(out[out.length - 1]) + piece).trimEnd();
      const last = before[before.length - 1];
      // Binary only: after an operand, and never the sign of an exponent (1e-5).
      const binary = !inStr && ops.includes(ch) && last !== undefined && /[\w)\]}"%.]/.test(last) && !/(^|[^\w])\d+\.?\d*[eE]$/.test(before);
      if (binary) {
        if (piece) out[out.length - 1].push(piece);
        out.push([]);
        piece = ch;
      } else piece += ch;
    }
    if (piece) out[out.length - 1].push(piece);
  }
  return out.filter((t) => flat(t).trim() !== "");
}

/** Lays out a run of items whose first line starts at `indent`; later lines carry the indent themselves. */
function layout(items: Item[], indent: string, width: number): string {
  items = trimItems(items);
  const text = flat(items);
  if (cols(indent) + text.length <= width) return text;
  let pieces = split(items, "+-&");
  if (pieces.length === 1) pieces = split(items, "*/");
  if (pieces.length === 1) return groups(items, indent, width);
  // Pieces pack onto a line while they fit; a piece starting a line shows its operator with a space after it.
  const lines: string[] = [];
  for (const [k, piece] of pieces.entries()) {
    const raw = flat(piece).trim();
    const cur = lines[lines.length - 1];
    if (cur !== undefined && !cur.includes("\n") && cols(indent) + cur.length + raw.length <= width) {
      lines[lines.length - 1] = cur + raw;
      continue;
    }
    const lead = k > 0 ? raw.slice(0, 1) + " " : "";
    const body = k > 0 ? trimItems(dropLead(piece)) : piece;
    // Continuation lines sit a level in, so a nested break reads as part of its piece.
    lines.push(lead + layout(body, indent + FORMULA_INDENT, width));
  }
  return lines.join("\n" + indent);
}

/** A piece without its leading operator. */
function dropLead(piece: Item[]): Item[] {
  const out = [...piece];
  if (typeof out[0] === "string") out[0] = out[0].replace(/^\s*[-+&*/]/, "");
  return out.filter((it) => it !== "");
}

/** One term: a group opens up only when it can't fit on a line of its own. */
function groups(items: Item[], indent: string, width: number): string {
  let out = "";
  for (const it of items) {
    if (typeof it === "string") { out += it; continue; }
    const text = flat([it]);
    if (cols(indent) + text.length <= width || it.open === "{" || (it.args.length === 1 && flat(it.args[0]).trim() === "")) {
      out += text;
      continue;
    }
    const inner = indent + FORMULA_INDENT;
    const args = it.args.map((a, k) => inner + layout(a, inner, width) + (k < it.args.length - 1 ? "," : ""));
    out += it.open + "\n" + args.join("\n") + "\n" + indent + it.close;
  }
  return out;
}

function trimItems(items: Item[]): Item[] {
  const out = [...items];
  if (typeof out[0] === "string") out[0] = out[0].trimStart();
  const n = out.length - 1;
  if (typeof out[n] === "string") out[n] = (out[n] as string).trimEnd();
  return out.filter((it) => it !== "");
}

/** Lays a formula out by its parentheses; a formula that fits on one line comes back as it was given. */
export function indentFormula(text: string, width = FORMULA_WIDTH): string {
  const one = flattenFormula(text);
  if (one.length <= width) return one === text.trim() ? text : one;
  return layout(parse(one), "", width);
}

/** The indent a new line takes at `caret`: one level per bracket still open before it. */
export function indentAt(text: string, caret: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < caret && i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr && (ch === "(" || ch === "{")) depth++;
    else if (!inStr && (ch === ")" || ch === "}")) depth = Math.max(0, depth - 1);
  }
  return depth;
}
