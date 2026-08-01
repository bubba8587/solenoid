// The model-facing grounding spec for authoring Solenoid graphs in the text
// form (backlog "AI command palette", D27/D28): the grammar, the socket-type
// lattice, and the full node inventory — every class with its text-form `Type`
// token, sockets, inline-literal inputs, and op variants. GENERATED from
// `nodeCatalog.ts` and the live classes, never hand-authored (the same
// generate-don't-author move as the Add menu and the Function Reference).
// One emission, two consumers: `scripts/ai-grounding.ts` (the CLI, for humans
// and headless prototyping) and `aiService.ts` (the palette's system prompt).

import { ClassicPreset } from "rete";
import { buildCatalog } from "./catalogUtils";
import type { CatalogEntry, NodeCatalogEntry, CatalogCategory } from "./AddNodeMenu";
import { SolenoidSocket, SOCKET_TYPE_LABELS, elementFamilyOf, latticeRank, type SocketDataType } from "./sockets";
import { INIT_FIELD_ORDER, INIT_EXTRA_FIELD_ORDER, extractInit } from "./copyPaste";
import { NODE_OPS } from "./nodeOps";
import type { FilterOp } from "./frameVerbs";
import type { FrameColType } from "./frame";

// The condition-row op vocabulary (frame/list Filter, SUMIFS `condConfig`).
// Record over the UNION so tsc enforces the list is complete and current.
const FILTER_OP_DOC: Record<FilterOp, string> = {
  gt: "greater than", gte: "at least", lt: "less than", lte: "at most",
  eq: "equals", neq: "not equal",
  contains: "contains", startsWith: "starts with", endsWith: "ends with",
  isblank: "is blank (no value field)", notblank: "not blank (no value field)",
  iserror: "has error (no value field)", noterror: "no error (no value field)",
};
const FRAME_COL_TYPES: Record<FrameColType, true> = { number: true, string: true, date: true, logical: true };

// ─── Socket signature of a headless instance ────────────────────────────────────

function sig(record: Record<string, unknown> | undefined, markMulti: boolean): string {
  const parts: string[] = [];
  for (const [k, port] of Object.entries(record ?? {})) {
    if (!port || typeof port !== "object") continue;
    const p = port as { socket?: unknown; multipleConnections?: unknown };
    const t = p.socket instanceof SolenoidSocket ? p.socket.dataType : "?";
    parts.push(`${k}:${t}${markMulti && p.multipleConnections === true ? "*" : ""}`);
  }
  return parts.join(", ");
}

interface ClassInfo {
  ctorName: string;
  path: string[];
  variants: Array<{ leaf: NodeCatalogEntry; op: string | null; inputs: string; outputs: string }>;
  litKeys: string[];
  strKeys: string[];
  /** Declares the map but with no default keys (rows materialize as they're
   *  added) — inline values are accepted on the input-row keys. */
  litOpen: boolean;
  strOpen: boolean;
  initKeys: string[];
  hidden: boolean;
}

/** Emit the full spec. Fresh walk each call — use `groundingSpec()` for the
 *  cached read (the catalog and classes don't change within a session). */
export function buildGroundingSpec(): string {
  const classes = new Map<string, ClassInfo>();
  const order: string[] = [];

  // Walk the full catalog (packs included), grouping leaves by class.
  function visit(entries: CatalogEntry[], path: string[]): void {
    for (const e of entries) {
      if (e.type === "category") {
        visit((e as CatalogCategory).children, [...path, (e as CatalogCategory).label]);
      } else if (e.type === "pair") {
        visit((e as { children: CatalogEntry[] }).children, path);
      } else {
        const leaf = e as NodeCatalogEntry;
        let inst: ClassicPreset.Node;
        try {
          inst = leaf.create() as ClassicPreset.Node;
        } catch {
          continue; // a factory that can't construct standalone has no authoring story
        }
        const anyInst = inst as unknown as Record<string, unknown>;
        const ctorName = inst.constructor.name;
        let info = classes.get(ctorName);
        if (!info) {
          // The init keys this class round-trips: extractInit reads them OFF the
          // instance, so a default instance names exactly the fields the class
          // persists — which is what an author may set (minus the inline-literal
          // spread, listed separately as "inline:").
          // width/height are geometry defaults, not logic — the sidecar carries
          // real sizes; listing them on every class would only be noise.
          const roundTrip = Object.keys(extractInit(inst)).filter((k) => k !== "width" && k !== "height");
          const hasLits = typeof anyInst.literals === "object" && anyInst.literals !== null;
          const hasStrs = typeof anyInst.stringLiterals === "object" && anyInst.stringLiterals !== null;
          const lits = hasLits ? Object.keys(anyInst.literals as object) : [];
          const strs = hasStrs ? Object.keys(anyInst.stringLiterals as object) : [];
          info = {
            ctorName,
            path,
            variants: [],
            litKeys: lits,
            strKeys: strs,
            litOpen: hasLits && lits.length === 0,
            strOpen: hasStrs && strs.length === 0,
            initKeys: roundTrip.filter((k) => !lits.includes(k) && !strs.includes(k)),
            hidden: leaf.hidden === true,
          };
          classes.set(ctorName, info);
          order.push(ctorName);
        }
        info.hidden = info.hidden && leaf.hidden === true; // hidden only if EVERY leaf is
        info.variants.push({
          leaf,
          op: typeof anyInst.op === "string" ? (anyInst.op as string) : null,
          inputs: sig(anyInst.inputs as Record<string, unknown> | undefined, true),
          outputs: sig(anyInst.outputs as Record<string, unknown> | undefined, false),
        });
      }
    }
  }

  visit(buildCatalog(false), []);

  // Full op vocabulary per class from the NODE_OPS registry — the catalog's
  // leaves can be a subset (hidden ops have no Add-menu leaf of their own).
  const opsByCtor = new Map<string, Array<{ op: string; label: string }>>();
  for (const decl of NODE_OPS) {
    if (decl.ops) opsByCtor.set(decl.ctor.name, decl.ops.map((o) => ({ op: o.op, label: o.label })));
  }

  const out: string[] = [];
  const w = (s = "") => out.push(s);

  w(`# Solenoid graph authoring — grounding spec`);
  w();
  w(`GENERATED by \`npm run ai-grounding\` from \`nodeCatalog.ts\` and the live node`);
  w(`classes — regenerate rather than edit. This is the vocabulary for reading and`);
  w(`writing a Solenoid document's text form.`);
  w();
  w(`## The text form`);
  w();
  w(`One node per line, dependency (topological) order, then a \`---\` line, then one`);
  w(`JSON "sidecar" block carrying everything that isn't logic (positions, standoffs,`);
  w(`pins, comments, the save version \`v\`). Node line grammar:`);
  w();
  w("```");
  w(`Name: Type key=<JSON value> lit:key=<JSON number> str:key=<JSON string> input<-Other.output`);
  w("```");
  w();
  w(`- \`Name\` — unique per document, \`[A-Za-z_][A-Za-z0-9_]*\`. Connections address it.`);
  w(`- \`Type\` — a node CLASS name from the inventory below (e.g. \`FilterNode\`).`);
  w(`- \`key=…\` — an init field (construction config, e.g. \`op="npv"\`). Values are JSON-encoded.`);
  w(`- \`lit:key=…\` / \`str:key=…\` — an inline value typed into an input row instead of wiring it;`);
  w(`  only classes listing "inline:" below accept them, on the keys listed.`);
  w(`- \`input<-Source.output\` — an incoming cable, named by the source node and its output key.`);
  w(`- Positions are optional (the sidecar's \`positions\` map; omitted nodes land at 0,0 —`);
  w(`  the app's Tidy can lay a generated graph out).`);
  w();
  w(`Example:`);
  w();
  w("```");
  w(`Price: NumberInputNode label="Price" value=25`);
  w(`Qty: NumberInputNode label="Qty" value=4`);
  w(`Total: ArithmeticNode op="mul" a<-Price.value b<-Qty.value`);
  w(`Show: DisplayNode in<-Total.result`);
  w(`---`);
  w(`{ "v": 2, "positions": { "Price": { "x": 0, "y": 0 } } }`);
  w("```");
  w();
  w(`Validate before applying or running: \`npm run validate-graph <file>\`;`);
  w(`run headlessly: \`npm run run-graph <file>\`.`);
  w();
  w(`## Socket types`);
  w();
  w(`Cables are typed. An output can feed an input when the lattice allows it:`);
  w(`values flow UP in dimensionality (scalar → list → matrix; a list enters a 2-D`);
  w(`input as one ROW) and never narrow back down (reshape explicitly instead);`);
  w(`element families (number / text / date / complex / boolean) never auto-cross —`);
  w(`a Cast node converts, and the sole built-in bridge is boolean↔number. \`frame\``);
  w(`(named typed columns) and \`cube\` are their own families with their own verbs.`);
  w(`Wildcards: \`any\` = untyped scalar, \`anylist\`/\`anytable\` = untyped 1-D/2-D,`);
  w(`\`trueany\` adopts anything. A \`*\` after an input below marks a multi-cable input.`);
  w();
  w(`| type | meaning | family | rank |`);
  w(`|---|---|---|---|`);
  for (const [t, label] of Object.entries(SOCKET_TYPE_LABELS)) {
    const fam = elementFamilyOf(t as SocketDataType) ?? "—";
    const rank = latticeRank(t as SocketDataType);
    w(`| \`${t}\` | ${label} | ${fam} | ${rank ?? "—"} |`);
  }
  w();
  w(`## Init-field whitelist`);
  w();
  w(`Only these keys ever persist as \`key=\` init fields; each class's own "init:"`);
  w(`line below names the ones it actually reads (\`op\` selects a variant, \`label\``);
  w(`titles the card, etc.):`);
  w();
  w("```");
  w([...INIT_FIELD_ORDER, ...INIT_EXTRA_FIELD_ORDER].join(" "));
  w("```");
  w();
  w(`## Structured init payloads`);
  w();
  w(`A few init fields carry a structured value (JSON-encoded like every init value —`);
  w(`inside a text-form line that means an escaped JSON string):`);
  w();
  w(`- \`frameText\` (FrameInputNode) — the table's data: a JSON array of columns,`);
  w(`  each \`{"name": string, "type": ${Object.keys(FRAME_COL_TYPES).map((t) => `"${t}"`).join("|")}, "values": [...]}\`.`);
  w(`  Values may be \`null\` (a missing cell); date cells are "YYYY-MM-DD" strings.`);
  w(`- \`condConfig\` (Frame Filter / List Filter / SUMIFS) — per condition-row config,`);
  w(`  keyed by row index as a STRING: \`{"0": {"op": "gt"}, "1": {"op": "contains", "matchCase": true}}\`.`);
  w(`  Row 0's column/value are the \`column0\`/\`value0\` sockets (inline via \`str:\`), row 1's`);
  w(`  are \`column1\`/\`value1\`, and so on. Ops: ${Object.entries(FILTER_OP_DOC).map(([op, d]) => `\`${op}\` (${d})`).join(", ")}.`);
  w(`- Row inputs like \`v0\`, \`value1\` on list-building nodes take comma-separated`);
  w(`  values per row (\`str:v0="1, 2, 3"\`); every row concatenates into one list.`);
  w();
  w(`## Node classes`);
  w();
  w(`\`Type\` tokens for the text form. "inline:" lists the input keys that accept`);
  w(`\`lit:\`/\`str:\` values. Where one class hosts several ops, each variant line is`);
  w(`\`op="…" — label\`; sockets are shown per variant only when they differ.`);

  let lastTop = "";
  for (const ctorName of order) {
    const info = classes.get(ctorName)!;
    if (info.hidden) continue; // deprecated: loads, but must not be authored
    const top = info.path[0] ?? "Other";
    if (top !== lastTop) {
      w();
      w(`### ${top}`);
      lastTop = top;
    }
    const first = info.variants[0];
    const allSameSockets = info.variants.every((v) => v.inputs === first.inputs && v.outputs === first.outputs);
    w();
    w(`#### \`${ctorName}\`${info.variants.length === 1 ? ` — ${first.leaf.label}` : ""}`);
    if (first.leaf.description) w(first.leaf.description);
    if (allSameSockets) {
      w(`- in: ${first.inputs || "—"}`);
      w(`- out: ${first.outputs || "—"}`);
    }
    if (info.initKeys.length > 0) w(`- init: ${info.initKeys.join(", ")}`);
    const inline: string[] = [];
    if (info.litKeys.length > 0) inline.push(`lit: ${info.litKeys.join(", ")}`);
    else if (info.litOpen) inline.push(`lit: (input-row keys)`);
    if (info.strKeys.length > 0) inline.push(`str: ${info.strKeys.join(", ")}`);
    else if (info.strOpen) inline.push(`str: (input-row keys)`);
    if (inline.length > 0) w(`- inline: ${inline.join(" · ")}`);
    // The op vocabulary: the registry's full list when the class has one (catalog
    // leaves can be a subset — hidden ops have no menu leaf); else the leaves.
    const registryOps = opsByCtor.get(ctorName);
    if (registryOps && allSameSockets) {
      w(`- ops: ${registryOps.map((o) => `\`${o.op}\` (${o.label})`).join(", ")}`);
    } else if (info.variants.length > 1) {
      for (const v of info.variants) {
        const opPart = v.op !== null ? `op=${JSON.stringify(v.op)} — ` : "";
        const sockets = allSameSockets ? "" : ` (in: ${v.inputs || "—"} → out: ${v.outputs || "—"})`;
        w(`- ${opPart}${v.leaf.label}${sockets}`);
      }
    }
    // Ops the class hosts that have no Add-menu leaf of their own (the catalog
    // builder derives these from NODE_OPS) — still valid `op=` values.
    const hidden = info.variants.flatMap((v) => v.leaf.hiddenOps ?? []);
    const listed = new Set(info.variants.map((v) => v.op));
    for (const h of hidden.filter((h, i, a) => !listed.has(h.op) && a.findIndex((x) => x.op === h.op) === i)) {
      w(`- op=${JSON.stringify(h.op)} — ${h.label}`);
    }
  }
  w();

  return out.join("\n");
}

// ─── Cached read for the in-app consumer ────────────────────────────────────────

let _spec: string | null = null;

/** The spec, built once per session — the palette's system prompt must be
 *  byte-identical across requests so the provider's prompt cache hits. */
export function groundingSpec(): string {
  if (_spec === null) _spec = buildGroundingSpec();
  return _spec;
}
