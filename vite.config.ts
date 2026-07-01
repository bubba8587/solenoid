import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import license from "rollup-plugin-license";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// ─── TEMP: seed-rebuild writeback endpoint (dev only) ──────────────────────────
// POST /__save-seed { id, graph } writes src/graph/seedGraphs/<id>.json, formatted
// to match the hand-authored style (one node / connection per line). Used by the
// one-shot window.__rebuildSeeds() routine to save each seed in its post-Cleanup +
// Expand-All state. Remove this plugin (and devRebuildSeeds.ts) once seeds are saved.
const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "src/graph/seedGraphs");

function formatSeed(graph: { label?: string; nodes: unknown[]; connections: unknown[] }): string {
  const line = (o: unknown) => "    " + JSON.stringify(o);
  const parts: string[] = ["{", '  "v": 1,'];
  if (typeof graph.label === "string") parts.push(`  "label": ${JSON.stringify(graph.label)},`);
  parts.push('  "nodes": [', graph.nodes.map(line).join(",\n"), "  ],");
  parts.push('  "connections": [', graph.connections.map(line).join(",\n"), "  ]");
  parts.push("}");
  return parts.join("\n") + "\n";
}

function seedWritebackPlugin(): PluginOption {
  return {
    name: "solenoid-seed-writeback",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__save-seed", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const { id, graph } = JSON.parse(body) as { id: string; graph: any };
            if (typeof id !== "string" || !/^[a-z0-9-]+$/i.test(id)) throw new Error("bad id");
            if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.connections)) throw new Error("bad graph");
            writeFileSync(path.join(seedDir, `${id}.json`), formatSeed(graph), "utf8");
            res.statusCode = 200; res.end(JSON.stringify({ ok: true, id }));
            server.config.logger.info(`[seed-writeback] wrote ${id}.json`);
          } catch (e) {
            res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), seedWritebackPlugin()],

  // Preserve class / function names through minification. Node components
  // derive their human-readable type hint from `constructor.name` (see
  // typeHint in nodeKit.tsx); without this, esbuild mangles class names to
  // single letters and the hint shows garbage in production builds.
  esbuild: { keepNames: true },

  build: {
    rollupOptions: {
      // Emit a complete third-party license file alongside the bundle, listing
      // every dependency actually shipped (React, Rete, KaTeX, …) with its
      // license text — auto-generated so it never goes stale. Build-only.
      // (Lucide icons are vendored as inline SVG, credited in THIRD-PARTY-NOTICES.md.)
      plugins: [
        license({
          thirdParty: {
            includePrivate: false,
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
