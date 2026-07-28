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
  const CONSUMES = /\b(?:isUnitCell|dimOf|magnitudeOf|mulUnits|divUnits|addUnits|subUnits|powUnits|compareUnits|forAggregateUnits|broadcastUnit|anyDimensioned)\s*\(/;
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
