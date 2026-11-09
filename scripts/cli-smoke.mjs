// Runs after `npm run build:cli`: the bundle, copied alone into an empty folder outside the repo (so neither the
// source nor node_modules can answer for it), runs through a symlink, as npm's bin link would: a seed must print its
// real values, and a text-form model must go through cards, validate and run.
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(tmpdir(), "solenoid-cli-"));
try {
  cpSync(path.join(repo, "dist-cli"), path.join(dir, "pkg"), { recursive: true });
  const bin = path.join(dir, "solenoid");
  symlinkSync(path.join(dir, "pkg", "solenoid.mjs"), bin);
  const sol = (...args) => execFileSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });
  const seed = path.join(repo, "src/graph/seedGraphs/getting-started.json");
  const out = JSON.parse(sol("run", seed));
  const sum = out["SUM"]?.result;
  if (sum !== 1200 + 1550 + 1340 + 1810) throw new Error(`dist-cli: getting-started's SUM came out ${JSON.stringify(out["SUM"])}`);
  const cols = Object.keys(out["Quarterly sales"]?.frame?.[0] ?? {}).join(",");
  if (cols !== "Quarter,Sales") throw new Error(`dist-cli: getting-started's table came out with columns ${cols}`);
  // The whole loop from a text-form file: look a card up, validate, run with an input set.
  const model = path.join(dir, "model.txt");
  writeFileSync(model, 'Price: ValueInputNode label="Price" value="25"\nQty: ValueInputNode label="Qty" value="4"\nTotal: ArithmeticNode op="mul" a<-Price.value b<-Qty.value\n---\n{ "v": 2 }\n');
  if (!sol("cards", "--card", "arithmetic").includes("`ArithmeticNode`")) throw new Error("dist-cli: cards --card arithmetic didn't print the card");
  if (!sol("validate", model).includes("OK")) throw new Error("dist-cli: validate refused the sample model");
  const total = JSON.parse(sol("run", model, "--set", "Qty=10", "--out", "Total")).Total?.result;
  if (total !== 250) throw new Error(`dist-cli: the sample model's Total came out ${total}`);
  if (JSON.parse(sol("run", "--formula", "1 + x", "--set", "x=2")) !== 3) throw new Error("dist-cli: --formula didn't answer 3");
  console.log(`dist-cli: solenoid ran standalone (a seed's SUM ${sum}; cards, validate and run on a text-form model)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
