// `npm run build:cli`: the headless runner (`run-graph.ts`) as one Node file beside the engine's wasm, so a graph
// runs with only Node installed. `engineWasm.ts` finds the module at ./engineWasm/ next to the file that holds it,
// and here that file is the whole bundle.
import { defineConfig, type Plugin } from "vite";
import path from "node:path";
import { readFileSync } from "node:fs";

const REPO = path.resolve(import.meta.dirname, "..");

function engineWasm(): Plugin {
  return {
    name: "solenoid-cli-wasm",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "engineWasm/solenoid_graph_bg.wasm",
        source: readFileSync(path.join(REPO, "src/graph/engineWasm/solenoid_graph_bg.wasm")),
      });
    },
  };
}

export default defineConfig({
  root: REPO,
  logLevel: "warn",
  publicDir: false,
  plugins: [engineWasm()],
  ssr: { noExternal: true },
  build: {
    ssr: path.join(REPO, "scripts/run-graph.ts"),
    outDir: path.join(REPO, "dist-cli"),
    emptyOutDir: true,
    target: "node20",
    minify: true,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "run-graph.mjs",
        banner: "#!/usr/bin/env node",
        codeSplitting: false,
        // Node types are found by class name (`nodeCtorRegistry.ts`), so minifying must not rename classes.
        keepNames: true,
      },
    },
  },
});
