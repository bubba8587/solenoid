import { describe, it, expect } from "vitest";
import { NODE_EXCEL } from "../../src/graph/nodeExcel";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { NODE_COMPONENTS, componentForNode } from "../../src/graph/nodeRegistry";
import { extractInit } from "../../src/graph/copyPaste";
import { MutableSocket, SolenoidSocket, isDateType, isWildcardRung } from "../../src/graph/sockets";
import { getPassthrough } from "../../src/graph/nodes/passthrough";

// HARD version of the dev-only catalogValidator console warnings (v1.0 audit,
// quality): catalog↔registry drift previously surfaced only as a dev console
// warn nobody reads — which let a fully dead node class (the old NaNode, whose
// menu entry silently built a ConstantNode instead) live in the registry for
// weeks. These assertions fail the build instead.

describe("catalog ↔ registry consistency", () => {
  it("every NODE_EXCEL key resolves to a catalog entry", () => {
    const stale = Object.keys(NODE_EXCEL).filter((type) => !FLAT_CATALOG.has(type));
    expect(stale).toEqual([]);
  });

  it("every registered node class is constructable by some catalog entry", () => {
    // Instantiate each catalog entry once and collect the concrete classes the
    // menu can actually create.
    const constructable = new Set<unknown>();
    for (const entry of FLAT_CATALOG.values()) {
      try {
        constructable.add((entry.create() as object).constructor);
      } catch {
        /* an entry that throws is caught by the next assertion */
      }
    }
    // Registry classes that no catalog entry creates. Allow-list classes that
    // are created by OTHER means than the Add menu — extend WITH A REASON.
    const allowed = new Set<string>([
      // Created by the LOADER for unknown node types (lossless placeholder);
      // deliberately absent from the Add menu.
      "PlaceholderNode",
    ]);
    const dead = NODE_COMPONENTS
      .map(([ctor]) => ctor)
      .filter((ctor) => !constructable.has(ctor) && !allowed.has(ctor.name))
      .map((ctor) => ctor.name);
    expect(dead).toEqual([]);
  });

  // classNameIsType, the uniqueness half. The save format stores
  // `type: n.constructor.name` and the ctor registry maps name → class
  // FIRST-WINS (nodeCtorRegistry) — so two classes sharing a name means every
  // saved instance of the loser reconstructs as the WRONG class: the init
  // fields it doesn't know are ignored, different sockets build, cables that
  // still fit re-attach, and the graph opens looking mostly right while
  // computing something else. No placeholder fires — that path needs an ABSENT
  // type, and a collision is indistinguishable from a hit.
  it("no two catalog classes share a constructor name (classNameIsType)", () => {
    const byName = new Map<string, Set<unknown>>();
    for (const entry of FLAT_CATALOG.values()) {
      let inst: object;
      try { inst = entry.create() as object; } catch { continue; }
      const name = inst.constructor.name;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(inst.constructor);
    }
    const collisions = [...byName].filter(([, ctors]) => ctors.size > 1).map(([n]) => n);
    expect(collisions, `class-name collisions — saves of the losing class reload as the winner: ${collisions.join(", ")}`).toEqual([]);
  });

  // classNameIsType, the SHAPE half. A persisted `type` must be a real class name
  // — a Capitalized identifier of some length — never a minifier's single letter.
  // This runs UNMINIFIED so it can't see a bad production build directly (that is
  // scripts/check-dist-classnames.mjs on postbuild); it pins the source invariant
  // so a class deliberately named `A`, or an accidental non-identifier, fails here.
  it("every catalog class name is a real identifier, >= 4 chars (classNameIsType)", () => {
    const bad: string[] = [];
    for (const entry of FLAT_CATALOG.values()) {
      let name: string;
      try { name = (entry.create() as object).constructor.name; } catch { continue; }
      if (name.length < 4 || !/^[A-Z][A-Za-z0-9]+$/.test(name)) bad.push(name);
    }
    expect([...new Set(bad)], `class names that look mangled or malformed: ${[...new Set(bad)].join(", ")}`).toEqual([]);
  });

  // sinkRunButtonOnly's persistence half: an external-effect arm flag must never
  // round-trip — every load (save reopen, paste, placeholder restore) starts
  // disarmed, so opening a shared file can never write to YOUR disk. The two
  // sink families pin this per-class (sink.test.ts / obsidian.test.ts); this is
  // the catalog-wide quantifier, so a FUTURE sink whose author whitelists the
  // flag (or names it `enabled` on a new node) fails here by name.
  it("no catalog class persists an `enabled` arm flag, and none constructs armed (sinkRunButtonOnly)", () => {
    const offenders: string[] = [];
    for (const entry of FLAT_CATALOG.values()) {
      let inst: Record<string, unknown> & object;
      try { inst = entry.create() as typeof inst; } catch { continue; }
      if (inst.enabled === true) offenders.push(`${inst.constructor.name} constructs ARMED (enabled=true)`);
      const init = extractInit(inst as never) as Record<string, unknown>;
      if ("enabled" in init) offenders.push(`${inst.constructor.name} persists \`enabled\` — an armed sink would round-trip through a shared file`);
    }
    expect(offenders, offenders.join("\n  ")).toEqual([]);
  });

  // portOwnsSocket: an adopting port OWNS its socket instance — the class doc says it
  // outright ("One instance per port, never shared — a retype must not leak
  // across cards"). A module-level shared MutableSocket means wiring a date into
  // one card retypes ANOTHER card's port; that card then coerces under the wrong
  // type and answers a plausible number (the Input Switch's old shared
  // valueSocket). Two instances of every class: no MutableSocket may appear in
  // both.
  it("no two instances of a class share a mutable socket (portOwnsSocket)", () => {
    const offenders: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let a: object, b: object;
      try { a = entry.create() as object; b = entry.create() as object; } catch { continue; }
      const socketsOf = (n: object) =>
        [...Object.values((n as { inputs?: object }).inputs ?? {}), ...Object.values((n as { outputs?: object }).outputs ?? {})]
          .map((p) => (p as { socket?: unknown } | undefined)?.socket)
          .filter((s): s is MutableSocket => s instanceof MutableSocket);
      const setA = new Set(socketsOf(a));
      if (socketsOf(b).some((s) => setA.has(s))) offenders.push(`${type} (${a.constructor.name})`);
    }
    expect(offenders, `classes sharing a MutableSocket across instances — adoption leaks between cards:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  // trueanyNeedsPassthrough: a class with a `trueany` OUTPUT either declares passthrough() (so
  // the four derived-type consumers — adoption, unit flow, the display walk,
  // coerceInputs' keep-tags boundary — can resolve it) or is sanctioned with the
  // reason its type resolves another way. An undeclared forwarder's output stays
  // trueany forever: a downstream FC can't key a family, so a date serial
  // renders as its raw number — everything connects, nothing errors, the format
  // is just silently wrong.
  const TRUEANY_OUT_SANCTIONED: Record<string, string> = {
    NaNode: "the deliberate #N/A producer — its output IS the error (errorOnlyOutput), no type to forward",
    ConduitNode: "lane types resolve through conduitTrace, the conduit's own resolution system",
    FormatControllerNode: "the FC is the RESOLVER — fcReconcile drives its sockets",
    CompositeNode: "boundary port adoption runs in the composite's own sync pass",
    CompositeInputNode: "a composite boundary marker — typed by the composite's sync pass",
    XLookupNode: "a genuinely unknowable producer — the result type depends on the looked-up data",
    UnnestNode: "result rank depends on the input's nesting depth (a Frame at depth 1, a Cube at depth >=2)",
  };
  it("every class with a trueany output declares passthrough() (or is sanctioned, with a reason) (trueanyNeedsPassthrough)", () => {
    const offenders: string[] = [];
    const sanctionedSeen = new Set<string>();
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let inst: object;
      try { inst = entry.create() as object; } catch { continue; }
      const hasTrueanyOut = Object.values((inst as { outputs?: object }).outputs ?? {})
        .some((p) => (p as { socket?: { dataType?: string } } | undefined)?.socket?.dataType === "trueany");
      if (!hasTrueanyOut) continue;
      const cls = inst.constructor.name;
      if (cls in TRUEANY_OUT_SANCTIONED) { sanctionedSeen.add(cls); continue; }
      if (getPassthrough(inst as never).length === 0) offenders.push(`${type} (${cls})`);
    }
    expect(
      offenders,
      `trueany outputs with no passthrough() declaration (trueanyNeedsPassthrough) — the port stays ` +
      `untyped forever and downstream FCs silently format wrong. Declare the spec, or ` +
      `add the class to TRUEANY_OUT_SANCTIONED with the reason:\n  ` + offenders.join("\n  "),
    ).toEqual([]);
    // The sanction list stays honest: every entry still exists in the catalog
    // with a trueany output and no declaration.
    const stale = Object.keys(TRUEANY_OUT_SANCTIONED).filter((c) => !sanctionedSeen.has(c));
    expect(stale, `sanctioned classes that no longer have an undeclared trueany output — drop:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  // literalsIffEditable, the ONLY-IF direction. Declaring `literals` / `stringLiterals` is
  // the class's statement that its card edits those values inline, and the
  // persistence load gate trusts it: a save's maps are restored onto any
  // declaring class. A class that declares a map its card never edits therefore
  // lets a hand-authored save inject a value the user can never see or change.
  // (The IF direction — a typeable list input implies a stringLiterals
  // declaration — is in coerceInputs.test.ts.)
  //
  // "The card edits it" is checked against the component function's source: it
  // renders the generic inline editor (InlineInputs) or touches the maps itself
  // (`data.literals[...]` / `data.stringLiterals[...]` — the bespoke draw-your-
  // data and toggle cards). Crude, but exactly as crude as the failure mode: an
  // editing surface is a reference to the map or the editor by name.
  it("no class declares a literal map its component never edits (literalsIffEditable only-if)", () => {
    const offenders: string[] = [];
    const seen = new Set<unknown>();
    for (const entry of FLAT_CATALOG.values()) {
      let inst: Record<string, unknown> & object;
      try { inst = entry.create() as typeof inst; } catch { continue; }
      const ctor = inst.constructor;
      if (seen.has(ctor)) continue;
      seen.add(ctor);
      const declared = (["literals", "stringLiterals"] as const)
        .filter((k) => typeof inst[k] === "object" && inst[k] !== null);
      if (declared.length === 0) continue;
      const comp = componentForNode(inst);
      const src = comp ? String(comp) : "";
      if (!/InlineInputs|ExtensibleInputs|[lL]iterals/.test(src)) {
        offenders.push(`${ctor.name} (leaf "${entry.type}") declares ${declared.join(" + ")}`);
      }
    }
    expect(
      offenders,
      `These classes declare a literal map their component never edits (literalsIffEditable): ` +
      `the load gate will restore saved values onto them that the card cannot show. ` +
      `Drop the declaration, or give the card an editing surface:\n  ` +
      offenders.join("\n  "),
    ).toEqual([]);
  });

  it("every catalog entry constructs without throwing", () => {
    const broken: string[] = [];
    for (const [type, entry] of FLAT_CATALOG) {
      try {
        entry.create();
      } catch {
        broken.push(type);
      }
    }
    expect(broken).toEqual([]);
  });

  it("every registered class resolves to ITS OWN component (subclass shadowing)", () => {
    // ImportObsidianNode extends NoteNode: with a plain first-match instanceof
    // scan, whichever entry came first won — an Imported Note once rendered as a
    // plain Note. componentForNode's exact-constructor pass makes entry order
    // irrelevant for registered classes; this pins that for every future subclass.
    const wrong = NODE_COMPONENTS
      .filter(([ctor, component]) => componentForNode(Object.create(ctor.prototype) as object) !== component)
      .map(([ctor]) => ctor.name);
    expect(wrong).toEqual([]);
  });
});

// A port that HOLDS a date is typed as one — per dateValuedPortIsDateTyped. Swept over
// the whole catalog because the convention is only worth anything if it is total: it
// already held on all 60-odd date ports in the finance and date families, and the two
// that broke it (XIRR/XNPV `dates`, typed numlist and labelled "Date serials") were
// invisible precisely because everything around them was right.
describe("date-valued ports are typed date", () => {
  it("no catalog port whose label names a date sits on a non-date socket", () => {
    // Anchored to the END of the label so a numeric port that merely mentions time
    // ("Start period", "Coupon rate", "Days") is not swept in. A port whose label ends
    // in "date"/"dates" is claiming to carry one.
    //
    // WILDCARD rungs are exempt, and the exemption is the point of the rule rather
    // than a hole in it: the defect is a port that COMMITS to a concrete non-date type
    // while carrying a date. A wildcard has committed to nothing — a formula-preset
    // node ("ROUNDUP(MONTH(date)/3,0)") names its free variables as ports, so `date`
    // there is an expression variable on the generic socket, not a mistyped date port.
    const CLAIMS_DATE = /\bdates?$/i;
    const broken: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let n: unknown;
      try { n = entry.create(); } catch { continue; }
      const node = n as Record<string, Record<string, { label?: string; socket?: unknown }> | undefined>;
      for (const dir of ["inputs", "outputs"] as const) {
        for (const [key, port] of Object.entries(node[dir] ?? {})) {
          const label = port?.label ?? "";
          if (!CLAIMS_DATE.test(label.trim())) continue;
          const sock = port?.socket;
          if (!(sock instanceof SolenoidSocket)) continue;
          if (isDateType(sock.dataType) || isWildcardRung(sock.dataType)) continue;
          broken.push(`${type}.${dir}.${key} "${label}" is ${sock.dataType}`);
        }
      }
    }
    expect(broken, broken.join("; ")).toEqual([]);
  });
});
