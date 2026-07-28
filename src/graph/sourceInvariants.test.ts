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
