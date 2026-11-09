// Runs a TypeScript script that imports the app (`node scripts/vite-run.mjs scripts/x.ts [args]`) through Vite's
// module loader, so the app's modules read `import.meta.env` and their asset URLs as they do in vitest. The script
// sees itself as process.argv[1], so its own `import.meta.url === argv[1]` entry check holds; it ends when the
// script's top level settles, so an async entry awaits its work.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error("Usage: node scripts/vite-run.mjs <script.ts> [args]");
  process.exit(1);
}
process.argv = [process.argv[0], resolve(script), ...args];
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", logLevel: "error" });
// Nothing computes without the graph engine and the core, so a script gets both before it runs. Not the tests'
// setup file: that one hooks vitest's afterEach, which throws outside a vitest run.
const engine = await server.ssrLoadModule(resolve("src/graph/engineWasm.ts"));
engine.loadWasmEngineSync(readFileSync(engine.wasmUrl));
await server.ssrLoadModule(resolve(script));
await server.close();
process.exit(process.exitCode ?? 0);
