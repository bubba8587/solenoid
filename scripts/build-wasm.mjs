// [[C130]] rustCore
// Builds the Rust core (crates/solenoid-core) to WebAssembly into src/graph/engineWasm/: cargo, wasm-bindgen, then
// wasm-opt -O3 when it's installed (`cargo install wasm-opt`), which strips names and trims about a fifth.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { sourceStamp } from "./wasm-stamp.mjs";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const has = (cmd) => { try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

const out = "src/graph/engineWasm";
const target = "crates/solenoid-core/target";
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", "crates/solenoid-core/Cargo.toml", "--target-dir", target]);
run("wasm-bindgen", ["--target", "web", "--out-dir", out, "--out-name", "solenoid_core", `${target}/wasm32-unknown-unknown/release/solenoid_core.wasm`]);
const wasm = `${out}/solenoid_core_bg.wasm`;
if (has("wasm-opt")) {
  run("wasm-opt", ["-O3", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", "--enable-sign-ext", "--enable-mutable-globals", wasm, "-o", wasm]);
} else {
  console.warn("wasm-opt not found: the module ships unoptimized (cargo install wasm-opt)");
}
// A trap leaves the instance corrupt, and wasm-bindgen's init returns early once it holds one: `__wbg_reset` lets
// `engineWasm.ts` drop it and instantiate the compiled module afresh.
const glue = `${out}/solenoid_core.js`;
writeFileSync(glue, readFileSync(glue, "utf8") + `
export function __wbg_reset() {
    const module = __wbg_init.__wbindgen_wasm_module;
    wasm = undefined;
    return module;
}
`);
const types = `${out}/solenoid_core.d.ts`;
writeFileSync(types, readFileSync(types, "utf8") + "export function __wbg_reset(): WebAssembly.Module;\n");
writeFileSync(`${out}/source-stamp.txt`, sourceStamp() + "\n");
console.log(`${wasm}: ${statSync(wasm).size} bytes`);
