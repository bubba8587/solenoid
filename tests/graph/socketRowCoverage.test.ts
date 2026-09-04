import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";

// A socket with no ROW has no `top` of its own: NodeSocket falls back to
// `--out-socket-top, 50%`, so every dot on that side lands on the SAME pixel.
// One visible dot, N stacked handles, and the ones underneath are unreachable —
// which is how Geocode shipped with lat/lon/timezone/label on one point and
// Weather with lat/lon declared but nothing to plug into (2026-09-04). The rule
// is therefore about the RENDERER, not the socket: a side carrying more than one
// socket must render each on its own measured row.
//
// This is the completeness half — the vitest env is `node`, so no component
// renders here. The scan pairs each catalog class to its component via
// nodeRegistry and reads that component's SOURCE.

const SRC = path.resolve(__dirname, "../../src/graph");

/** Per-row socket renderers: each gives its dot a measured `top` of its own. */
// EquationVarRow / EquationOutRow are the acausal card's own measured rows — they
// resolve a `top` per row and hand it to NodeSocket, which is the same guarantee.
const ROW_RENDERERS =
  /InlineInputs|InlineOutputRows|MeasuredSocketRow|CollapsedInputPill|ExtensibleInputs|PairedExtensibleInputs|EquationVarRow|EquationOutRow/;

/** Cards that place their own dots and own the geometry, with the reason. */
const SANCTIONED: Record<string, string> = {
  ConduitComponent: "a sub-flow FACE: it lays its own lane handles out at computed x/y along the boundary (React Flow surface contract), so there are no rows to measure",
  SvgPickerComponent: "the two outputs are alternatives, not a pair — the chart and layer sockets render in mutually exclusive branches, one dot at a time",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every `export function Name(…) { … }` body in components/, by name. */
function componentBodies(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  for (const file of walk(path.join(SRC, "components"))) {
    const s = fs.readFileSync(file, "utf8");
    for (const m of s.matchAll(/export function (\w+)\s*(?:<[^>]*>)?\s*\(/g)) {
      // Step over the PARAMETER list first — a destructured `({ data, emit })` opens a
      // brace of its own, and matching that one reads an empty body for every component.
      let i = m.index! + m[0].length - 1, depth = 0;
      for (; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")" && --depth === 0) break;
      }
      const open = s.indexOf("{", i);
      if (open < 0) continue;
      depth = 0;
      let j = open;
      for (; j < s.length; j++) {
        if (s[j] === "{") depth++;
        else if (s[j] === "}" && --depth === 0) break;
      }
      out.set(m[1], { file: path.relative(SRC, file).replace(/\\/g, "/"), body: s.slice(open, j + 1) });
    }
  }
  return out;
}

/** class name → component name, read off the nodeRegistry rows. */
function registryPairs(): Map<string, string> {
  const reg = fs.readFileSync(path.join(SRC, "nodeRegistry.ts"), "utf8");
  const out = new Map<string, string>();
  for (const m of reg.matchAll(/\[\s*(\w+Node)\s*,\s*(?:comp\()?\s*(\w+Component)\s*[),]/g)) out.set(m[1], m[2]);
  return out;
}

/** Does this component (or a component it DELEGATES its card to — Tvm hands its whole
 *  body to Equation) render per-row sockets? */
function rendersRows(name: string, bodies: Map<string, { file: string; body: string }>, seen = new Set<string>()): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const entry = bodies.get(name);
  if (!entry) return false;
  if (ROW_RENDERERS.test(entry.body)) return true;
  for (const m of entry.body.matchAll(/<(\w+Component)\b/g)) {
    if (rendersRows(m[1], bodies, seen)) return true;
  }
  return false;
}

describe("socketRows — a side with more than one socket renders one row per socket", () => {
  it("no catalog node stacks its sockets on a single point", () => {
    const bodies = componentBodies();
    const pairs = registryPairs();
    const offenders: string[] = [];
    const seen = new Set<string>();
    const sanctionedSeen = new Set<string>();

    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let inst: object;
      try { inst = entry.create() as object; } catch { continue; }
      const cls = inst.constructor.name;
      if (seen.has(cls)) continue;
      seen.add(cls);
      const n = (side: "inputs" | "outputs") =>
        Object.keys((inst as Record<string, object>)[side] ?? {}).length;
      if (n("inputs") < 2 && n("outputs") < 2) continue;
      const compName = pairs.get(cls);
      if (!compName) continue; // custom chrome with no registry row — nothing to read
      const comp = bodies.get(compName);
      if (!comp) continue; // not an `export function` (a memo/const wrapper)
      if (compName in SANCTIONED) { sanctionedSeen.add(compName); continue; }
      if (rendersRows(compName, bodies)) continue;
      offenders.push(`${type} (${cls} → ${compName}, ${comp.file}) — ${n("inputs")} in, ${n("outputs")} out`);
    }

    expect(
      offenders,
      "These components render more than one socket on a side with no per-row renderer, " +
      "so every dot on that side stacks on `--out-socket-top` (one visible handle, the rest " +
      "unreachable). Render the rows with InlineInputs / InlineOutputRows / MeasuredSocketRow:\n  " +
      offenders.join("\n  "),
    ).toEqual([]);

    // A sanction that no longer names a real component is a stale exemption.
    for (const name of Object.keys(SANCTIONED)) {
      expect(sanctionedSeen.has(name), `SANCTIONED lists ${name}, which no catalog node reaches any more — drop the entry`).toBe(true);
    }
  });
});
