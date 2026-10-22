// [[C130]] rustCore
// Builds the Rust core (crates/solenoid-core) into src/graph/engineWasm/ and the graph engine (crates/solenoid-graph)
// into src/graph/graphWasm/: cargo, wasm-bindgen, then wasm-opt -O3 when it's installed (`cargo install wasm-opt`),
// which strips names and trims about a fifth. `node scripts/build-wasm.mjs graph` builds one.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { MODULES, sourceStamp } from "./wasm-stamp.mjs";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const has = (cmd) => { try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

function build(name) {
  const { crate, out } = MODULES[name];
  const lib = crate.replace(/-/g, "_");
  const target = `crates/${crate}/target`;
  run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", `crates/${crate}/Cargo.toml`, "--target-dir", target]);
  // The graph module holds JS nodes: weak refs free a dropped engine's core, and the nodes it holds, with it.
  run("wasm-bindgen", ["--target", "web", ...(name === "graph" ? ["--weak-refs"] : []), "--out-dir", out, "--out-name", lib, `${target}/wasm32-unknown-unknown/release/${lib}.wasm`]);
  const wasm = `${out}/${lib}_bg.wasm`;
  if (has("wasm-opt")) {
    run("wasm-opt", ["-O3", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", "--enable-sign-ext", "--enable-mutable-globals", wasm, "-o", wasm]);
  } else {
    console.warn("wasm-opt not found: the module ships unoptimized (cargo install wasm-opt)");
  }
  if (name === "core") {
    // A trap leaves the instance corrupt, and wasm-bindgen's init returns early once it holds one: `__wbg_reset` lets
    // `engineWasm.ts` drop it and instantiate the compiled module afresh.
    const glue = `${out}/${lib}.js`;
    writeFileSync(glue, readFileSync(glue, "utf8") + `
export function __wbg_reset() {
    const module = __wbg_init.__wbindgen_wasm_module;
    wasm = undefined;
    return module;
}
`);
    const types = `${out}/${lib}.d.ts`;
    writeFileSync(types, readFileSync(types, "utf8") + "export function __wbg_reset(): WebAssembly.Module;\n");
  }
  writeFileSync(`${out}/source-stamp.txt`, sourceStamp(".", name) + "\n");
  console.log(`${wasm}: ${statSync(wasm).size} bytes`);
}

const only = process.argv.slice(2);
for (const name of Object.keys(MODULES)) if (only.length === 0 || only.includes(name)) build(name);
