// [[C16]] polarsEngine
// Builds the Rust core (crates/solenoid-core) to WebAssembly into src/graph/engineWasm/: cargo, wasm-bindgen, then
// wasm-opt -O3 when it's installed (`cargo install wasm-opt`), which strips names and trims about a fifth.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

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
console.log(`${wasm}: ${statSync(wasm).size} bytes`);
