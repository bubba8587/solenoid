// Regenerates seedGraphs/architecture-map.json from docs/architecture.md +
// docs/rules.md + the src/graph import scan. archSeed.test.ts pins the
// checked-in file against a fresh run of the same builder.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ELK from "elkjs";
import { scanArchDeps } from "./scan-arch-deps.mjs";
import { parseArchDoc, parseRulesDoc } from "../src/graph/specMap";
import { buildArchSeed } from "../src/graph/archSeed";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const deps = scanArchDeps(path.join(root, "src/graph"));
const groups = parseArchDoc(fs.readFileSync(path.join(root, "docs/architecture.md"), "utf8"));
const rules = parseRulesDoc(fs.readFileSync(path.join(root, "docs/rules.md"), "utf8"));
const seed = await buildArchSeed(groups, deps, new ELK(), rules);
const out = path.join(root, "src/graph/seedGraphs/architecture-map.json");
fs.writeFileSync(out, `${JSON.stringify(seed, null, 2)}\n`);
console.log(`wrote ${path.relative(root, out)}: ${seed.nodes.length} nodes, ${seed.connections.length} cables`);
