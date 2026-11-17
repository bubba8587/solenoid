// Writes src/graph/geo/usStates.json, the US Map card's state outlines, from us-atlas (Census cartographic boundaries,
// public domain; the package is ISC). Run once with the three packages installed somewhere outside the app:
//   npm i --prefix <dir> us-atlas@3.0.1 topojson-client@3.1.0 topojson-simplify@3.0.3
//   node scripts/gen-us-states.mjs <dir>
// Each state is its rings as hundredths of a degree, the first point whole and the rest as steps from the one before.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/gen-us-states.mjs <dir with us-atlas, topojson-client, topojson-simplify>");
const req = createRequire(join(dir, "node_modules", "x.js"));
const { feature } = req("topojson-client");
const { presimplify, simplify, quantile } = req("topojson-simplify");
const topo = JSON.parse(readFileSync(req.resolve("us-atlas/states-10m.json"), "utf8"));
const simple = simplify(presimplify(topo), quantile(presimplify(topo), 0.5));
const states = feature(simple, simple.objects.states).features
  .filter((f) => Number(f.id) <= 56)
  .map((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = [];
    for (const poly of polys) for (const ring of poly) {
      const out = [];
      let px = 0, py = 0;
      for (const [lon, lat] of ring) {
        const x = Math.round(lon * 100), y = Math.round(lat * 100);
        if (out.length && x === px && y === py) continue;
        out.push(x - px, y - py);
        px = x; py = y;
      }
      if (out.length >= 8) rings.push(out);
    }
    return { id: f.id, name: f.properties.name, rings };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
const text = JSON.stringify(states);
writeFileSync(new URL("../src/graph/geo/usStates.json", import.meta.url), text + "\n");
console.log(`${states.length} states, ${(text.length / 1024).toFixed(0)} KB`);
