import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Source-scan enforcement for the grep-shaped rules (rules.md) ─────────────
// Two rules whose BEHAVIOUR was tested but whose COMPLETENESS was not — nothing
// failed when a NEW file forgot them, which rules.md flags as precisely the shape
// of every Origin incident. These scans close the completeness half the same way
// formulaPathIsReteFree.test.ts closes FX-2: statically, over the real source, so
// a new offender fails CI with the rule's name in the message.
//
// The scans are LINE-BASED with `//` comments stripped — crude but exactly as
// crude as the failure mode they guard (a new call site is a new line of code).

const SRC = path.resolve(__dirname);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "pixi") continue; // deprecated renderer — not maintained
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Source lines with `//` comments stripped (string-literal `//` is rare enough
 *  here that the simple strip is the right trade — the scans below match call
 *  syntax, which never lives in a string). */
function codeLines(file: string): string[] {
  return fs.readFileSync(file, "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, ""));
}

const rel = (p: string) => path.relative(SRC, p);

describe("SOCK-7 — a file that retypes sockets in place must reconcile downstream", () => {
  // An in-place socket retype (swapping `port.socket` or calling
  // `MutableSocket.setType`) fires no connection event, so downstream Format
  // Controllers keep stale formats unless the file also drives
  // `retypeOutputCables` / `reconcileFcTypes` (or is part of the central
  // reconcile machinery that those passes ARE). The behaviour of the known
  // retypers is covered by fcReconcile.test.ts / noteFcPropagation.test.ts;
  // THIS is the completeness half — a brand-new retyping file that forgets the
  // reconciler fails here by name.
  const RECONCILER = /retypeOutputCables|reconcileFcTypes|reconcileTrueAnyTypes/;
  // Files sanctioned to retype WITHOUT referencing a reconciler directly, each
  // with the reason it is safe:
  const SANCTIONED: Record<string, string> = {
    "sockets.ts": "defines MutableSocket.setType — the primitive itself",
    "nodes/formatController.ts": "the FC's own sockets; retyped BY the fcReconcile pass (and at construction)",
    "nodes/control.ts": "syncOutputType returns `changed` — its component (CableSwitchNode.tsx) does the retype",
    "nodes/composite.ts": "port adoption synced by its own pass; the end-of-process settle runs reconcileFcTypes (process.ts)",
    "conduitTrace.ts": "conduit lane adoption — driven from the same central settle",
  };

  it("every socket-retyping file references the reconciler (or is sanctioned, with a reason)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const lines = codeLines(file);
      const retypes = lines.some((l) => /\.socket\s*=\s*[^=]/.test(l) || /\.setType\(/.test(l) || /\.dataType\s*=\s*[^=]/.test(l));
      if (!retypes) continue;
      const r = rel(file);
      if (r in SANCTIONED) continue;
      const src = lines.join("\n");
      if (!RECONCILER.test(src)) offenders.push(r);
    }
    expect(
      offenders,
      `These files retype sockets in place but never reference retypeOutputCables/` +
      `reconcileFcTypes (SOCK-7): downstream FCs will keep stale formats. Call the ` +
      `reconciler, or add the file to SANCTIONED with the reason it is safe:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the sanctioned list stays honest — every entry still exists and still retypes", () => {
    for (const [r, why] of Object.entries(SANCTIONED)) {
      const file = path.join(SRC, r);
      expect(fs.existsSync(file), `${r} (sanctioned: ${why}) no longer exists — drop the entry`).toBe(true);
      const lines = codeLines(file);
      const retypes = lines.some((l) => /\.socket\s*=\s*[^=]/.test(l) || /\.setType\(/.test(l) || /\.dataType\s*=\s*[^=]/.test(l));
      expect(retypes, `${r} no longer retypes any socket — drop the stale sanction`).toBe(true);
    }
  });
});

describe("VAL-10 — a node file that runs the dimension algebra declares unitAware", () => {
  // The unit-blind boundary strips `UnitCell` tags from every input UNLESS the
  // node declares `unitAware = true` (coerceInputs). So a node that calls the
  // per-cell algebra — isUnitCell / dimOf / magnitudeOf / the *Units combinators
  // / broadcastUnit — without the flag never sees a tag: the algebra silently
  // no-ops on display magnitudes. The BEHAVIOUR is covered by unitCoercion.test;
  // THIS is the completeness half (rules.md known-violation 2): a new algebra
  // node whose file forgets the flag fails here by name.
  //
  // Deliberately EXCLUDED from the consuming set: the matrix-unit family
  // (matrixUnitOf / withMatrixUnit / carryMatrixUnit / sharedMatrixUnit). A D20
  // matrix unit tags the OUTER array of a bare-number grid, so it survives the
  // unit-blind strip (stripUnitCells returns the same reference when no CELL is
  // tagged) — a unit-blind node carrying it through a reshape is correct, not a
  // violation (stats.ts's grid interpolation is the live example).
  const CONSUMES = /\b(?:isUnitCell|dimOf|magnitudeOf|arithmeticCell|compareUnits|forAggregateUnits|broadcastUnit|anyDimensioned)\s*\(/;
  // Files sanctioned to call the algebra WITHOUT declaring, with the reason:
  const SANCTIONED: Record<string, string> = {
    "nodes/shared.ts": "the helper library (broadcastUnit/guardCell/anyDimensioned) — declares no node class; every caller declares unitAware in its own file",
  };
  const NODE_DIRS = ["nodes", "packs"].map((d) => path.join(SRC, d));

  it("every algebra-calling node file declares unitAware = true (or is sanctioned, with a reason)", () => {
    const offenders: string[] = [];
    for (const dir of NODE_DIRS) {
      for (const file of walk(dir)) {
        const lines = codeLines(file);
        if (!lines.some((l) => CONSUMES.test(l))) continue;
        const r = rel(file);
        if (r in SANCTIONED) continue;
        if (!/unitAware\s*=\s*true/.test(lines.join("\n"))) offenders.push(r);
      }
    }
    expect(
      offenders,
      `These node files call the per-cell unit algebra but never declare ` +
      `unitAware = true (VAL-10): the unit-blind boundary strips the tags before ` +
      `data() runs, so the algebra silently no-ops. Declare the flag on the ` +
      `algebra-running class, or add the file to SANCTIONED with the reason:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the sanctioned list stays honest — every entry still exists, still calls the algebra, still doesn't declare", () => {
    for (const [r, why] of Object.entries(SANCTIONED)) {
      const file = path.join(SRC, r);
      expect(fs.existsSync(file), `${r} (sanctioned: ${why}) no longer exists — drop the entry`).toBe(true);
      const lines = codeLines(file);
      expect(lines.some((l) => CONSUMES.test(l)), `${r} no longer calls the algebra — drop the stale sanction`).toBe(true);
      expect(/unitAware\s*=\s*true/.test(lines.join("\n")), `${r} now declares unitAware itself — drop the redundant sanction`).toBe(false);
    }
  });
});

describe("VAL-12 — a card's family op selector binds a field named `op`", () => {
  // The declaration machinery resolves a live node's current op by reading
  // `inst.op` (nodeOps.opKindForNode), so a family whose selector field is named
  // otherwise cannot declare its ops AT ALL — they become unsearchable and
  // unmeasurable, silently (the PadNode.dir incident). nodeOps.test.ts covers
  // nodes that HAVE an `op` field; THIS closes the blindness (rules.md
  // known-violation 1): it finds the dropdowns in the component source, where a
  // misnamed field is still visible.
  //
  // The contract it enforces: every `<OpSelect>` either binds `op` (directly, a
  // per-row `.op` config field, or via useNodeField(…, "op")) or carries the
  // `arg` prop — the machine-readable "not the family op selector" declaration
  // (criterion comparators, payment timing, config/data picks; nodeKit.tsx).
  // A new family that stores its op under `mode`/`dir` fails here by name.

  /** From "<OpSelect", the tag text through its closing "/>" at brace depth 0
   *  (props contain arrow functions, so a plain [^>]* scan would stop early). */
  function opSelectTag(src: string, start: number): string | null {
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && c === "/" && src[i + 1] === ">") return src.slice(start, i + 2);
    }
    return null;
  }
  /** The tag's prop-level text (brace contents stripped) — where `arg` lives. */
  function propLevel(tag: string): string {
    let depth = 0, out = "";
    for (const c of tag) {
      if (c === "{") { depth++; continue; }
      if (c === "}") { depth--; continue; }
      if (depth === 0) out += c;
    }
    return out;
  }
  /** The expression inside value={…}, brace-aware. */
  function valueExpr(tag: string): string | null {
    const m = /value=\{/.exec(tag);
    if (!m) return null;
    let depth = 1;
    const start = m.index + m[0].length;
    for (let i = start; i < tag.length; i++) {
      if (tag[i] === "{") depth++;
      else if (tag[i] === "}" && --depth === 0) return tag.slice(start, i).trim();
    }
    return null;
  }

  it("every non-arg OpSelect binds `op` (directly, per-row `.op`, or via useNodeField)", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(SRC, "components"))) {
      const src = fs.readFileSync(file, "utf8");
      let idx = -1;
      while ((idx = src.indexOf("<OpSelect", idx + 1)) !== -1) {
        const tag = opSelectTag(src, idx);
        const line = src.slice(0, idx).split("\n").length;
        const where = `${rel(file)}:${line}`;
        if (!tag) { offenders.push(`${where} (unparseable tag)`); continue; }
        if (/\barg\b/.test(propLevel(tag))) continue; // declared not-the-op-selector
        const expr = valueExpr(tag);
        if (!expr) { offenders.push(`${where} (no value= prop)`); continue; }
        if (expr === "op" || /\.op$/.test(expr)) continue;
        // A renamed binding: const [x, …] = useNodeField(node, "op")
        if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
          const re = new RegExp(`const\\s*\\[\\s*${expr}\\b[^\\]]*\\]\\s*=\\s*useNodeField\\([^,]+,\\s*"op"`);
          if (re.test(src)) continue;
        }
        offenders.push(`${where} (binds \`${expr}\`)`);
      }
    }
    expect(
      offenders,
      `These <OpSelect> dropdowns neither bind a field named \`op\` nor carry the ` +
      `\`arg\` prop (VAL-12). If it IS the family's op selector, the node must store ` +
      `it as \`op\` (not mode/dir/kind) so NODE_OPS declarations can attach; if it is ` +
      `an argument/config/data pick, mark it \`arg\`:\n  ` + offenders.join("\n  "),
    ).toEqual([]);
  });
});

describe("PERSIST-2 — the text form carries every SavedGraph field, both directions", () => {
  // serializeGraph() returns readTextForm(writeTextForm(raw)) — the text form is
  // the NARROW WAIST of the save path, so a SavedGraph field that either
  // direction omits is deleted from EVERY save, and autosave then writes the
  // lossy result over the good copy. This happened: `comments` and
  // `reportPalette` were built by buildRawSavedGraph and silently dropped by the
  // round trip from their ship date until 2026-07-06. The scan: every field
  // declared on the SavedGraph interface must be named in BOTH writeTextForm and
  // readTextForm.
  it("every SavedGraph interface field appears in writeTextForm AND readTextForm", () => {
    const persistence = fs.readFileSync(path.join(SRC, "persistence.ts"), "utf8");
    const iface = /export interface SavedGraph \{([\s\S]*?)\n\}/.exec(persistence);
    expect(iface, "SavedGraph interface not found in persistence.ts").toBeTruthy();
    const fields = [...iface![1].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThanOrEqual(10); // parser sanity — the interface has ~12 fields
    // `v` is the version gate, checked structurally by its own dedicated lines
    // (too short a name to grep for honestly).
    const SKIP = new Set(["v"]);

    const text = fs.readFileSync(path.join(SRC, "textForm.ts"), "utf8").split("\n");
    const fnStart = (name: string) => text.findIndex((l) => l.startsWith(`export function ${name}`));
    const nextFn = (from: number) => {
      const i = text.findIndex((l, idx) => idx > from && /^(export )?function /.test(l));
      return i === -1 ? text.length : i;
    };
    const wStart = fnStart("writeTextForm"), rStart = fnStart("readTextForm");
    expect(wStart, "writeTextForm not found").toBeGreaterThanOrEqual(0);
    expect(rStart, "readTextForm not found").toBeGreaterThanOrEqual(0);
    const writeBody = text.slice(wStart, nextFn(wStart)).join("\n");
    const readBody = text.slice(rStart, nextFn(rStart)).join("\n");

    const missing: string[] = [];
    for (const f of fields) {
      if (SKIP.has(f)) continue;
      const re = new RegExp(`\\b${f}\\b`);
      if (!re.test(writeBody)) missing.push(`${f} (not written by writeTextForm)`);
      if (!re.test(readBody)) missing.push(`${f} (not read by readTextForm)`);
    }
    expect(
      missing,
      `SavedGraph fields the text-form narrow waist drops (PERSIST-2) — the field ` +
      `will silently vanish from every save until both directions carry it:\n  ` +
      missing.join("\n  "),
    ).toEqual([]);
  });
});

describe("PERSIST-6 — class names are load-bearing: keepNames stays in both bundler configs", () => {
  // `constructor.name` is not a label here — it is the TYPE written into every
  // save (persistence.ts), the ctor-registry key that loads resolve through, and
  // a dispatch key (SEES_ERRORS, groupCollapse, pinStore…). A build without
  // keepNames mangles class names, so production saves carry one-letter types
  // (permanent corruption) and error-sink dispatch silently stops matching —
  // while dev and tests, which keep names, stay green.
  it("vite.config.ts and vitest.config.ts both declare esbuild keepNames", () => {
    for (const cfg of ["vite.config.ts", "vitest.config.ts"]) {
      const src = fs.readFileSync(path.resolve(SRC, "../..", cfg), "utf8");
      expect(/keepNames:\s*true/.test(src), `${cfg} lost esbuild keepNames — class-name dispatch and save types break in production only`).toBe(true);
    }
  });
});

describe("VAL-17 — a volatile data() freezes its roll on getRecalcGen()", () => {
  // Math.random() called bare in data() re-rolls on EVERY recompute pass — any
  // unrelated edit anywhere silently changes the value, F9 stops being the
  // thing that controls re-rolling, and a Monte Carlo built on it is
  // non-reproducible. The convention (RandBetween/Shuffle/RandArray/random-line)
  // caches the draw and re-rolls only when the recalc generation changes.
  const SANCTIONED: Record<string, string> = {
    "nodes/composite.ts": "generates port/scenario IDS at author time, not values in data()",
  };
  it("every nodes/packs file calling Math.random references getRecalcGen (or is sanctioned, with a reason)", () => {
    const offenders: string[] = [];
    for (const dir of ["nodes", "packs"].map((d) => path.join(SRC, d))) {
      for (const file of walk(dir)) {
        const lines = codeLines(file);
        if (!lines.some((l) => /\bMath\.random\(/.test(l))) continue;
        const r = rel(file);
        if (r in SANCTIONED) continue;
        if (!/getRecalcGen/.test(lines.join("\n"))) offenders.push(r);
      }
    }
    expect(
      offenders,
      `These node files call Math.random() without freezing on getRecalcGen() ` +
      `(VAL-17): the value silently re-rolls on every recompute pass. Cache the ` +
      `draw against the recalc generation, or add to SANCTIONED with the reason:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });
  it("the sanctioned list stays honest", () => {
    for (const [r, why] of Object.entries(SANCTIONED)) {
      const file = path.join(SRC, r);
      expect(fs.existsSync(file), `${r} (sanctioned: ${why}) no longer exists — drop the entry`).toBe(true);
      const lines = codeLines(file);
      expect(lines.some((l) => /\bMath\.random\(/.test(l)), `${r} no longer calls Math.random — drop the stale sanction`).toBe(true);
    }
  });
});

describe("EFFECT-1 — data() never touches disk", () => {
  // A sink's data() caches for preview ONLY; the write lives in run(), fired by
  // the node's Run button. The two existing sink families are pinned by their
  // own suites, but a NEW sink whose data() writes was uncaught until its own
  // test existed (EFFECT-1's closed gap): this brace-matches
  // every data() body in nodes/ + packs/ and refuses the write APIs — and
  // `this.run(`, the indirect spelling of the same mistake.
  const WRITE_APIS = ["writeTextFilePath", "pickSaveFilePath", "writeDocumentToVault", "obsidianWrite"];

  /** Index just past the matching close for the opener at src[i] ("(" or "{"),
   *  skipping strings, template literals (incl. nested `${…}`) and comments.
   *  -1 if unbalanced. */
  function matchDelim(src: string, i: number): number {
    const open = src[i];
    const close = open === "(" ? ")" : "}";
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
      if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return -1; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); if (e < 0) return -1; i = e + 2; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return i + 1;
      i++;
    }
    return -1;
  }
  function skipString(src: string, i: number): number {
    const q = src[i];
    i++;
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === q) return i + 1;
      if (q === "`" && src[i] === "$" && src[i + 1] === "{") { i = matchDelim(src, i + 1); if (i < 0) return src.length; continue; }
      i++;
    }
    return i;
  }

  /** Every data() METHOD body in the file. The body "{" is the first one after
   *  the argument list at paren AND angle depth 0 — a return-type annotation
   *  (`: Promise<{ … }>`) keeps its braces inside the generic's angles. */
  function dataBodies(src: string): { line: number; body: string }[] {
    const out: { line: number; body: string }[] = [];
    const re = /(?<![.\w$])data\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const argOpen = m.index + m[0].length - 1;
      const argClose = matchDelim(src, argOpen);
      if (argClose < 0) continue;
      let i = argClose, angle = 0, paren = 0, bodyStart = -1;
      while (i < src.length) {
        const c = src[i];
        if (c === ";") break; // an interface/type signature — no body
        if (c === "<") angle++;
        else if (c === ">" && src[i - 1] !== "=") angle--;
        else if (c === "(") paren++;
        else if (c === ")") paren--;
        else if (c === "{" && angle === 0 && paren === 0) { bodyStart = i; break; }
        i++;
      }
      if (bodyStart < 0) continue;
      const bodyEnd = matchDelim(src, bodyStart);
      if (bodyEnd < 0) continue;
      out.push({ line: src.slice(0, m.index).split("\n").length, body: src.slice(bodyStart, bodyEnd) });
    }
    return out;
  }

  it("no data() body in nodes/packs references a write API (or this.run)", () => {
    const offenders: string[] = [];
    let bodies = 0;
    for (const dir of ["nodes", "packs"].map((d) => path.join(SRC, d))) {
      for (const file of walk(dir)) {
        const src = fs.readFileSync(file, "utf8");
        // `this.run(` is the indirect spelling of the same mistake — but only
        // where run() IS the effect method, i.e. in a file that touches a
        // write API at all. (The live-connection Imports have a private
        // fetching helper also named run(); reads from data() are their job.)
        const writesDisk = WRITE_APIS.some((api) => src.includes(api));
        for (const { line, body } of dataBodies(src)) {
          bodies++;
          for (const api of WRITE_APIS) {
            if (body.includes(api)) offenders.push(`${rel(file)}:${line} (references ${api})`);
          }
          if (writesDisk && /\bthis\s*\.\s*run\s*\(/.test(body)) offenders.push(`${rel(file)}:${line} (calls this.run())`);
        }
      }
    }
    // Extraction self-check: the sweep really is walking the node classes — a
    // regex rot that finds nothing would otherwise pass silently.
    expect(bodies).toBeGreaterThan(250);
    expect(
      offenders,
      `These data() bodies touch a write API (EFFECT-1): data() caches for ` +
      `preview only — the effect belongs in run(), behind the Run button:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the write-API list stays honest — every name still appears in the walked tree", () => {
    // A renamed/added disk API must fail HERE (update WRITE_APIS), not silently
    // fall out of the sweep. The names live in the sink families' imports/run().
    const all = ["nodes", "packs"].flatMap((d) => walk(path.join(SRC, d))).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const missing = WRITE_APIS.filter((api) => !all.includes(api));
    expect(missing, "WRITE_APIS entries no longer referenced anywhere in nodes/packs — rename?").toEqual([]);
  });
});

describe("EFFECT-2 — an outward effect from data() gates on isGraphRebuilding()", () => {
  // The post-load recompute runs INSIDE the rebuild scope, so an alert/notice
  // fired from data() without the gate replays its whole backlog on every
  // document open, doc switch and rollback (the audit-2026-07-05 class: a
  // closed composite's interval kept firing full recomputes forever).
  it("every nodes/packs file firing an alert references isGraphRebuilding", () => {
    const offenders: string[] = [];
    for (const dir of ["nodes", "packs"].map((d) => path.join(SRC, d))) {
      for (const file of walk(dir)) {
        const lines = codeLines(file);
        if (!lines.some((l) => /\bfireAlert\(/.test(l))) continue;
        if (!/isGraphRebuilding/.test(lines.join("\n"))) offenders.push(rel(file));
      }
    }
    expect(
      offenders,
      `These node files fire alerts without the isGraphRebuilding() gate ` +
      `(EFFECT-2): every document load will replay the alert backlog:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });
});

describe("PERSIST-8 — every documentStore verb that swaps the canvas captures first and guards the rebuild", () => {
  // A verb that switches which document is on screen without captureCurrent()
  // discards up to AUTOSAVE_DELAY of edits to the outgoing doc; without the
  // isGraphRebuilding() guard it races a load and can serialize a half-built
  // canvas INTO the current doc (audit 21p — the exact bug the guards close).
  // Scan: every method of the documentStore object whose body loads a graph
  // (loadGraph / showCurrent) must also reference captureCurrent AND
  // isGraphRebuilding, or be sanctioned with the reason.
  const SANCTIONED: Record<string, string> = {
    restore: "startup — no live graph exists to capture yet; the refused-doc fallback (audit 20p) is its own guard",
    reloadCurrent: "captureCurrent() carries the rebuild guard internally; the verb's own gate is loadRevealStore.isActive()",
    remove: "DELIBERATELY no capture — the doc is going away; capturing would write the dying edits somewhere. Still guards the rebuild (21p)",
  };

  it("swap verbs capture + guard (or are sanctioned, with a reason)", () => {
    const src = fs.readFileSync(path.join(SRC, "documentStore.ts"), "utf8").split("\n");
    const start = src.findIndex((l) => l.startsWith("export const documentStore"));
    expect(start).toBeGreaterThanOrEqual(0);
    const end = src.findIndex((l, i) => i > start && l === "};");
    // Split the object literal into method bodies at 2-space indentation.
    const methodStarts: Array<{ name: string; line: number }> = [];
    for (let i = start + 1; i < end; i++) {
      const m = /^  (?:async )?(\w+)\(/.exec(src[i]);
      if (m) methodStarts.push({ name: m[1], line: i });
    }
    expect(methodStarts.length).toBeGreaterThan(8); // parser sanity
    const offenders: string[] = [];
    for (let k = 0; k < methodStarts.length; k++) {
      const { name, line } = methodStarts[k];
      const bodyEnd = k + 1 < methodStarts.length ? methodStarts[k + 1].line : end;
      const body = src.slice(line, bodyEnd).join("\n");
      if (!/loadGraph\(|showCurrent/.test(body)) continue;
      if (name in SANCTIONED) continue;
      if (!/captureCurrent/.test(body)) offenders.push(`${name} (no captureCurrent — outgoing edits discarded)`);
      if (!/isGraphRebuilding/.test(body)) offenders.push(`${name} (no isGraphRebuilding guard — races a load, audit 21p)`);
    }
    expect(
      offenders,
      `documentStore verbs that swap the canvas without the discipline (PERSIST-8):\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the sanctioned list stays honest — every entry is still a real method that loads", () => {
    const src = fs.readFileSync(path.join(SRC, "documentStore.ts"), "utf8");
    for (const [name, why] of Object.entries(SANCTIONED)) {
      expect(new RegExp(`^  (?:async )?${name}\\(`, "m").test(src), `${name} (sanctioned: ${why}) is no longer a store method — drop the entry`).toBe(true);
    }
  });
});

describe("VAL-13 — components never call node.data()", () => {
  // `data()` assumes the engine-driven coerceInputs wrapper (and, for most
  // nodes, installErrorGuards) has run; a component calling it raw gets
  // un-coerced inputs and can throw during render (the NoteNode/CurveNode
  // comments record exactly this). Components extract a pure helper instead.
  it("no component source calls .data(", () => {
    const offenders: string[] = [];
    const componentsDir = path.join(SRC, "components");
    for (const file of walk(componentsDir)) {
      const hits = codeLines(file)
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /\.data\(/.test(l));
      for (const { i } of hits) offenders.push(`${rel(file)}:${i + 1}`);
    }
    expect(
      offenders,
      `Components must not call node.data() (VAL-13) — extract a pure helper ` +
      `(the coerceInputs wrapper assumes engine-driven calls):\n  ` + offenders.join("\n  "),
    ).toEqual([]);
  });
});

describe("SSOT — input-cable pruning goes through dropInputCables", () => {
  // Ten components hand-rolled "drop every cable into these target inputs"
  // before a socket was hidden (mode switch) or removed (row delete, formula
  // variable gone), with drifting details — some snapshotted the connection
  // list, some iterated it LIVE while awaiting removals. cablePrune.ts is now
  // the one loop; a component may still call `editor.removeConnection` directly
  // only for a genuinely different shape, each sanctioned with its reason.
  const SANCTIONED: Record<string, string> = {
    "components/cablePrune.ts": "the helper itself",
    "components/ConnectionDialog.tsx": "deletes ONE user-selected cable (and its edit-replace predecessor) — not an input-key prune",
    "components/CompositeEditorOverlay.tsx": "port-sync prunes span the PARENT editor and the internal editor (cross-graph), and sever by port identity with a user-facing tally",
    "components/InterpolateNode.tsx": "the List↔Grid variant switch swaps the ENTIRE socket set — prunes both directions (inputs AND outputs)",
    "components/ListInputNode.tsx": "type-compatibility prune: keeps cables the new element type still accepts (canConnect), drops the rest — a filter, not a key set",
    "components/ReportOverlay.tsx": "targets the MAIN editor explicitly (getEditor) — a Report edits main-graph refs even while a drill-in is active",
    "components/RendererSpike.tsx": "the dev-only renderer spike harness",
    "components/expressionEdit.ts": "the Equation prune covers both directions (a variable owns an OUTPUT socket too); Expression/LAMBDA already use the helper",
  };

  it("no component or node class hand-rolls an input-cable pruning loop (use dropInputCables)", () => {
    // nodes/ and packs/ are in scope too: Computed Column's side-socket
    // reconcile moved a "these sockets are going away" moment into a node
    // class, which was exactly where the components-only scan couldn't see
    // (the twelfth hand-rolled copy, SSOT-9).
    const offenders: string[] = [];
    const roots = ["components", "nodes", "packs"].map((d) => path.join(SRC, d));
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const file of walk(root)) {
        const lines = codeLines(file);
        if (!lines.some((l) => /\.removeConnection\(/.test(l))) continue;
        const r = rel(file);
        if (r in SANCTIONED) continue;
        offenders.push(r);
      }
    }
    expect(
      offenders,
      `These files call editor.removeConnection directly — the input-key ` +
      `pruning loop lives in cablePrune.ts (dropInputCables). Use it, or add the ` +
      `file to SANCTIONED with the reason its shape is genuinely different:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the sanctioned list stays honest — every entry still exists and still removes connections", () => {
    for (const [r, why] of Object.entries(SANCTIONED)) {
      const file = path.join(SRC, r);
      expect(fs.existsSync(file), `${r} (sanctioned: ${why}) no longer exists — drop the entry`).toBe(true);
      const lines = codeLines(file);
      expect(
        lines.some((l) => /\.removeConnection\(/.test(l)),
        `${r} no longer calls removeConnection — drop the stale sanction`,
      ).toBe(true);
    }
  });
});

describe("STORE-1 — every node-keyed store registers with nodeStoreRegistry", () => {
  // Per-node state lives in module-level stores (rete's separate React root —
  // no shared context), and the registry is the ONE answer to "what happens on
  // node delete / graph rebuild". A store that skips it leaks dead-id entries
  // (bounded — rete ids never collide across loads — but real: the sweep that
  // built this found formatAnnotationStore, dockedNodeStore, compositeStaleStore
  // and standoffs unregistered, and isolateStore's miss was a VISIBLE bug: a
  // document switch while isolated dimmed the entire new graph). Every
  // src/graph/*Store*.ts either references the registry or is sanctioned here
  // with the reason it holds no per-node map.
  const SANCTIONED: Record<string, string> = {
    "nodeStoreRegistry.ts": "the registry itself",
    "documentStore.ts": "document-level (docs, slots, autosave) — not node-keyed",
    "documentStoreCore.ts": "documentStore's pure transform half",
    "docMetaStore.ts": "per-document metadata",
    "calcModeStore.ts": "per-document calc mode",
    "settingsStore.ts": "app settings",
    "apiKeyStore.ts": "the AI key (settings)",
    "shortcutsStore.ts": "keyboard-shortcut prefs",
    "addMenuStore.ts": "Add-menu UI state",
    "paletteStore.ts": "command-palette UI state",
    "outlineStore.ts": "Navigator open/closed UI state",
    "mobileMenuStore.ts": "mobile sheet UI state",
    "helpDialogStore.ts": "dialog open/closed",
    "confirmStore.ts": "dialog open/closed",
    "connectionDialogStore.ts": "dialog request state (transient)",
    "noticeStore.ts": "toast queue (self-expiring)",
    "computeOverlayStore.ts": "compute-progress overlay (transient)",
    "presentationStore.ts": "presenter-mode UI state",
    "rendererSpikeStore.ts": "dev-only renderer spike",
    "frStore.ts": "Function Reference overlay (transient open state)",
    "gridSnapStore.ts": "canvas snap pref",
    "semanticZoomStore.ts": "canvas zoom band (derived per frame)",
    "touchSelectStore.ts": "touch selection mode toggle",
    "cableFlourishStore.ts": "global cable render toggle",
    "cableFlowStore.ts": "global cable flow-animation toggle",
    "chartPopupStore.ts": "ONE transient open-popup id, not a per-node map",
    "cubePopupStore.ts": "ONE transient open-popup id, not a per-node map",
    "tablePopupStore.ts": "ONE transient open-popup id, not a per-node map",
    "formulaPopupStore.ts": "ONE transient open-popup id, not a per-node map",
    "pivotEditorStore.ts": "ONE transient open-editor id, not a per-node map",
    "elementPickerStore.ts": "ONE transient open-picker id, not a per-node map",
    "compositeEditorStore.ts": "ONE transient open-drill-in id, not a per-node map",
    "reportStore.ts": "ONE transient open-overlay id (+ dock flag), not a per-node map",
  };

  it("every *Store*.ts references registerNodeForget (or is sanctioned, with a reason)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const base = rel(file);
      if (!/Store[A-Za-z]*\.ts$/.test(base) || base.includes("/")) continue; // top-level stores
      if (base in SANCTIONED) continue;
      const src = fs.readFileSync(file, "utf8");
      if (!/registerNodeForget/.test(src)) offenders.push(base);
    }
    expect(
      offenders,
      `These stores hold state but never register with nodeStoreRegistry ` +
      `(STORE-1): a deleted node's entries linger and a rebuild misses them. ` +
      `registerNodeForget(+All), or add the store to SANCTIONED with the reason ` +
      `it is not node-keyed:\n  ` + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("every registrant also registers the bulk reset (forgetAll)", () => {
    // The rebuild path calls forgetAllNodes() ONCE instead of per-node forgets
    // (O(nodes × entries) — the recorded rebuild cost). A store with only the
    // per-node half silently opts back into the slow path AND leaks on rebuild
    // (the per-node handler is skipped while rebuilding).
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const base = rel(file);
      if (base === "nodeStoreRegistry.ts" || base.includes("/")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/registerNodeForget\(/.test(src) && !/registerNodeForgetAll\(/.test(src)) offenders.push(base);
    }
    expect(
      offenders,
      `These stores register forget but not forgetAll (STORE-1) — the rebuild ` +
      `bulk reset misses them:\n  ` + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the sanctioned list stays honest — every entry exists and stays unregistered", () => {
    for (const [base, why] of Object.entries(SANCTIONED)) {
      const file = path.join(SRC, base);
      expect(fs.existsSync(file), `${base} (sanctioned: ${why}) no longer exists — drop the entry`).toBe(true);
      if (base === "nodeStoreRegistry.ts") continue;
      const src = fs.readFileSync(file, "utf8");
      expect(/registerNodeForget/.test(src), `${base} now registers — drop the redundant sanction`).toBe(false);
    }
  });
});

describe("SOCK-8 — the socket box's greppable half", () => {
  // The full rule is a rendering invariant (rete-render-utils measures the
  // span's offset box; offsetTop ignores transforms) that only a browser can
  // verify end to end. But its known REGRESSION VECTORS are all textual, and
  // each has bitten before: losing the deterministic 12×12/line-height:0 box,
  // reintroducing a fixed INPUT_ROW_TOP-style constant, or positioning the dot
  // with a transform. This pins the greppable half; the rendering half stays
  // recorded as unenforced in rules.md.
  it("socket.css keeps the deterministic box (display:block, size var at 12px, line-height 0)", () => {
    const css = fs.readFileSync(path.join(SRC, "components/socket.css"), "utf8");
    expect(/display: block/.test(css), "socket span must be display:block").toBe(true);
    expect(/width: var\(--socket-size, 12px\)/.test(css), "the 12px size variable fallback").toBe(true);
    expect(/height: var\(--socket-size, 12px\)/.test(css), "width === height via the same variable").toBe(true);
    expect(/line-height: 0/.test(css), "line-height: 0 (the measured offset box)").toBe(true);
  });

  it("no fixed row constant, no transform positioning in the socket component", () => {
    for (const file of ["components/NodeSocket.tsx"]) {
      const src = codeLines(path.join(SRC, file)).join("\n");
      expect(/INPUT_ROW_TOP/.test(src), `${file} reintroduced a fixed row constant`).toBe(false);
      expect(/transform:\s*[`'"]?translate/.test(src), `${file} positions the dot with a transform (offsetTop ignores it)`).toBe(false);
    }
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      if (/INPUT_ROW_TOP/.test(codeLines(file).join("\n"))) hits.push(rel(file));
    }
    expect(hits, "INPUT_ROW_TOP-style constants came back").toEqual([]);
  });
});

describe("SOCK-14 — frame-input labels follow the column-role grammar", () => {
  // A frame input's label is the ONE place the expected columns can be read
  // before wiring (aligned columns arrive as one frame input by design). Roles
  // join with " + " in Title case; a no-expectation input is a plain noun; shape
  // parentheticals are banned (the socket glyph + Legend already say the shape).
  const ROLE = /^[A-Z][A-Za-z0-9]*$/;                       // "Value", "OHLC"
  const NOUN = /^[A-Z][A-Za-z0-9]*( [A-Z][A-Za-z0-9]*)*$/;  // "Frame", "Data"
  // nodes/tableLambda.ts: the λ-table inputs carry the λ ARGUMENT name and
  // optionality — an argument-binding hint, not a shape (the rule's exception).
  const LAMBDA_FORM = /^([A-Z][A-Za-z0-9]* \([a-z][a-z0-9]*\)|[a-z][a-z0-9]* \(optional\))$/;

  function labelOk(label: string): boolean {
    if (label.includes(" + ")) {
      const roles = label.split(" + ");
      // Every role a Title-case token; spaced-out single letters ("O H L C")
      // can't happen — a space inside a role fails ROLE.
      return roles.length >= 2 && roles.every((r) => ROLE.test(r));
    }
    if (/[()]/.test(label)) return false; // shape parentheticals
    if (!NOUN.test(label)) return false;
    // A multi-word noun of single letters is an initialism spaced out — banned.
    const words = label.split(" ");
    return !(words.length > 1 && words.every((w) => w.length === 1));
  }

  it("every frameIn/anyTableIn label parses (roles ' + '-joined, or a plain noun)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const isLambdaFile = /nodes[/\\]tableLambda\.ts$/.test(file);
      for (const [i, line] of codeLines(file).entries()) {
        for (const m of line.matchAll(/(?:frameIn|anyTableIn)\("([^"]*)"/g)) {
          const label = m[1];
          const ok = labelOk(label) || (isLambdaFile && LAMBDA_FORM.test(label));
          if (!ok) offenders.push(`${rel(file)}:${i + 1} "${label}"`);
        }
      }
    }
    expect(offenders, "labels violating the SOCK-14 grammar (rules.md)").toEqual([]);
  });
});
