// The harvest: every case the existing tests and specs hold for a family's functions, moved into records with their
// formulas and inputs only, and a ledger accounting for every mention of those functions
// (tree/specs/computation/function-records.md § The harvest ledger).
import { readFileSync } from "node:fs";
import { checkOurs } from "./forms.ts";

export interface Harvested {
  fn: string;
  formula: string;
  env: string[];
  group?: string;
  truth?: "rule" | "reference" | "past";
  expect?: string;
  cite?: string;
  source: string;
}

/** A hand decision about one source line: the cases it holds, or why it holds none. */
export interface Disposition {
  /** Cases written out by hand, for a line whose case isn't a formula literal (a direct call, a spec statement). */
  cases?: Array<Omit<Harvested, "source" | "env"> & { env?: string[] }>;
  /** Per literal on the line, in order: fields that override what the extractor found, or `{ drop: why }`. */
  literals?: Array<Partial<Omit<Harvested, "source">> & { drop?: string }>;
  /** Why the line holds no case for the family. */
  why?: string;
}

export interface Plan {
  family: string;
  functions: readonly string[];
  /** Files whose mentions the harvest reads (repo-relative). */
  sources: readonly string[];
  /** Named values a source's formulas read, per file: `name=form`. */
  envs: Record<string, Record<string, string>>;
  dispositions: Record<string, Disposition>;
  /** A whole file that holds no case for the family, and why (a list of names, a file about something else). */
  files: Record<string, string>;
  /** Lines whose cases never name their function (a test calling the regex engine directly), written out by hand. */
  unnamed: Record<string, Disposition>;
  /** Each function's baseline: one call it answers normally, every argument written out, with any names it reads. */
  baselines: Record<string, { formula: string; env?: string[] }>;
}

export interface LedgerEntry { line: number; text: string; moved: number; why?: string }
export interface Ledger { family: string; sources: Record<string, LedgerEntry[]>; unaccounted: string[]; errors: string[] }

const CONSTANTS = new Set(["e", "pi", "tau", "phi"]);

function unescapeRust(s: string): string {
  return s.replace(/\\(u\{([0-9a-fA-F]+)\}|.)/g, (_, c: string, hex?: string) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ({ n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "'": "'" } as Record<string, string>)[c] ?? `\\${c}`;
  });
}

function unescapeJs(s: string): string {
  return s.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|.)/g, (_, c: string, b?: string, u?: string, x?: string) => {
    const hex = b ?? u ?? x;
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ({ n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "'": "'", "`": "`", "\\": "\\" } as Record<string, string>)[c] ?? c;
  });
}

/** Every string literal on a line, unescaped by the line's language; a template literal with `${` is left out. */
export function literalsOf(line: string, rust: boolean): string[] {
  const out: string[] = [];
  const re = rust ? /"((?:[^"\\]|\\.)*)"/g : /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.|\$(?!\{))*)`/g;
  for (const m of line.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3];
    // A Rust `format!` string is a template whose `{…}` fill in later, never a formula as written.
    if (rust && /format!\(\s*$/.test(line.slice(0, m.index))) continue;
    out.push(rust ? unescapeRust(raw) : unescapeJs(raw));
  }
  return out;
}

/** Whether text is one formula under Solenoid's grammar ([[formula-language#Lexical grammar]], § Syntax): a test's
 *  prose that happens to mention a call is not. Anything outside the grammar (`{`, `;`, `#`, `'`) fails too. */
export function isFormula(src: string): boolean {
  const toks: string[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') { const j = s.indexOf('"', i + 1); if (j < 0) return false; toks.push("str"); i = j + 1; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i))!;
      if (/^[0-9.]/.test(s.slice(i + m[0].length))) return false;
      toks.push("num"); i += m[0].length; continue;
    }
    if (/[A-Za-z_λ]/.test(c)) {
      const m = /^[A-Za-z_λ][A-Za-z0-9_λ]*(\.[A-Za-z0-9_λ]+)*/.exec(s.slice(i))!;
      toks.push("name"); i += m[0].length; continue;
    }
    if (c === "[") { const j = s.indexOf("]", i); if (j < 0) return false; toks.push("ref"); i = s[i + 1] === "@" && s[i + 2] === "[" ? s.indexOf("]]", i) + 2 : j + 1; continue; }
    const two = s.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { toks.push("bin"); i += 2; continue; }
    if ("*/^&=<>".includes(c)) { toks.push("bin"); i++; continue; }
    if (c === "+" || c === "-") { toks.push("sign"); i++; continue; }
    if (c === "%") { toks.push("%"); i++; continue; }
    if (c === "@") { toks.push("@"); i++; continue; }
    if (c === "(" || c === ")" || c === ",") { toks.push(c); i++; continue; }
    return false;
  }
  let p = 0;
  const peek = () => toks[p];
  const args = (): boolean => {
    p++; // (
    if (peek() === ")") { p++; return true; }
    for (;;) {
      if (peek() !== "," && peek() !== ")") { if (!expr()) return false; }
      if (peek() === ",") { p++; continue; }
      if (peek() === ")") { p++; return true; }
      return false;
    }
  };
  const primary = (): boolean => {
    const t = peek();
    if (t === "num" || t === "str" || t === "ref") p++;
    else if (t === "name") { p++; if (peek() === "(" && !args()) return false; }
    else if (t === "@") { p++; if (peek() !== "name" && peek() !== "ref") return false; p++; }
    else if (t === "(") { p++; if (!expr() || peek() !== ")") return false; p++; }
    else return false;
    while (peek() === "(") if (!args()) return false;
    return true;
  };
  const unary = (): boolean => {
    while (peek() === "sign") p++;
    if (!primary()) return false;
    while (peek() === "%") p++;
    return true;
  };
  const expr = (): boolean => {
    if (!unary()) return false;
    while (peek() === "bin" || peek() === "sign") { p++; if (!unary()) return false; }
    return true;
  };
  return toks.length > 0 && expr() && p === toks.length;
}

/** The names a formula reads that aren't functions, logicals or constants: string literals blanked first. */
export function namesRead(formula: string): string[] {
  const bare = formula.replace(/"[^"]*"/g, '""');
  const out = new Set<string>();
  const params = new Set<string>();
  // LAMBDA's parameters and LET's names are bound by the formula itself: every argument but the last that is a bare name.
  for (const m of bare.matchAll(/\b(LAMBDA|LET)\s*\(/gi)) {
    let depth = 0, start = m.index! + m[0].length, j = start;
    const parts: string[] = [];
    for (; j < bare.length; j++) {
      const c = bare[j];
      if (c === "(") depth++;
      else if (c === ")") { if (depth === 0) break; depth--; }
      else if (c === "," && depth === 0) { parts.push(bare.slice(start, j).trim()); start = j + 1; }
    }
    for (const p of parts) if (/^[A-Za-z_λ][A-Za-z0-9_λ.]*$/.test(p)) params.add(p);
  }
  for (const m of bare.matchAll(/[A-Za-z_λ][A-Za-z0-9_λ]*(?:\.[A-Za-z0-9_λ]+)*/g)) {
    const name = m[0];
    const after = bare.slice(m.index! + name.length).trimStart();
    if (after.startsWith("(")) continue;
    if (/^(true|false)$/i.test(name) || CONSTANTS.has(name.toLowerCase()) || params.has(name)) continue;
    const before = bare[m.index! - 1];
    if (before && /[0-9.]/.test(before)) continue; // an exponent's e, as in 2e3
    out.add(name);
  }
  return [...out];
}

/** The first function a formula calls, which is whose record the case joins unless a disposition says otherwise. */
export function firstCall(formula: string, functions: ReadonlySet<string>): string | null {
  const bare = formula.replace(/"[^"]*"/g, '""');
  const m = /([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(bare);
  return m ? m[1].toUpperCase() : null;
}

export function harvest(plan: Plan, root: string): { cases: Harvested[]; ledger: Ledger } {
  const names = new Set(plan.functions);
  const mention = new RegExp(`\\b(${plan.functions.map((f) => f.replaceAll(".", "\\.")).join("|")})\\b`);
  const ledger: Ledger = { family: plan.family, sources: {}, unaccounted: [], errors: [] };
  const cases: Harvested[] = [];
  const used = new Set<string>();
  for (const path of plan.sources) {
    const rust = path.endsWith(".rs");
    const md = path.endsWith(".md");
    const lines = readFileSync(`${root}/${path}`, "utf8").split("\n");
    const entries: LedgerEntry[] = [];
    if (plan.files[path]) {
      ledger.sources[path] = [{ line: 0, text: "(the whole file)", moved: 0, why: plan.files[path] }];
      continue;
    }
    // Inside a crate's src/, only its inline tests hold cases: the code above them implements the functions.
    const testsFrom = /^crates\/[^/]+\/src\//.test(path) ? lines.findIndex((l) => l.includes("#[cfg(test)]")) : 0;
    lines.forEach((text, i) => {
      const n = i + 1;
      if (i < testsFrom || testsFrom < 0) return;
      if (!mention.test(text)) return;
      const key = `${path}:${n}`;
      const d = plan.dispositions[key];
      if (d) used.add(key);
      const entry: LedgerEntry = { line: n, text: text.trim().slice(0, 200), moved: 0 };
      const take = (c: Omit<Harvested, "source">) => {
        const env = c.env ?? [];
        if (!isFormula(c.formula)) ledger.errors.push(`${key}: not a formula in the shared syntax: ${c.formula}`);
        const bound = new Set(env.map((e) => e.slice(0, e.indexOf("="))));
        for (const name of namesRead(c.formula)) if (!bound.has(name)) ledger.errors.push(`${key}: ${c.formula} reads ${name}, which nothing binds`);
        for (const e of env) {
          try { checkOurs(e.slice(e.indexOf("=") + 1)); } catch (err) { ledger.errors.push(`${key}: env ${e}: ${(err as Error).message}`); }
        }
        if (c.expect) try { checkOurs(c.expect); } catch (err) { ledger.errors.push(`${key}: expect ${c.expect}: ${(err as Error).message}`); }
        if ((c.truth === "rule" || c.truth === "reference") && (!c.expect || !c.cite)) ledger.errors.push(`${key}: a ${c.truth} case needs expect and cite`);
        if (names.has(c.fn)) { cases.push({ ...c, env, source: key }); entry.moved++; }
      };
      // In a spec, a formula is an example in a code span.
      const found = md ? [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]) : literalsOf(text, rust);
      const lits = found.filter((l) => mention.test(l) && /\(/.test(l) && isFormula(l));
      lits.forEach((formula, j) => {
        const o = d?.literals?.[j] ?? {};
        if (o.drop) { entry.why = entry.why ? `${entry.why}; ${o.drop}` : o.drop; return; }
        if (/[@[]/.test(formula.replace(/"[^"]*"/g, '""'))) {
          const why = "a computed column's row or column reference, outside the syntax Excel and Solenoid share";
          entry.why = entry.why ? `${entry.why}; ${why}` : why;
          return;
        }
        const f = (o.formula ?? formula).trim();
        const fileEnv = plan.envs[path] ?? {};
        const env = o.env ?? namesRead(f).filter((nm) => nm in fileEnv).map((nm) => `${nm}=${fileEnv[nm]}`);
        take({ fn: o.fn ?? firstCall(f, names) ?? "", formula: f, env, group: o.group, truth: o.truth, expect: o.expect, cite: o.cite });
      });
      if (d?.literals && d.literals.length !== lits.length) ledger.errors.push(`${key}: the disposition lists ${d.literals.length} literals, the line has ${lits.length}`);
      for (const c of d?.cases ?? []) take({ ...c, env: c.env ?? [] });
      if (d?.why) entry.why = entry.why ? `${entry.why}; ${d.why}` : d.why;
      const otherFamily = lits.length > 0 && entry.moved === 0 && !entry.why;
      if (otherFamily) entry.why = "its case belongs to another family's function";
      if (entry.moved === 0 && !entry.why) ledger.unaccounted.push(`${key}: ${entry.text}`);
      entries.push(entry);
    });
    ledger.sources[path] = entries;
  }
  for (const [key, d] of Object.entries(plan.unnamed)) {
    const [path, ln] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
    const text = readFileSync(`${root}/${path}`, "utf8").split("\n")[ln - 1];
    if (text === undefined) { ledger.errors.push(`${key}: no such line`); continue; }
    if (mention.test(text)) ledger.errors.push(`${key}: the line names a family function, so it belongs in dispositions`);
    const entry: LedgerEntry = { line: ln, text: text.trim().slice(0, 200), moved: 0, why: d.why };
    for (const c of d.cases ?? []) {
      for (const name of namesRead(c.formula)) if (!(c.env ?? []).some((e) => e.startsWith(`${name}=`))) ledger.errors.push(`${key}: ${c.formula} reads ${name}, which nothing binds`);
      if (!isFormula(c.formula)) ledger.errors.push(`${key}: not a formula in the shared syntax: ${c.formula}`);
      if (names.has(c.fn)) { cases.push({ ...c, env: c.env ?? [], source: key }); entry.moved++; }
      else ledger.errors.push(`${key}: ${c.fn} is not in the family`);
    }
    if (entry.moved === 0 && !entry.why) ledger.errors.push(`${key}: neither cases nor a reason`);
    (ledger.sources[path] ??= []).push(entry);
  }
  for (const key of Object.keys(plan.dispositions)) if (!used.has(key)) ledger.errors.push(`${key}: a disposition for a line with no mention (moved or stale)`);
  return { cases, ledger };
}
