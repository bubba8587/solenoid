// [[C10]] socketLattice, [[socket-lattice#Enforcement]]
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GraphInput } from "../../src/graph/graphModel";
import { canConnect, SOCKET_TYPE_LABELS, SOCKET_COLORS, SolenoidSocket, AdoptiveSocket, type SocketDataType } from "../../src/graph/sockets";
import * as shared from "../../src/graph/nodes/shared";
import { familyOf } from "../../src/graph/formatModel";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { elementFamilyOf, latticeRank, comboOfType } from "../../src/graph/sockets";



const DOC = readFileSync(resolve(__dirname, "../../docs/socket-reference.md"), "utf8");
const ALL = Object.keys(SOCKET_TYPE_LABELS) as SocketDataType[];
const IS_TYPE = new Set<string>(ALL);

/** The per-variant sections, keyed by type: `#### \`number\` — "Number"`. */
function sections(): Map<SocketDataType, string> {
  const marks: { t: SocketDataType; at: number }[] = [];
  for (const m of DOC.matchAll(/^#### `([a-z]+)` —/gm)) {
    if (!IS_TYPE.has(m[1])) throw new Error(`unknown type in heading: ${m[1]}`);
    marks.push({ t: m[1] as SocketDataType, at: m.index! });
  }
  const out = new Map<SocketDataType, string>();
  marks.forEach((mk, i) => out.set(mk.t, DOC.slice(mk.at, marks[i + 1]?.at ?? DOC.length)));
  return out;
}

/** One `**Label:**` bullet's text, up to the next blank line or bold run-in. */
function bullet(body: string, label: string): string {
  const i = body.indexOf(`**${label}:**`);
  if (i < 0) throw new Error(`missing bullet "${label}"`);
  const rest = body.slice(i + label.length + 6);
  const end = rest.search(/\n\s*\n|\n\*\*/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function backticked(chunk: string): SocketDataType[] {
  return [...chunk.matchAll(/`([a-z]+)`/g)].map((m) => m[1]).filter((t): t is SocketDataType => IS_TYPE.has(t));
}

/** Read a bullet as a SET of types. Three shorthands are understood so the prose
 *  can stay readable where a literal 28-item list would not be:
 *    "nothing."                              → {}
 *    "all 31 variants."                      → every type
 *    "all 28 variants other than `a`, `b`."  → complement of {a, b}
 *  Anything else is read as the literal backticked list it contains. A COUNT in a
 *  shorthand is asserted too, so "all 28" can't drift to a wrong number. */
function readSet(chunk: string): Set<SocketDataType> {
  if (/^nothing\.?$/i.test(chunk)) return new Set();
  const other = /^all (\d+) variants? other than (.+)$/i.exec(chunk);
  if (other) {
    const excluded = new Set(backticked(other[2]));
    const set = new Set(ALL.filter((t) => !excluded.has(t)));
    expect(set.size, `"${chunk}" — stated count`).toBe(Number(other[1]));
    return set;
  }
  const all = /^all (\d+) variants?\.?$/i.exec(chunk);
  if (all) {
    expect(ALL.length, `"${chunk}" — stated count`).toBe(Number(all[1]));
    return new Set(ALL);
  }
  return new Set(backticked(chunk));
}

const SECTIONS = sections();

describe("docs/socket-reference.md — every variant is documented", () => {
  it("has exactly one section per socket type", () => {
    expect([...SECTIONS.keys()].sort()).toEqual([...ALL].sort());
  });

  it("states the variant count correctly in the opening", () => {
    const n = /There are \*\*(\d+) socket variants\*\*/.exec(DOC)?.[1];
    expect(Number(n)).toBe(ALL.length);
  });
});

describe("docs/socket-reference.md — the connection lists match canConnect", () => {

  for (const t of ALL) {
    const body = () => SECTIONS.get(t)!;
    const sorted = (s: Iterable<string>) => [...s].sort();

    it(`${t} — accepts from / blocked at the input`, () => {
      const accepts = ALL.filter((src) => canConnect(src, t));
      const blocked = ALL.filter((src) => !canConnect(src, t));
      expect(sorted(readSet(bullet(body(), "Accepts from")))).toEqual(sorted(accepts));
      expect(sorted(readSet(bullet(body(), "Blocked at the input")))).toEqual(sorted(blocked));
    });

    it(`${t} — reaches / blocked at the output`, () => {
      const reaches = ALL.filter((tgt) => canConnect(t, tgt));
      const blocked = ALL.filter((tgt) => !canConnect(t, tgt));
      expect(sorted(readSet(bullet(body(), "Reaches")))).toEqual(sorted(reaches));
      expect(sorted(readSet(bullet(body(), "Blocked at the output")))).toEqual(sorted(blocked));
    });
  }
});

describe("docs/socket-reference.md — the at-a-glance tables match the code", () => {
  /** A row of the glyph table: `| <shape> | <meaning> | \`a\` \`b\` … |`. */
  function glyphRow(shape: string): SocketDataType[] {
    const re = new RegExp(`^\\| ${shape}[^|]*\\|[^|]*\\|([^|]*)\\|$`, "m");
    const m = re.exec(DOC);
    if (!m) throw new Error(`no glyph row for "${shape}"`);
    return backticked(m[1]);
  }

  const SRC = readFileSync(resolve(__dirname, "../../src/graph/components/SocketComponent.tsx"), "utf8");
  const quoted = (s: string) => [...s.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();

  it("the square/split/grid glyph rows match SocketComponent's branches", () => {
    const listTypes = quoted(/const LIST_TYPES = new Set\(\[(.*?)\]\)/s.exec(SRC)![1]);
    const comboKeys = [...(/const COMBO_COLORS[^{]*\{(.*?)\n\};/s.exec(SRC)![1].matchAll(/^ {2}([a-z]+):/gm))].map((m) => m[1]).sort();
    const tableTypes = quoted(/const TABLE_TYPES = new Set\(\[(.*?)\]\)/s.exec(SRC)![1]);

    expect(glyphRow("Filled rounded square").sort()).toEqual(listTypes);
    expect(glyphRow("Two-tone split square").sort()).toEqual(comboKeys);
    expect(glyphRow("Square with a 2×2 grid").sort()).toEqual(tableTypes);
  });

  it("every variant appears in exactly one glyph row", () => {
    const rows = [...DOC.matchAll(/^\| [^|]+\| (?:scalar|strict list|combo[^|]*|matrix|frame|cube|function|chart|document|any rank[^|]*|anything) \|([^|]*)\|$/gm)];
    const seen = rows.flatMap((r) => backticked(r[1]));
    expect(seen.sort()).toEqual([...ALL].sort());
  });

  it("the socket → FC family table matches formatModel.familyOf", () => {
    // The doc spells two families out for readers ("function view-as", "text
    // scale") and marks the wildcards' number family provisional; map back.
    const NAMES: Record<string, string> = {
      "number": "number", "text": "text", "date": "date", "logical": "logical",
      "complex": "complex", "none": "none", "function view-as": "lambda",
      "text scale": "chart", "number (provisional)": "number",
    };
    const documented = new Map<string, string>();
    for (const [, cells, fam] of DOC.matchAll(/^\|([^|]*`[a-z]+`[^|]*)\|([^|]+)\|\s*$/gm)) {
      const key = NAMES[fam.trim()];
      if (key === undefined) continue; // not an FC-family row
      for (const t of backticked(cells)) documented.set(t, key);
    }
    expect([...documented.keys()].sort()).toEqual([...ALL].sort());
    for (const t of ALL) expect(documented.get(t), `FC family of ${t}`).toBe(familyOf(t));
  });

  it("the port-factory table names the real factories in nodes/shared.ts", () => {

    const rows = [...DOC.matchAll(/^\| `([a-z]+)` \| (.+?) \| (.+?) \|$/gm)]
      .filter(([, t]) => IS_TYPE.has(t));
    expect(rows.length, "factory table row count").toBe(ALL.length);

    const names = (cell: string) =>
      [...cell.matchAll(/`([A-Za-z]+)`/g)].map((m) => m[1]);

    for (const [, type, inCell, outCell] of rows) {
      for (const [cell, side] of [[inCell, "in"], [outCell, "out"]] as const) {
        for (const name of names(cell)) {
          const fn = (shared as Record<string, unknown>)[name];
          expect(typeof fn, `${name} is exported from nodes/shared.ts`).toBe("function");
          const port = (fn as (l: string) => { socket?: unknown })("L");
          const socket = port.socket;
          expect(socket, `${name} builds a SolenoidSocket`).toBeInstanceOf(SolenoidSocket);
          const s = socket as SolenoidSocket;
          const declared = s instanceof AdoptiveSocket ? s.base : s.dataType;
          expect(declared, `${name} builds a ${type} port`).toBe(type);
          // The asterisk in the table means "adoptive" — hold it to that.
          const starred = new RegExp(`\`${name}\`\\\\?\\*`).test(cell);
          expect(s instanceof AdoptiveSocket, `${name} adoptive marking`).toBe(starred);
          expect(port instanceof GraphInput ? "in" : "out").toBe(side);
        }
      }
    }
  });

  it("the variants the doc calls gray are exactly the ones sharing --sock-any", () => {
    const gray = ALL.filter((t) => SOCKET_COLORS[t] === "var(--sock-any)");
    expect(gray.sort()).toEqual(["any", "anycombo", "anydata", "anylist", "anytable", "trueany"]);
    expect(DOC).toMatch(/all six wildcards gray/);
  });
});

describe("the catalog obeys the reference's own rule for choosing a rung", () => {

  it("a node with all-combo inputs never declares a strict-list or scalar output", () => {
    const COMBOS = new Set<string>(["numlist", "strcombo", "datecombo", "complexcombo", "logicalcombo"]);
    const STRICT = new Set<string>(["list", "strlist", "datelist", "complexlist", "logicallist"]);
    const declared = (p: unknown) => {
      const sock = (p as { socket?: unknown })?.socket;
      if (!(sock instanceof SolenoidSocket)) return null;
      return sock instanceof AdoptiveSocket ? sock.base : sock.dataType;
    };

    const seen = new Set<string>();
    const offenders: string[] = [];
    for (const [, entry] of FLAT_CATALOG.entries()) {
      let node: { inputs?: object; outputs?: object };
      try { node = entry.create() as typeof node; } catch { continue; }
      const cls = (node as object).constructor.name;
      if (seen.has(cls)) continue;
      seen.add(cls);

      const ins = Object.values(node.inputs ?? {}).map(declared).filter(Boolean) as SocketDataType[];
      const famIns = ins.filter((t) => elementFamilyOf(t));
      if (!famIns.length || !famIns.every((t) => COMBOS.has(t))) continue;

      for (const [key, port] of Object.entries(node.outputs ?? {})) {
        const out = declared(port);
        if (!out || !elementFamilyOf(out)) continue;
        if (STRICT.has(out) || latticeRank(out) === 0) {
          offenders.push(`${cls}.${key}: ${out} (should be ${comboOfType(out)})`);
        }
      }
    }
    // A floor that proves the sweep ran, not a census.
    expect(seen.size, "catalog classes scanned").toBeGreaterThan(260);
    expect(offenders).toEqual([]);
  });
});
