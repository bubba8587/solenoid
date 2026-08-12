// The legal `op=` tokens per node class, derived from the catalog. It is a whitelist
// of KNOWN vocabularies: an ABSENT class must be skipped by callers, never rejected.

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
