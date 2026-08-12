// Run with: npx tsx scripts/socket-inventory.ts [--md]
//
// Dumps EVERY port in the node catalog grouped by socket type — the source data
// behind `docs/socket-reference.md`. Regenerate it after adding a node or
// retyping a port, then update that doc's tables from this output.
//
// It instantiates each catalog entry exactly as `coerceInputs.test.ts` does
// (`entry.create()` in a try/catch — constructability is that test's job, not
// ours) and reads the DECLARED socket of each port. A fresh node has adopted
// nothing, so an adoptive port reports its declared BASE, which is what the doc
// documents.

import { FLAT_CATALOG } from "../src/graph/catalogUtils";
import { AdoptiveSocket, SolenoidSocket, canConnect, SOCKET_TYPE_LABELS, type SocketDataType } from "../src/graph/sockets";
import { getPassthrough } from "../src/graph/nodes/passthrough";

type Port = {
  cls: string;
  label: string;
  side: "in" | "out";
  key: string;
  adoptive: boolean;
  entries: number; // how many catalog presets share this class+port
};

/** Variadic rows (`v0`, `v1`, `cond2`…) collapse to one pattern — they are one
 *  extensible port role, not N distinct ports. */
function portRole(key: string): string {
  const m = /^([A-Za-z_]+?)(\d+)$/.exec(key);
  return m ? `${m[1]}*` : key;
}

const byType = new Map<SocketDataType, Map<string, Port>>();
const skipped: string[] = [];
const passthroughNodes: string[] = [];

for (const [type, entry] of FLAT_CATALOG.entries()) {
  let n: unknown;
  try { n = entry.create(); } catch { skipped.push(type); continue; }
  const node = n as {
    label?: string;
    inputs?: Record<string, { socket?: unknown } | undefined>;
    outputs?: Record<string, { socket?: unknown } | undefined>;
  };
  const label = (node.label ?? type).trim();
  if (getPassthrough(n).length > 0) passthroughNodes.push(`${type} (${label})`);

  const cls = (n as object).constructor.name;
  const add = (side: "in" | "out", ports: Record<string, { socket?: unknown } | undefined>) => {
    for (const [key, p] of Object.entries(ports ?? {})) {
      const s = p?.socket;
      if (!(s instanceof SolenoidSocket)) continue;
      const adoptive = s instanceof AdoptiveSocket;
      const dt = adoptive ? (s as AdoptiveSocket).base : s.dataType;
      const bucket = byType.get(dt) ?? new Map<string, Port>();
      const role = portRole(key);
      const id = `${cls}|${side}|${role}`;
      const seen = bucket.get(id);
      if (seen) { seen.entries++; if (!seen.label.includes(label)) seen.label += `, ${label}`; }
      else bucket.set(id, { cls, label, side, key: role, adoptive, entries: 1 });
      byType.set(dt, bucket);
    }
  };
  add("in", node.inputs ?? {});
  add("out", node.outputs ?? {});
}

const ALL: SocketDataType[] = Object.keys(SOCKET_TYPE_LABELS) as SocketDataType[];

function accepts(target: SocketDataType): SocketDataType[] {
  return ALL.filter((src) => canConnect(src, target));
}
function reaches(source: SocketDataType): SocketDataType[] {
  return ALL.filter((tgt) => canConnect(source, tgt));
}

const md = process.argv.includes("--md");
const out: string[] = [];

out.push(`# Socket inventory (generated ${md ? "" : ""}by scripts/socket-inventory.ts)\n`);
out.push(`Catalog entries scanned: ${FLAT_CATALOG.size}; skipped (not constructable headlessly): ${skipped.length}\n`);

for (const dt of ALL) {
  const ports = [...(byType.get(dt)?.values() ?? [])].sort((a, b) => a.cls.localeCompare(b.cls) || a.key.localeCompare(b.key));
  out.push(`\n## ${dt} — "${SOCKET_TYPE_LABELS[dt]}"  (${ports.length} distinct class+port)`);
  out.push(`ACCEPTS FROM: ${accepts(dt).join(", ") || "(nothing)"}`);
  out.push(`REACHES:      ${reaches(dt).join(", ") || "(nothing)"}`);
  const ins = ports.filter((p) => p.side === "in");
  const outs = ports.filter((p) => p.side === "out");
  const fmt = (p: Port) => `${p.cls}.${p.key}${p.adoptive ? " [adoptive]" : ""}${p.entries > 1 ? ` (x${p.entries} presets)` : ""}  — ${p.label.slice(0, 90)}`;
  if (ins.length) out.push(`INPUTS (${ins.length}):\n  ${ins.map(fmt).join("\n  ")}`);
  if (outs.length) out.push(`OUTPUTS (${outs.length}):\n  ${outs.map(fmt).join("\n  ")}`);
}

out.push(`\n\n## Nodes declaring passthrough() (${passthroughNodes.length})`);
out.push(passthroughNodes.sort().join("\n"));
if (skipped.length) out.push(`\n\n## Skipped\n${skipped.join(", ")}`);

console.log(out.join("\n"));
