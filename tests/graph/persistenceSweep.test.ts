import { describe, it, expect } from "vitest";
import type { ClassicPreset } from "rete";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { extractInit, INIT_FIELD_ORDER, INIT_EXTRA_FIELD_ORDER } from "../../src/graph/copyPaste";

// Catalog-wide persistence fixed-point sweep (v1.0 audit finding 38): node
// state survives save/load ONLY if extractInit captures it AND the constructor
// re-applies it. A field missed on either side silently drops on reload with
// nothing to catch it — this sweep is the net. For every catalog entry:
//   init₁ = extractInit(node)         (what a save captures)
//   node₂ = new Ctor(init₁) + literal-map restore (what a load rebuilds)
//   init₂ = extractInit(node₂)        (what the NEXT save would capture)
// and init₂ must equal init₁ — a fixed point. Then flip every boolean and
// perturb every literal to prove non-default values survive too.

type AnyNode = Record<string, unknown>;

function rebuild(n1: ClassicPreset.Node): ClassicPreset.Node {
  const Ctor = n1.constructor as new (init?: Record<string, unknown>) => ClassicPreset.Node;
  const n2 = new Ctor(extractInit(n1));
  // The load/paste path restores the literal maps after construction
  // (copyPaste.cloneNode / persistence) — mirror that.
  const a = n1 as unknown as AnyNode, b = n2 as unknown as AnyNode;
  if (a.literals && typeof a.literals === "object") b.literals = { ...(a.literals as object) };
  if (a.stringLiterals && typeof a.stringLiterals === "object") b.stringLiterals = { ...(a.stringLiterals as object) };
  return n2;
}

// Fields a constructor legitimately normalizes (clamps/derives), so a blind
// perturbation is expected NOT to round-trip. Add entries WITH A REASON.
const PERTURB_SKIP = new Set<string>([
  // GroupNode derives its label from `title`; NodeShell titles feed `label`.
  "label",
]);

describe("persistence fixed-point sweep (every catalog node)", () => {
  const entries = [...FLAT_CATALOG.entries()];

  it("extractInit is a fixed point through one construct cycle", () => {
    const broken: string[] = [];
    for (const [type, entry] of entries) {
      let n1: ClassicPreset.Node;
      try { n1 = entry.create() as ClassicPreset.Node; } catch { continue; } // constructability is catalogRegistry.test's job
      try {
        const init1 = extractInit(n1);
        const init2 = extractInit(rebuild(n1));
        expect(init2, `catalog type "${type}"`).toEqual(init1);
      } catch (e) {
        broken.push(`${type}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("perturbed booleans and literals survive the cycle", () => {
    const broken: string[] = [];
    for (const [type, entry] of entries) {
      let n1: ClassicPreset.Node;
      try { n1 = entry.create() as ClassicPreset.Node; } catch { continue; }
      const a = n1 as unknown as AnyNode;
      // Flip every captured boolean own-field.
      for (const key of Object.keys(a)) {
        if (PERTURB_SKIP.has(key)) continue;
        if (typeof a[key] === "boolean") a[key] = !a[key];
      }
      // Perturb the literal maps (free-form by definition).
      if (a.literals && typeof a.literals === "object") {
        const lits = a.literals as Record<string, number>;
        for (const k of Object.keys(lits)) lits[k] = (lits[k] ?? 0) + 7;
      }
      if (a.stringLiterals && typeof a.stringLiterals === "object") {
        const lits = a.stringLiterals as Record<string, string>;
        for (const k of Object.keys(lits)) lits[k] = `${lits[k] ?? ""}~X`;
      }
      try {
        const init1 = extractInit(n1);
        const init2 = extractInit(rebuild(n1));
        expect(init2, `catalog type "${type}" (perturbed)`).toEqual(init1);
      } catch (e) {
        broken.push(`${type}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("varDescriptions — captured, but only for LIVE variables", () => {
  it("keeps live-var descriptions and drops orphans / blanks", async () => {
    const { ExpressionNode } = await import("../../src/graph/nodes/expression");
    const n = new ExpressionNode({ expr: "a * b" });
    n.varDescriptions = { a: "first", b: "  ", gone: "stale from a since-removed var" };
    const init = extractInit(n) as { varDescriptions?: Record<string, string> };
    expect(init.varDescriptions).toEqual({ a: "first" }); // b blank + gone orphan dropped
    // No descriptions at all → the field is omitted (not an empty object).
    const bare = new ExpressionNode({ expr: "x" });
    expect((extractInit(bare) as { varDescriptions?: unknown }).varDescriptions).toBeUndefined();
  });
});

// ─── plainJsonInit's file half: everything extractInit captures is JSON-plain ─────
// The fixed-point sweep above compares LIVE objects, so a Map/Set/class-instance
// config field passes it perfectly ({} equals {} on both sides) while the FILE
// silently empties it: the save path stringifies each init field
// (textForm.ts) and {...aMap} is {}, JSON.stringify(Infinity) is null. One line
// per node closes the seam between "the object round-trips" and "the file
// round-trips".
describe("everything extractInit captures survives a JSON round trip", () => {
  it("JSON.parse(JSON.stringify(init)) equals init for every catalog node", () => {
    const broken: string[] = [];
    for (const [type, entry] of [...FLAT_CATALOG.entries()]) {
      let n1: ClassicPreset.Node;
      try { n1 = entry.create() as ClassicPreset.Node; } catch { continue; }
      try {
        const init = extractInit(n1);
        expect(JSON.parse(JSON.stringify(init)), `catalog type "${type}"`).toEqual(init);
      } catch (e) {
        broken.push(`${type}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      }
    }
    expect(broken, `init fields that don't survive JSON (a Map/Set/Infinity config silently empties in the save):\n  ${broken.join("\n  ")}`).toEqual([]);
  });
});

// ─── everyFieldClassified: the catalog-wide transient-field triage ───────────────────────
// The fixed-point sweep above proves WHITELISTED fields round-trip; it is blind
// to a field the whitelist never captured (both sides omit it identically). This
// triage closes that blindness: every OWN field of every catalog node is either
// PERSISTED (the whitelist, the literal maps, or one of extractInit's bespoke
// extras blocks) or listed in DELIBERATELY_TRANSIENT with the reason it must NOT
// persist. A new field that is neither fails by name — the author decision the
// field's writer skipped.
//
// The triage's first run (2026-07-28) found ONE real bug in ~169 fields:
// `asofDirection` — a user-facing as-of join dropdown the whitelist never
// captured, silently resetting to "backward" on every reload. Now whitelisted,
// pinned below.

describe("everyFieldClassified — every own field is persisted or deliberately transient", () => {
  // extractInit's BESPOKE extras: object-valued fields captured by dedicated
  // blocks inside extractInit rather than the flat whitelist (deep-copy /
  // filtering semantics). Kept in sync by the honesty check below.
  const BESPOKE_EXTRAS = new Set([
    "varDescriptions", "inputPorts", "outputPorts", "scenarios", "dataTableValues",
    "goalSeek", "monteCarlo", "uncertainty", "distribution", "bindings",
  ]);
  const RETE_BASE = new Set(["id", "inputs", "outputs", "controls"]);

  /** name → why this field must NOT persist. Grouped by mechanism. */
  const DELIBERATELY_TRANSIENT: Record<string, string> = {
    // ── derived from persisted fields at construction / _rebuild ──
    ast: "compiled from expr", evaluator: "compiled from expr", varNames: "extracted from expr",
    captured: "derived from expr − params", compiled: "compiled from expr/params",
    lambdaSig: "derived from the host's lambda config",
    equation: "parsed from expr", lhsEval: "compiled from expr", rhsEval: "compiled from expr",
    solvers: "derived solver table from expr", nextCondId: "counter re-derived from live row keys",
    nextInputId: "counter re-derived from live row keys", nextPairId: "counter re-derived from live row keys",
    effectiveMin: "derived from literals", effectiveMax: "derived from literals", effectiveStep: "derived from literals",
    // ── recomputed from inputs every engine pass ──
    chartOptions: "parsed per data() from the persisted options input/literal",
    sourceColumns: "detected from the input frame per compute",
    defVars: "the definition's variables/params, re-stashed per compute for the binding pickers",
    rawInputs: "the pass's raw wired values (chart/lookup diagnostics)",
    noWidenInputs: "coercion rank-widening opt-out set (XLOOKUP source); constructed, not persisted",
    shapeError: "per-pass validation state", seenError: "per-pass error latch",
    violations: "per-pass check results", results: "per-pass sweep results",
    cachedHolds: "per-pass hold state", solvedFor: "per-pass solve marker",
    solvedKeys: "per-pass solve marker", lastResultRank: "anydataWildcard runtime rank tracker",
    lastResultFamily: "Script: value-typed result socket, runtime family tracker",
    syntaxError: "Script: re-derived from expr by _rebuild",
    // ── FC / unit adoption state, re-derived by the reconcile passes ──
    forwarding: "re-derived by fcReconcile each pass", lockedByConvert: "re-derived by fcReconcile each pass",
    unitLocked: "re-derived by fcReconcile each pass", dictatedFromUnit: "re-derived by fcReconcile each pass",
    inheritedAnnotation: "the upstream format the `—` pick carries; re-resolved in refreshAnnotation each pass",
    matches: "Geocode's last-fetch matches for the card's pick list; re-fetched, never saved",
    imposesUp: "re-derived from the unit config", imposesDown: "re-derived from the unit config",
    // ── freezeVolatilePerCalc volatile roll state (freezes per recalc generation, never saved) ──
    rolls: "freezeVolatilePerCalc frozen rolls", rawRoll: "freezeVolatilePerCalc frozen roll", keys: "freezeVolatilePerCalc frozen shuffle keys",
    lastGen: "freezeVolatilePerCalc generation marker", lastRollGen: "freezeVolatilePerCalc generation marker",
    idx: "promo rotation index (session flavor)",
    // ── sinkRunButtonOnly: sinks always load disarmed ──
    enabled: "sinkRunButtonOnly arm flag — every load starts disarmed by design",
    status: "sink run feedback (session)", statusMessage: "sink run feedback (session)",
    // ── async fetch/session state ──
    inflight: "in-flight fetch handle", inflightKey: "fetch dedupe key", lastKey: "fetch dedupe key",
    ref: "native FrameRef handle (desktop engine)",
    dataUrl: "image bytes stay OUT of the save (base64 bloat); assetPath persists and re-hydrates",
    // ── drill-in markers re-stamped by the host composite from ITS persisted config ──
    externallyWired: "re-stamped by the host composite", goalDriver: "re-stamped by the host composite",
    modeNote: "re-stamped by the host composite", solvedValue: "re-stamped by the host composite",
    goalTarget: "re-stamped from the host's persisted goalSeek",
    // ── composite runtime (the CONFIG persists via extras; these are run state) ──
    goalSeekResult: "run result", simLastSteps: "run telemetry", lastSolveKey: "solve dedupe key",
    solveRequested: "run trigger", solveInsideOnly: "drill-in run scope (session)",
    lastByRowCapTotal: "By-Row cap-warning edge-detect state (session)",
    lastRelativeSerial: "relative Date Input shift-alert edge-detect state (session)",
    lastSampleGen: "Distribution sample form's per-recalc re-roll marker (session)",
    sampleSeed: "Distribution sample form's per-recalc seed (derived from id + gen)",
    stale: "recomputed staleness", internalEditor: "the live internal rete stack",
    internalEngine: "the live internal rete stack", internalPositions: "runtime mirror; positions persist via snapshotInternal",
    internalEditSeq: "edit counter (session)",
    runSeq: "data() invocation counter the open drill-in re-renders off (session)",
    // ── live socket instances / class declarations ──
    outSocket: "socket instance", valueSocket: "socket instance",
    passthrough: "the passthrough() declaration (a class-field function)",
    pairLabels: "readonly row-label declaration", errorOnlyOutput: "class-constant declaration",
    unitAware: "class-constant declaration (perInputUnitBlind)",
    autoLiterals: "class-constant declaration — the VALUES land in literals/stringLiterals, which persist",
    // ── runtime edge-detection (effectsEdgeTriggered) ──
    lastStatusKey: "effectsEdgeTriggered edge state", lastEvalOp: "effectsEdgeTriggered edge state",
    // ── constructor-only tuning knobs: no UI edits them today; whitelist the day one does ──
    step: "AngleDial snap increment — constructor-only, no UI control",
  };

  const persisted = new Set<string>([
    ...INIT_FIELD_ORDER, ...INIT_EXTRA_FIELD_ORDER, "literals", "stringLiterals", ...BESPOKE_EXTRAS,
  ]);

  it("every own field of every catalog node is classified", () => {
    const offenders = new Map<string, string[]>();
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let inst: AnyNode;
      try { inst = entry.create() as unknown as AnyNode; } catch { continue; }
      for (const key of Object.keys(inst)) {
        if (persisted.has(key) || RETE_BASE.has(key)) continue;
        if (/^cached/.test(key)) continue;  // derived display state, by naming convention
        if (/^_/.test(key)) continue;       // private runtime machinery, by naming convention
        if (key in DELIBERATELY_TRANSIENT) continue;
        if (!offenders.has(key)) offenders.set(key, []);
        if (offenders.get(key)!.length < 4) offenders.get(key)!.push(type);
      }
    }
    expect(
      [...offenders.entries()].map(([k, o]) => `${k} (${o.join(", ")})`),
      `Unclassified node fields (everyFieldClassified): each must either persist (whitelist / ` +
      `bespoke extras) or join DELIBERATELY_TRANSIENT with the reason — the ` +
      `asofDirection bug is what an unclassified field looks like.`,
    ).toEqual([]);
  });

  it("no field is claimed by BOTH sides, and every transient entry still exists", () => {
    for (const key of Object.keys(DELIBERATELY_TRANSIENT)) {
      expect(persisted.has(key), `${key} is both persisted and declared transient`).toBe(false);
    }
    const live = new Set<string>();
    for (const [, entry] of FLAT_CATALOG.entries()) {
      try { for (const k of Object.keys(entry.create() as object)) live.add(k); } catch { /* skip */ }
    }
    const stale = Object.keys(DELIBERATELY_TRANSIENT).filter((k) => !live.has(k));
    expect(stale, "transient entries no longer on any node — drop them").toEqual([]);
  });

  it("the triage's found bug stays fixed: as-of join direction round-trips", async () => {
    const { JoinNode } = await import("../../src/graph/nodes/frame");
    const n = new JoinNode({ how: "asof", asofDirection: "forward" });
    const init = extractInit(n) as { asofDirection?: string };
    expect(init.asofDirection).toBe("forward");
    expect((rebuild(n) as unknown as AnyNode).asofDirection).toBe("forward");
  });
});

// ─── observerOwnsSize: width/height dual-use ownership ──────────────────────────────
// `width`/`height` serve two masters: NodeCard's ResizeObserver OWNS them at
// runtime (it overwrites both with measured pixels every layout — the minimap
// silhouette and cable geometry read them), and the persistence whitelist
// captures them for every node. Only the SIZE-OWNER classes — nodes whose box
// is a user-dragged surface, not content-driven — re-consume the persisted
// values in their constructors; for every other class the persisted numbers are
// inert (the class default wins on load, the observer re-measures). Display's
// grip is the third channel: it routes through nodeSizeStore, which persists
// per node id (persistence.ts sn.size) — NOT through these fields.
//
// The MUST: a class with a user size gesture either re-consumes
// init.width/height or routes through nodeSizeStore. This pin keeps the owner
// set conscious — a NEW class that starts adopting (or an owner that stops)
// fails here and must update the list, which is where the "does the user's
// drag survive reload?" question gets asked.

describe("observerOwnsSize — the size-owner set is exactly the declared list", () => {
  const SIZE_OWNERS = new Set([
    "note", "image", "svg", "import-obsidian",   // annotation surfaces — user-dragged frames
    "composite", "query",                        // the composite card (query = its preset)
    "group",                                     // the group rectangle IS its size
    "report", "presentation", "session-history", // overlay/host cards with dragged bodies
  ]);

  it("exactly the declared classes re-consume persisted width/height", () => {
    const adopts: string[] = [];
    const shouldButDoesnt: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let inst: ClassicPreset.Node;
      try { inst = entry.create() as ClassicPreset.Node; } catch { continue; }
      const Ctor = inst.constructor as new (init?: Record<string, unknown>) => AnyNode;
      let probe: AnyNode;
      try { probe = new Ctor({ width: 777, height: 555 }); } catch { continue; }
      const adopted = probe.width === 777 || probe.height === 555;
      if (adopted && !SIZE_OWNERS.has(type)) adopts.push(type);
      if (!adopted && SIZE_OWNERS.has(type)) shouldButDoesnt.push(type);
    }
    expect(
      adopts,
      `These classes now adopt persisted width/height but are not declared ` +
      `SIZE_OWNERS (observerOwnsSize) — declare them (is the size a user gesture?), ` +
      `or stop consuming the init`,
    ).toEqual([]);
    expect(
      shouldButDoesnt,
      `These declared SIZE_OWNERS no longer re-consume init.width/height — ` +
      `the user's drag resets on reload (the asofDirection class of bug)`,
    ).toEqual([]);
  });
});
