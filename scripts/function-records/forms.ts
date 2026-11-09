// The two answer forms of a function record (tree/specs/computation/function-records.md): Solenoid's `kind:value` and
// Excel's constant notation. Every writer and reader of a record goes through here, so each form is defined once.

export type Family = "num" | "text" | "date" | "bool" | "cx";

export type Item =
  | { k: "num"; v: number }
  | { k: "text"; v: string }
  | { k: "date"; day: string; time?: string }
  | { k: "bool"; v: boolean }
  | { k: "cx"; re: number; im: number }
  | { k: "blank" }
  | { k: "err"; code: string; msg?: string };

export type Ours =
  | Item
  | { k: "list"; items: Item[] }
  | { k: "table"; rows: Item[][] }
  | { k: "mixed"; items: Ours[] }
  | { k: "unit"; v: number; dim: string; as?: string; ratio?: boolean }
  | { k: "lambda"; src: string }
  | { k: "undef" };

export type Excel =
  | { k: "num"; raw: string }
  | { k: "text"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; code: string }
  | { k: "array"; rows: Excel[][] };

const ERROR_CODE = /^#[A-Z0-9/]+[!?A]$/;

export function quote(s: string): string {
  return `"${s.replaceAll('"', '""')}"`;
}

export function numText(n: number): string {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (Object.is(n, -0)) return "-0";
  return String(n);
}

function readNum(s: string): number {
  if (s === "nan") return NaN;
  if (s === "inf") return Infinity;
  if (s === "-inf") return -Infinity;
  if (s === "-0") return -0;
  if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) throw new Error(`not a number: ${s}`);
  return Number(s);
}

function familyOf(i: Item): Family | null {
  return i.k === "blank" || i.k === "err" ? null : i.k;
}

function cxText(re: number, im: number): string {
  const neg = im < 0 || Object.is(im, -0);
  return `${numText(re)}${neg ? "-" : "+"}${numText(neg ? -im : im)}i`;
}

function bareItem(i: Item): string {
  switch (i.k) {
    case "num": return numText(i.v);
    case "text": return quote(i.v);
    case "date": return i.time ? `${i.day}T${i.time}` : i.day;
    case "bool": return i.v ? "TRUE" : "FALSE";
    case "cx": return cxText(i.re, i.im);
    case "blank": return "blank";
    case "err": return i.msg === undefined ? i.code : `${i.code} ${quote(i.msg)}`;
  }
}

/** The one family a list's items share, or null when none has one; throws on a mix, which is written `list:MIXED`. */
function sharedFamily(items: Item[]): Family | null {
  let fam: Family | null = null;
  for (const i of items) {
    const f = familyOf(i);
    if (f && fam && f !== fam) throw new Error("mixed");
    fam = f ?? fam;
  }
  return fam;
}

function header(kind: "list" | "table", fam: Family | null): string {
  return fam ? `${kind}:${fam}:` : `${kind}:`;
}

/** Solenoid's answer form. A list of more than one family comes back as `list:MIXED`, never as a list. */
export function printOurs(v: Ours): string {
  switch (v.k) {
    case "list": {
      let fam: Family | null;
      try { fam = sharedFamily(v.items); } catch { return printOurs({ k: "mixed", items: v.items }); }
      return `${header("list", fam)}[${v.items.map(bareItem).join(", ")}]`;
    }
    case "table": {
      let fam: Family | null;
      try { fam = sharedFamily(v.rows.flat()); } catch { return printOurs({ k: "mixed", items: v.rows.map((r) => ({ k: "list", items: r })) }); }
      return `${header("table", fam)}[${v.rows.map((r) => `[${r.map(bareItem).join(", ")}]`).join(", ")}]`;
    }
    case "mixed": return `list:MIXED:[${v.items.map(printOurs).join(", ")}]`;
    case "unit": return v.ratio ? `unit:${numText(v.v)} ratio` : `unit:${numText(v.v)} ${v.dim}${v.as ? ` as ${v.as}` : ""}`;
    case "lambda": return `lambda:${v.src}`;
    case "undef": return "undef:";
    case "blank": return "blank:";
    case "err": return `err:${bareItem(v)}`;
    default: return `${v.k}:${bareItem(v)}`;
  }
}

// ─── Reading Solenoid's form ─────────────────────────────────────────────────────

class Reader {
  at = 0;
  readonly s: string;
  constructor(s: string) { this.s = s; }
  done() { return this.at >= this.s.length; }
  peek(t: string) { return this.s.startsWith(t, this.at); }
  eat(t: string) {
    if (!this.peek(t)) throw new Error(`expected ${JSON.stringify(t)} at ${this.at} in ${this.s}`);
    this.at += t.length;
  }
  quoted(): string {
    this.eat('"');
    let out = "";
    for (;;) {
      const j = this.s.indexOf('"', this.at);
      if (j < 0) throw new Error(`unterminated text in ${this.s}`);
      out += this.s.slice(this.at, j);
      this.at = j + 1;
      if (this.s[this.at] === '"') { out += '"'; this.at++; } else return out;
    }
  }
  /** Up to the next item separator or closing bracket outside quotes. */
  token(): string {
    const m = /^[^,\]\[]*/.exec(this.s.slice(this.at))![0];
    this.at += m.length;
    return m.trim();
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}:\d{2}\.\d{3}$/;

/** `<re><sign><|im|>i`: the sign is the last + or − that neither starts the text nor follows an exponent's `e`. */
function readCx(t: string): { re: number; im: number } {
  if (!t.endsWith("i")) throw new Error(`not a complex number: ${t}`);
  let j = -1;
  for (let k = t.length - 2; k > 0; k--) if ((t[k] === "+" || t[k] === "-") && t[k - 1] !== "e") { j = k; break; }
  if (j < 0) throw new Error(`not a complex number: ${t}`);
  const im = readNum(t.slice(j + 1, -1));
  return { re: readNum(t.slice(0, j)), im: t[j] === "-" ? -im : im };
}

function readItem(r: Reader, fam: Family | null): Item {
  if (r.peek('"')) {
    if (fam !== "text") throw new Error(`text item in a ${fam ?? "family-less"} list: ${r.s}`);
    return { k: "text", v: r.quoted() };
  }
  if (r.peek("#")) {
    const code = r.s.slice(r.at).match(/^#[A-Z0-9/]+[!?A]/)?.[0];
    if (!code) throw new Error(`bad error item in ${r.s}`);
    r.at += code.length;
    if (r.peek(' "')) { r.at++; return { k: "err", code, msg: r.quoted() }; }
    return { k: "err", code };
  }
  const t = r.token();
  if (t === "blank") return { k: "blank" };
  return readBare(fam, t, r.s);
}

function readBare(fam: Family | null, t: string, whole: string): Item {
  switch (fam) {
    case "num": return { k: "num", v: readNum(t) };
    case "bool": if (t === "TRUE" || t === "FALSE") return { k: "bool", v: t === "TRUE" }; break;
    case "date": {
      const [day, time] = t.split("T");
      if (DAY.test(day) && (time === undefined || TIME.test(time))) return time ? { k: "date", day, time } : { k: "date", day };
      break;
    }
    case "cx": return { k: "cx", ...readCx(t) };
    default: break;
  }
  throw new Error(`can't read ${JSON.stringify(t)} as ${fam ?? "a family-less item"} in ${whole}`);
}

function readItems(r: Reader, fam: Family | null): Item[] {
  r.eat("[");
  const out: Item[] = [];
  while (!r.peek("]")) {
    if (out.length) r.eat(", ");
    out.push(readItem(r, fam));
  }
  r.eat("]");
  return out;
}

const FAMILIES: readonly Family[] = ["num", "text", "date", "bool", "cx"];

function readHeaderFamily(r: Reader): Family | null {
  for (const f of FAMILIES) if (r.peek(`${f}:`)) { r.eat(`${f}:`); return f; }
  return null;
}

/** Reads Solenoid's answer form back; throws on anything the form doesn't allow, so a bad record can't load. */
export function parseOurs(s: string): Ours {
  const colon = s.indexOf(":");
  if (colon < 0) throw new Error(`no kind in ${JSON.stringify(s)}`);
  const kind = s.slice(0, colon);
  const rest = s.slice(colon + 1);
  const r = new Reader(s);
  r.at = colon + 1;
  const end = (v: Ours): Ours => {
    if (!r.done()) throw new Error(`trailing text in ${s}`);
    return v;
  };
  switch (kind) {
    case "num": return { k: "num", v: readNum(rest) };
    case "bool":
      if (rest === "TRUE" || rest === "FALSE") return { k: "bool", v: rest === "TRUE" };
      throw new Error(`bad logical: ${s}`);
    case "text": return end({ k: "text", v: r.quoted() });
    case "date": return readBare("date", rest, s);
    case "cx": return { k: "cx", ...readCx(rest) };
    case "blank": if (rest === "") return { k: "blank" }; throw new Error(`bad blank: ${s}`);
    case "undef": if (rest === "") return { k: "undef" }; throw new Error(`bad undef: ${s}`);
    case "err": {
      const item = readItem(r, null);
      if (item.k !== "err") throw new Error(`bad error: ${s}`);
      return end(item);
    }
    case "lambda": return { k: "lambda", src: rest };
    case "unit": {
      const sp = rest.indexOf(" ");
      if (sp < 1) throw new Error(`bad unit: ${s}`);
      const v = readNum(rest.slice(0, sp));
      const tail = rest.slice(sp + 1);
      if (tail === "ratio") return { k: "unit", v, dim: "", ratio: true };
      const as = tail.indexOf(" as ");
      const dim = as < 0 ? tail : tail.slice(0, as);
      if (!dim) throw new Error(`bad unit: ${s}`);
      return as < 0 ? { k: "unit", v, dim } : { k: "unit", v, dim, as: tail.slice(as + 4) };
    }
    case "list": {
      if (r.peek("MIXED:")) {
        r.eat("MIXED:");
        r.eat("[");
        const items: Ours[] = [];
        while (!r.peek("]")) {
          if (items.length) r.eat(", ");
          const start = r.at;
          // A tagged item ends where the next top-level ", " or the closing "]" begins.
          let depth = 0, inQ = false, j = start;
          for (; j < s.length; j++) {
            const c = s[j];
            if (inQ) { if (c === '"') inQ = s[j + 1] === '"' ? (j++, true) : false; continue; }
            if (c === '"') inQ = true;
            else if (c === "[") depth++;
            else if (c === "]") { if (depth === 0) break; depth--; }
            else if (c === "," && depth === 0) break;
          }
          items.push(parseOurs(s.slice(start, j)));
          r.at = j;
        }
        r.eat("]");
        return end({ k: "mixed", items });
      }
      const fam = readHeaderFamily(r);
      const items = readItems(r, fam);
      if (fam === null && items.some((i) => familyOf(i))) throw new Error(`a list with items of a family needs its header: ${s}`);
      return end({ k: "list", items });
    }
    case "table": {
      const fam = readHeaderFamily(r);
      r.eat("[");
      const rows: Item[][] = [];
      while (!r.peek("]")) {
        if (rows.length) r.eat(", ");
        rows.push(readItems(r, fam));
      }
      r.eat("]");
      return end({ k: "table", rows });
    }
    default: throw new Error(`unknown kind ${JSON.stringify(kind)} in ${s}`);
  }
}

// ─── Excel's constant notation ───────────────────────────────────────────────────

function excelScalar(v: Excel): string {
  switch (v.k) {
    case "num": return v.raw;
    case "text": return quote(v.v);
    case "bool": return v.v ? "TRUE" : "FALSE";
    case "err": return v.code;
    case "array": throw new Error("an array inside an array");
  }
}

export function printExcel(v: Excel): string {
  return v.k === "array" ? `{${v.rows.map((r) => r.map(excelScalar).join(",")).join(";")}}` : excelScalar(v);
}

export function parseExcel(s: string): Excel {
  const r = new Reader(s);
  const scalar = (): Excel => {
    if (r.peek('"')) return { k: "text", v: r.quoted() };
    const m = /^[^,;}]*/.exec(s.slice(r.at))![0];
    r.at += m.length;
    if (m === "TRUE" || m === "FALSE") return { k: "bool", v: m === "TRUE" };
    if (ERROR_CODE.test(m) || m === "#N/A") return { k: "err", code: m };
    if (/^-?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?$/i.test(m)) return { k: "num", raw: m };
    throw new Error(`not an Excel constant: ${JSON.stringify(m)} in ${s}`);
  };
  let out: Excel;
  if (r.peek("{")) {
    r.eat("{");
    const rows: Excel[][] = [[]];
    for (;;) {
      rows[rows.length - 1].push(scalar());
      if (r.peek(",")) r.eat(",");
      else if (r.peek(";")) { r.eat(";"); rows.push([]); }
      else break;
    }
    r.eat("}");
    out = { k: "array", rows };
  } else out = scalar();
  if (!r.done()) throw new Error(`trailing text in ${s}`);
  return out;
}

/** Every form a record holds reads back to the text it was written as. */
export function checkOurs(s: string): void {
  const back = printOurs(parseOurs(s));
  if (back !== s) throw new Error(`not canonical: ${JSON.stringify(s)} reads back as ${JSON.stringify(back)}`);
}

export function checkExcel(s: string): void {
  const back = printExcel(parseExcel(s));
  if (back !== s) throw new Error(`not canonical: ${JSON.stringify(s)} reads back as ${JSON.stringify(back)}`);
}
