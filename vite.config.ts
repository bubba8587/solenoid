import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import license from "rollup-plugin-license";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
const host = process.env.TAURI_DEV_HOST;

/** Dev-only endpoint for the in-app copy-edit freeze (`src/devCopyEdit.ts`): maps an
 *  on-screen string to its source literal and rewrites it, reusing the string-editor
 *  companion's mapper (`tools/string-editor/literals.mjs` — drift-safe rewrite +
 *  copy-edits.jsonl logging). Serve-mode only; a unique match writes, anything
 *  ambiguous or unmatched reports and leaves the source alone. */
function copyEditEndpoint(): Plugin {
  const SRC_DIR = path.resolve("src");
  async function listSourceFiles(): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
          await walk(full);
        } else if (/\.(ts|tsx|md)$/.test(e.name)) out.push(full);
      }
    }
    await walk(SRC_DIR);
    return out;
  }
  return {
    name: "solenoid-copy-edit",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__copy-edit", (req, res) => {
        void (async () => {
          if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
          let raw = "";
          for await (const chunk of req) raw += chunk;
          const { before, after } = JSON.parse(raw || "{}") as { before?: string; after?: string };
          res.setHeader("content-type", "application/json");
          if (!before || typeof after !== "string") { res.end(JSON.stringify({ status: "error", message: "before/after required" })); return; }
          const lits = await import(pathToFileURL(path.resolve("tools/string-editor/literals.mjs")).href);
          const index = await lits.buildIndex(listSourceFiles);
          const matches = lits.findMatches(index, before);
          if (matches.length === 0) { res.end(JSON.stringify({ status: "notfound" })); return; }
          if (matches.length > 1) {
            res.end(JSON.stringify({ status: "ambiguous", count: matches.length, files: [...new Set(matches.map((m: { file: string }) => m.file))] }));
            return;
          }
          const done = await lits.applyEdit({ ...matches[0], newText: after, fromText: before, context: "in-app freeze" });
          res.end(JSON.stringify({ status: "saved", file: done.file }));
        })().catch((err: unknown) => {
          res.statusCode = 200;
          res.end(JSON.stringify({ status: "error", message: String(err instanceof Error ? err.message : err) }));
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), copyEditEndpoint()],

  // Preserve class / function names through minification. Node components
  // derive their human-readable type hint from `constructor.name` (see
  // typeHint in nodeKit.tsx), AND `persistence.ts` writes `constructor.name`
  // as the persisted node type; without this, the minifier mangles class
  // names to single letters and a production save reopens as garbage. Vite 8
  // defaults to the Oxc minifier, which has no keepNames equivalent, so pin
  // the esbuild minifier explicitly and keep its keepNames option.
  esbuild: { keepNames: true },

  build: {
    minify: "esbuild",
    rollupOptions: {
      // Emit a complete third-party license file alongside the bundle, listing
      // every dependency actually shipped (React, Rete, KaTeX, …) with its
      // license text — auto-generated so it never goes stale. Build-only.
      // (Lucide icons are vendored as inline SVG, credited in THIRD-PARTY-NOTICES.md.)
      plugins: [
        license({
          thirdParty: {
            includePrivate: false,
            // Key by name@version, not name: ten packages resolve at TWO versions
            // (mermaid nests its own marked/katex/d3-*), and the default keeps only
            // whichever it saw first — the file named versions we don't ship.
            multipleVersions: true,
            output: {
              file: "dist/third-party-licenses.txt",
              encoding: "utf-8",
            },
          },
        }),
      ],
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
