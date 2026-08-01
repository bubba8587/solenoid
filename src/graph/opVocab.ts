// The `op=` vocabulary per node class — the values a saved/authored `op` init
// field may legally take. One derivation, two consumers: the strict validator
// (an unknown op constructs "fine" and then silently miscomputes — exactly the
// class of would-be-silent repair `graphValidate.ts` exists to surface) and the
// grounding spec (a model needs the exact tokens, not the dropdown labels).
//
// Sources, in layers:
// 1. NODE_OPS — the declared op families (the formula surface's registry).
// 2. Every Add-menu leaf's own constructed `op` (op-selected leaves), plus the
//    leaf's builder-derived `hiddenOps` (ops with no menu leaf of their own).
// 3. The dropdown-only families whose ops live in a component select rather
//    than the catalog: the aggregate ops (Group By / Cube Rollup, AGG_OP_META)
//    and the 1-D Group By (GROUP_BY_OP_META). Their meta tables are
//    Record<Union, …>, so tsc keeps these complete.
//
// A class ABSENT from the map has no enumerable vocabulary (no declared family,
// single-op or op-less leaves) — callers must skip the check for it rather than
// reject; the derivation is a whitelist of KNOWN vocabularies, not a claim of
// full coverage.

import { NODE_OPS } from "./nodeOps";
import { FLAT_CATALOG } from "./catalogUtils";
import { AGG_OP_META } from "./nodes/frame";
import { GROUP_BY_OP_META } from "./nodes/list";

let _vocab: Map<string, Map<string, string>> | null = null;

/** ctor name → (op → label). Lazily built and cached (the catalog is static). */
export function opVocabByCtor(): Map<string, Map<string, string>> {
  if (_vocab) return _vocab;
  const vocab = new Map<string, Map<string, string>>();
  const add = (ctor: string, op: string, label: string) => {
    let m = vocab.get(ctor);
    if (!m) vocab.set(ctor, (m = new Map()));
    if (!m.has(op)) m.set(op, label);
  };

  for (const decl of NODE_OPS) {
    if (decl.ops) for (const o of decl.ops) add(decl.ctor.name, o.op, o.label);
  }

  for (const leaf of FLAT_CATALOG.values()) {
    let inst: unknown;
    try {
      inst = leaf.create();
    } catch {
      continue;
    }
    const anyInst = inst as Record<string, unknown>;
    const ctor = (inst as object).constructor.name;
    if (typeof anyInst.op === "string") add(ctor, anyInst.op, leaf.label);
    for (const h of leaf.hiddenOps ?? []) add(ctor, h.op, h.label);
  }

  for (const [op, meta] of Object.entries(AGG_OP_META)) {
    if (meta.pivotOnly) continue; // the card dropdowns exclude these
    add("GroupByFrameNode", op, meta.label);
    add("CubeRollupNode", op, meta.label);
  }
  for (const [op, meta] of Object.entries(GROUP_BY_OP_META)) {
    add("GroupByNode", op, meta.label);
  }

  _vocab = vocab;
  return vocab;
}
