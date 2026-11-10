// [[B12]] losslessSaves, [[save-format#The capture is a fixed point, and plain JSON]], [[save-format#Every field is persisted or deliberately transient]]
import { describe, it, expect } from "vitest";
import type { GraphNode } from "../../src/graph/graphModel";
import { FLAT_CATALOG } from "../../src/graph/catalogUtils";
import { extractInit, INIT_FIELD_ORDER, INIT_EXTRA_FIELD_ORDER } from "../../src/graph/nodeInit";



type AnyNode = Record<string, unknown>;

function rebuild(n1: GraphNode): GraphNode {
  const Ctor = n1.constructor as new (init?: Record<string, unknown>) => GraphNode;
  const n2 = new Ctor(extractInit(n1));
  // The load and paste paths restore the literal maps after construction; mirror that.
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
      let n1: GraphNode;
      try { n1 = entry.create() as GraphNode; } catch { continue; } // constructability is catalogRegistry.test's job
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
      let n1: GraphNode;
      try { n1 = entry.create() as GraphNode; } catch { continue; }
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


describe("everything extractInit captures survives a JSON round trip", () => {
  it("JSON.parse(JSON.stringify(init)) equals init for every catalog node", () => {
    const broken: string[] = [];
    for (const [type, entry] of [...FLAT_CATALOG.entries()]) {
      let n1: GraphNode;
      try { n1 = entry.create() as GraphNode; } catch { continue; }
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

describe("[[B12]] losslessSaves: a grown row keeps the socket order a reload rebuilds", () => {
  it("every row-growing catalog node reloads with its live input order", () => {
    const moved: string[] = [];
    for (const [type, entry] of [...FLAT_CATALOG.entries()]) {
      let n: GraphNode;
      try { n = entry.create() as GraphNode; } catch { continue; }
      const a = n as unknown as { addValueInput?: () => void; addValuePair?: () => void };
      const grow = a.addValuePair ?? a.addValueInput;
      if (typeof grow !== "function") continue;
      grow.call(n);
      grow.call(n);
      const live = Object.keys(n.inputs);
      const back = Object.keys(rebuild(n).inputs);
      if (JSON.stringify(live) !== JSON.stringify(back)) moved.push(`${type}: live ${live.join(",")} / reloaded ${back.join(",")}`);
    }
    expect(moved).toEqual([]);
  });
});

// Literal keys share names with init fields (Pad Text's `width` input beside its card width), so the maps stay out of init.
describe("literal values never enter init", () => {
  it("no catalog node's init carries a literal-only key or a literal's value over a field", () => {
    const leaked: string[] = [];
    for (const [type, entry] of [...FLAT_CATALOG.entries()]) {
      let n: GraphNode;
      try { n = entry.create() as GraphNode; } catch { continue; }
      const a = n as unknown as AnyNode;
      const lits = { ...((a.literals as object) ?? {}), ...((a.stringLiterals as object) ?? {}) } as Record<string, unknown>;
      for (const k of Object.keys(lits)) {
        if (k === "valueKeys") continue;
        const init = extractInit(n);
        if (!(k in init)) continue;
        if (!(k in a) || init[k] !== a[k]) leaked.push(`${type}.${k}`);
      }
    }
    expect(leaked).toEqual([]);
  });
});



describe("[[B12]] losslessSaves — every own field is persisted or deliberately transient", () => {
  // extractInit's BESPOKE extras: object-valued fields captured by dedicated
  // blocks inside extractInit rather than the flat whitelist (deep-copy /
  // filtering semantics). Kept in sync by the honesty check below.
  const BESPOKE_EXTRAS = new Set([
    "varDescriptions", "varUnits", "inputPorts", "outputPorts", "scenarios", "dataTableValues",
    "goalSeek", "monteCarlo", "uncertainty", "distribution", "bindings",
  ]);
  const RETE_BASE = new Set(["id", "inputs", "outputs", "controls"]);

  /** name → why this field must NOT persist. Grouped by mechanism. */
  const DELIBERATELY_TRANSIENT: Record<string, string> = {
    rowKeys: "Edit Frame's row keys as its body last read them, for its popup; the body reads them again from the table each run",
    editStatus: "Edit Frame's status of each edit on the last run, for its list; the body works it out again each run",
    settled: "Edit Frame's edits its body found the table now gives, which its coreWatched drops from cellEdits",
    pairPlaceholders: "class-constant muted text for an empty pair field; never a value",
    cleanSource: "The SVG Picker's memo of the last scrubbed markup; stringLiterals.source holds the persisted text ([[C103]])",
    columnPicks: "A Note's frame column picks from the Solenoid Properties plugin's data; the vault is the source, Import Obsidian Note re-reads them with the note ([[C107]])",
    nestedPicks: "A Note's nested cube-table picks from the Solenoid Properties plugin's data, this note's own; the vault is the source, Import Obsidian Note re-reads them with the note ([[D90]])",
    resolved: "Write Tasks' Preview resolutions; re-derived by the next Preview, meaningless across loads",
    resolvedPath: "Write to Obsidian's last-resolved target path; re-read from the `path` input/literal on every compute",
    templateVars: "Report's last Knap render variables, for the overlay's live preview; rebuilt from the cables on every compute",
    lastWritten: "Write to Obsidian's last written note path, for Open in Obsidian; a load has written nothing",
    planRows: "Write Tasks' plan, derived from the cached rows on every compute",
    plannedKeys: "Write to Obsidian's Keys text as of its last plan, so a Keys edit re-plans; re-read from the literal on every compute",
    plannedTasks: "Whether Write to Obsidian's last plan was for its Tasks target, so a change of target re-plans; follows the saved target",
    taskRows: "Write to Obsidian's Tasks rows as last planned from the wired rows; rebuilt on every compute",
    readTypes: "Local File's column types as the file read them, so picking one again drops the pick; re-read with the file",
    planNotes: "Local File's list of what an MSPDI read could not carry over, for the status line; re-read with the file",
    held: "Delayed Pass's value from the last recalculation; a reopened document starts from Start ([[D118]])",
    stepCount: "Delayed Pass's count of recalculations since it was added, opened or reset, for the card",
    droppedLoops: "Sankey's count of flows dropped for closing a loop, for the card; re-derived from the input on every compute",
    // ── derived from persisted fields at construction / _rebuild ──
    varNames: "extracted from expr",
    captured: "derived from expr − params",
    lambdaSig: "derived from the host's lambda config",
    nextCondId: "counter re-derived from live row keys",
    nextInputId: "counter re-derived from live row keys", nextPairId: "counter re-derived from live row keys", nextKeyId: "counter re-derived from live row keys",
    effectiveMin: "derived from literals", effectiveMax: "derived from literals", effectiveStep: "derived from literals",
    // ── recomputed from inputs every engine pass ──
    chartOptions: "parsed per data() from the persisted options input/literal",
    sourceColumns: "detected from the input frame per compute",
    describeTiles: "the Dashboard tiles Describe's body shows per compute, kept beside its summary frame",
    defVars: "the definition's variables/params, re-stashed per compute for the binding pickers",
    rawInputs: "the pass's raw wired values (chart/lookup diagnostics)",
    noWidenInputs: "coercion rank-widening opt-out set (XLOOKUP source); constructed, not persisted",
    seenError: "per-pass error latch",
    violations: "per-pass check results", results: "per-pass sweep results",
    cachedHolds: "per-pass hold state", solvedFor: "per-pass solve marker",
    solvedByRow: "Triangle Solver's per-row solve marker, for the figure",
    row: "Triangle Solver's shown row; view state, as a scroll position is",
    lastRank: "Series: SEQUENCE list↔matrix runtime rank tracker",
    columnMove: "FILTER: which way the body says the Column socket goes, re-derived each compute",
    axesMove: "INDEX: the axes the body says the sockets go to, re-derived each compute",
    varsMove: "Template: the placeholder inputs the body found, re-derived each compute",
    syntaxError: "Script: re-derived from expr by _rebuild",
    // ── FC / unit adoption state, re-derived by the reconcile passes ──
    forwarding: "re-derived by fcReconcile each pass", lockedByConvert: "re-derived by fcReconcile each pass",
    unitLocked: "re-derived by fcReconcile each pass", dictatedFromUnit: "re-derived by fcReconcile each pass",
    adoptedUnit: "The unit the Format Controller's last compute settled on, which it writes to `unit`; re-derived on every compute",
    inheritedAnnotation: "the upstream format the `—` pick carries; re-resolved in refreshAnnotation each pass",
    matches: "Geocode's last-fetch matches for the card's pick list; re-fetched, never saved",
    imposesUp: "re-derived from the unit config", imposesDown: "re-derived from the unit config",
    // ── [[B18]] safeToShare: sinks always load disarmed ──
    enabled: "safeToShare arm flag — every load starts disarmed by design",
    status: "sink run feedback (session)", statusMessage: "sink run feedback (session)",
    // ── async fetch/session state ──
    inflight: "in-flight fetch handle", inflightKey: "fetch dedupe key", lastKey: "fetch dedupe key",
    dataUrl: "image bytes stay OUT of the save (base64 bloat); assetPath persists and re-hydrates",
    // ── drill-in markers re-stamped by the host composite from ITS persisted config ──
    externallyWired: "re-stamped by the host composite", goalDriver: "re-stamped by the host composite",
    modeNote: "re-stamped by the host composite", solvedValue: "re-stamped by the host composite",
    goalTarget: "re-stamped from the host's persisted goalSeek",
    // ── composite runtime (the CONFIG persists via extras; these are run state) ──
    goalSeekResult: "run result", simLastSteps: "run telemetry", lastSolveKey: "solve dedupe key", lastPassKey: "the held plain pass's key (session)",
    solveRequested: "run trigger", solveInsideOnly: "drill-in run scope (session)",
    aroundSolving: "solve context from the composite around (during a pass)", aroundMultiRun: "multi-run context from the composite around (during a pass)", unsettled: "last Solve outran its fetches (session)",
    lastByRowCapTotal: "By-Row cap-warning edge-detect state (session)",
    byRowLastRuns: "how many passes the last By-Row run made, for the card's note; found again on the next run",
    adoptedSeries: "whether the Composite's output types were last adopted for one value per pass; found again on the first pass",
    lastRelativeText: "the relative phrase a date Value Input's body last read, read back for its shift alert (session)",
    lastRelativeSerial: "the day that phrase last landed on (session)",
    stale: "recomputed staleness", internalEditor: "the live internal editor and engine",
    internalEngine: "the live internal editor and engine", internalPositions: "runtime mirror; positions persist via snapshotInternal",
    internalEditSeq: "edit counter (session)",
    runSeq: "data() invocation counter the open drill-in re-renders off (session)",
    // ── live socket instances / class declarations ──
    outSocket: "socket instance", valueSocket: "socket instance",
    passthrough: "the passthrough() declaration (a class-field function)",
    pairLabels: "readonly row-label declaration", errorOnlyOutput: "class-constant declaration",
    unitAware: "class-constant declaration (perInputUnitBlind)",
    ownsListLiterals: "class-constant declaration: List Input reads its own typed rows ([[C58]] tableInputRawText)",
    entryByOp: "Value Input's typed text per op this session, restored on switching back; only the shown op's text is saved ([[C28]] literalsIffEditable)",
    cachedSource: "List Input's typed text per item, for the popup's Source view; re-split from stringLiterals on every compute",
    // ── runtime edge-detection ([[D79]] effectsEdgeTriggered) ──
    alertKey: "effectsEdgeTriggered: the status the body last read, which raises an alert on a change",
    alertMessage: "effectsEdgeTriggered: what that status fires, shown by the body",
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
      `Unclassified node fields ([[B12]] losslessSaves): each must either persist (whitelist / ` +
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

// ─── [[save-format#What a save deliberately omits]]: the size-owner set ──────────────────

describe("[[B12]] losslessSaves — the size-owner set is exactly the declared list", () => {
  const SIZE_OWNERS = new Set([
    "note", "image", "svg", "import-obsidian",   // annotation surfaces — user-dragged frames
    "composite", "pipeline",                     // the composite card (pipeline = its preset)
    "group",                                     // the group rectangle IS its size
    "report", "presentation", "session-history", // overlay/host cards with dragged bodies
  ]);

  it("exactly the declared classes re-consume persisted width/height", () => {
    const adopts: string[] = [];
    const shouldButDoesnt: string[] = [];
    for (const [type, entry] of FLAT_CATALOG.entries()) {
      let inst: GraphNode;
      try { inst = entry.create() as GraphNode; } catch { continue; }
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
      `SIZE_OWNERS ([[B12]] losslessSaves) — declare them (is the size a user gesture?), ` +
      `or stop consuming the init`,
    ).toEqual([]);
    expect(
      shouldButDoesnt,
      `These declared SIZE_OWNERS no longer re-consume init.width/height — ` +
      `the user's drag resets on reload (the asofDirection class of bug)`,
    ).toEqual([]);
  });
});
