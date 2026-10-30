// [[C130]] rustCore
// Builds the one wasm module, the graph engine (crates/solenoid-graph) with the core it links (crates/solenoid-core),
// into src/graph/engineWasm/: cargo, wasm-bindgen, then, for a module that ships, wasm-opt -O3 (`--opt`, `cargo install wasm-opt`),
// which strips names and trims about a fifth.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { MODULE, sourceStamp } from "./wasm-stamp.mjs";

const OPTIMIZE = process.argv.includes("--opt") || process.env.WASM_OPT === "1";
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
const has = (cmd) => { try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

/** A trap leaves the instance corrupt, and wasm-bindgen's init returns early once it holds one: `__wbg_reset` lets
 *  `engineWasm.ts` drop it and instantiate the compiled module afresh. What the dead instance
 *  left in JS must then never reach the new one: its closures (a promise settling late) do nothing, its finalizers
 *  free nothing, and the object heap starts empty. Each piece is checked, so a wasm-bindgen whose glue reads
 *  differently fails the build instead of shipping unguarded. */
function patchGlue(src) {
  const swap = (from, to, all = false) => {
    if (!src.includes(from)) throw new Error(`build-wasm: wasm-bindgen's glue has no ${JSON.stringify(from)}`);
    src = all ? src.split(from).join(to) : src.replace(from, to);
  };
  // wasm-bindgen 0.2.130: objects live in the instance's externref table, so a fresh instance starts with a clean
  // one, and the glue caches its init promise, which the reset clears with the instance.
  swap("let wasmModule, wasmInstance, wasm;\n", "let wasmModule, wasmInstance, wasm;\nlet __wbg_epoch = 0;\n");
  swap("const state = { a: arg0, b: arg1, cnt: 1 };", "const state = { a: arg0, b: arg1, cnt: 1, epoch: __wbg_epoch };", true);
  swap("const real = (...args) => {\n", "const real = (...args) => {\n        if (state.epoch !== __wbg_epoch) return;\n", true);
  src = src.replace(/new FinalizationRegistry\(state => (wasm\.\w+\(state\.a, state\.b\))\)/g,
    "new FinalizationRegistry(state => state.epoch === __wbg_epoch && $1)");
  src = src.replace(/new FinalizationRegistry\(ptr => (wasm\.__wbg_\w+_free)\(ptr(?: >>> 0)?, 1\)\)/g,
    "new FinalizationRegistry(({ ptr, epoch }) => epoch === __wbg_epoch && $1(ptr >>> 0, 1))");
  src = src.replace(/Finalization\.register\(this, this\.__wbg_ptr, this\)/g,
    "Finalization.register(this, { ptr: this.__wbg_ptr, epoch: __wbg_epoch }, this)");
  const guarded = (src.match(/epoch === __wbg_epoch|state\.epoch !== __wbg_epoch/g) ?? []).length;
  const registries = (src.match(/new FinalizationRegistry/g) ?? []).length;
  const closures = (src.match(/const real = /g) ?? []).length;
  if (guarded !== registries + closures) throw new Error("build-wasm: a finalizer or closure in the glue is unguarded");
  return src + `
export function __wbg_reset() {
    const module = wasmModule;
    wasm = undefined;
    wasmInstance = undefined;
    __wbg_init_promise = undefined;
    __wbg_epoch++;
    return module;
}
`;
}

function build() {
  const { crate, out } = MODULE;
  const lib = crate.replace(/-/g, "_");
  const target = `crates/${crate}/target`;
  run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", `crates/${crate}/Cargo.toml`, "--target-dir", target]);
  run("wasm-bindgen", ["--target", "web", "--out-dir", out, "--out-name", lib, `${target}/wasm32-unknown-unknown/release/${lib}.wasm`]);
  const wasm = `${out}/${lib}_bg.wasm`;
  // Optimizing is for a module that ships (`npm run build:wasm:opt`): it costs minutes and changes no answer.
  if (OPTIMIZE) {
    if (!has("wasm-opt")) throw new Error("build-wasm: --opt needs wasm-opt (cargo install wasm-opt)");
    run("wasm-opt", ["-O3", "--enable-bulk-memory", "--enable-nontrapping-float-to-int", "--enable-sign-ext", "--enable-mutable-globals", wasm, "-o", wasm]);
  }
  const glue = `${out}/${lib}.js`;
  writeFileSync(glue, patchGlue(readFileSync(glue, "utf8")));
  const types = `${out}/${lib}.d.ts`;
  writeFileSync(types, readFileSync(types, "utf8") + "export function __wbg_reset(): WebAssembly.Module;\n");
  writeFileSync(`${out}/source-stamp.txt`, sourceStamp(".") + "\n");
  console.log(`${wasm}: ${statSync(wasm).size} bytes`);
}

build();
