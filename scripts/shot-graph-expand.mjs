// The short graph form shared by shot-graph.mjs and site-shots.mjs: nodes need only id, type and init; a Frame
// Input takes `frame: [{ name, cells, type?, expr? }]`; cables are "src.output -> dst.input" strings; a node
// without x/y is placed by its depth in the cable graph. A saved graph passes through unchanged.
const inferType = (cells) => {
  const filled = cells.filter((c) => c !== "" && c != null);
  if (filled.length && filled.every((c) => !Number.isNaN(Number(c)))) return "number";
  if (filled.length && filled.every((c) => /^(true|false)$/i.test(String(c)))) return "logical";
  return "string";
};

export function expand(raw) {
  const g = raw.graph ?? raw;
  const nodes = g.nodes.map((n) => {
    const { frame, lambdaKeys, ...rest } = n;
    const init = { ...(rest.init ?? {}) };
    if (frame) {
      init.frameText = JSON.stringify(frame.map((c) => {
        const cells = (c.cells ?? []).map(String);
        return { name: c.name, type: c.type ?? (c.expr ? "number" : inferType(cells)), cells, ...(c.unit ? { unit: c.unit } : {}), ...(c.expr ? { expr: c.expr } : {}) };
      }));
    }
    if (lambdaKeys) init.lambdaKeys = lambdaKeys;
    return { ...rest, init };
  });
  const connections = [...(g.connections ?? []), ...(g.cables ?? []).map((s) => {
    const m = /^\s*([^.\s]+)\.(\S+)\s*->\s*([^.\s]+)\.(\S+)\s*$/.exec(s);
    if (!m) throw new Error(`bad cable "${s}", want "src.output -> dst.input"`);
    return { source: m[1], sourceOutput: m[2], target: m[3], targetInput: m[4] };
  })];
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const c of connections) depth.set(c.target, Math.max(depth.get(c.target) ?? 0, (depth.get(c.source) ?? 0) + 1));
  }
  const perCol = new Map();
  for (const n of nodes) {
    if (n.x != null && n.y != null) continue;
    const d = depth.get(n.id) ?? 0;
    const row = perCol.get(d) ?? 0;
    perCol.set(d, row + 1);
    n.x = d * 460;
    n.y = row * 360;
  }
  return { ...g, v: g.v ?? 2, nodes, connections };
}
