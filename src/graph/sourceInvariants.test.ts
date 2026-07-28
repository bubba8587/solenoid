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
