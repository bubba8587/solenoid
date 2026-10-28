// Runs after `npm run build:cli`: the bundle, copied alone into an empty folder outside the repo (so neither the
// source nor node_modules can answer for it), runs a seed through a symlink, as npm's bin link would, and must print
// the seed's real values.
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "solenoid-cli-"));
try {
  cpSync(path.join(repo, "dist-cli"), path.join(dir, "pkg"), { recursive: true });
  const bin = path.join(dir, "solenoid-run");
  symlinkSync(path.join(dir, "pkg", "run-graph.mjs"), bin);
  const seed = path.join(repo, "src/graph/seedGraphs/getting-started.json");
  const out = JSON.parse(execFileSync(process.execPath, [bin, seed], { cwd: dir, encoding: "utf8" }));
  const sum = out["SUM"]?.result;
  if (sum !== 1200 + 1550 + 1340 + 1810) throw new Error(`dist-cli: getting-started's SUM came out ${JSON.stringify(out["SUM"])}`);
  const cols = out["Quarterly sales"]?.frame?.columns?.map((c) => c.name).join(",");
  if (cols !== "Quarter,Sales") throw new Error(`dist-cli: getting-started's table came out with columns ${cols}`);
  console.log(`dist-cli: ran getting-started standalone (SUM ${sum})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
