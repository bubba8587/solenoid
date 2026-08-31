import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import license from "rollup-plugin-license";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
const host = process.env.TAURI_DEV_HOST;

/** Dev-only endpoint for the in-app copy-edit freeze (`src/devCopyEdit.ts`): maps an
 *  on-screen string to its source, reusing the string-editor companion's mapper
 *  (`tools/string-editor/literals.mjs` — drift-safe rewrite + copy-edits.jsonl log).
 *  Markdown-aware: rendered text (the Inspector description, Reference rows, help
 *  prose) has its `` ` ``/`*` marks stripped by the renderer, so lookup falls back to
 *  a stripped index for literals and a position-mapped stripped scan for .md files.
 *  `save` writes EVERY match (an on-screen string edits all its source places).
 *  Serve-mode only. */
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

  const stripMarks = (s: string) => s.replace(/[`*]/g, "");
  /** Strip marks keeping a stripped-index → original-index map, for md spans. */
  function stripWithMap(text: string): { stripped: string; map: number[] } {
    const map: number[] = [];
    let stripped = "";
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "`" || c === "*") continue;
      map.push(i);
      stripped += c;
    }
    return { stripped, map };
  }

  type Rec = { file: string; abs: string; start: number; end: number; line: number; quote: string; raw: string; content: string };
  type Match = { kind: "literal" | "md"; file: string; abs: string; line: number; start: number; end: number; quote: string | null; raw: string; content: string };
  type Index = { byContent: Map<string, Rec[]>; mdFiles: Array<{ file: string; abs: string; text: string }> };

  // The index is a full src scan — cache it and drop the cache on any src change.
  let cached: { index: Index; stripped: Map<string, Rec[]> } | null = null;
  async function getIndex(lits: { buildIndex: (l: () => Promise<string[]>) => Promise<Index> }) {
    if (cached) return cached;
    const index = await lits.buildIndex(listSourceFiles);
    const stripped = new Map<string, Rec[]>();
    for (const [content, recs] of index.byContent) {
      if (!/[`*]/.test(content)) continue;
      const key = stripMarks(content);
      const arr = stripped.get(key);
      if (arr) arr.push(...recs); else stripped.set(key, [...recs]);
    }
    cached = { index, stripped };
    return cached;
  }

  function lookupAll(idx: { index: Index; stripped: Map<string, Rec[]> }, text: string): Match[] {
    const fromRecs = (recs: Rec[]): Match[] =>
      recs.map((r) => ({ kind: "literal", file: r.file, abs: r.abs, line: r.line, start: r.start, end: r.end, quote: r.quote, raw: r.raw, content: r.content }));
    const exact = idx.index.byContent.get(text);
    if (exact?.length) return fromRecs(exact);
    const viaStrip = idx.stripped.get(text);
    if (viaStrip?.length) return fromRecs(viaStrip);
    // .md: exact substring first, then the position-mapped stripped scan.
    const md: Match[] = [];
    for (const m of idx.index.mdFiles) {
      let at = m.text.indexOf(text);
      while (at !== -1 && md.length <= 20) {
        md.push({ kind: "md", file: m.file, abs: m.abs, line: m.text.slice(0, at).split("\n").length, start: at, end: at + text.length, quote: null, raw: text, content: text });
        at = m.text.indexOf(text, at + text.length);
      }
    }
    if (md.length) return md;
    for (const m of idx.index.mdFiles) {
      const { stripped, map } = stripWithMap(m.text);
      let at = stripped.indexOf(text);
      while (at !== -1 && md.length <= 20) {
        const s = map[at];
        const e = map[at + text.length - 1] + 1;
        const raw = m.text.slice(s, e);
        md.push({ kind: "md", file: m.file, abs: m.abs, line: m.text.slice(0, s).split("\n").length, start: s, end: e, quote: null, raw, content: raw });
        at = stripped.indexOf(text, at + text.length);
      }
    }
    return md;
  }

  return {
    name: "solenoid-copy-edit",
    apply: "serve",
    configureServer(server) {
      server.watcher.on("all", (_event: string, file: string) => {
        if (file.startsWith(SRC_DIR)) cached = null;
      });
      server.middlewares.use("/__copy-edit", (req, res) => {
        void (async () => {
          if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
          let body = "";
          for await (const chunk of req) body += chunk;
          const { action, text, after } = JSON.parse(body || "{}") as { action?: string; text?: string; after?: string };
          res.setHeader("content-type", "application/json");
          if (!text) { res.end(JSON.stringify({ status: "error", message: "text required" })); return; }
          const lits = await import(pathToFileURL(path.resolve("tools/string-editor/literals.mjs")).href);
          const idx = await getIndex(lits);
          const matches = lookupAll(idx, text);
          if (matches.length === 0) { res.end(JSON.stringify({ status: "notfound" })); return; }
          const files = [...new Set(matches.map((m) => m.file))];
          if (action === "lookup") {
            res.end(JSON.stringify({ status: "found", raw: matches[0].content, count: matches.length, files }));
            return;
          }
          if (typeof after !== "string") { res.end(JSON.stringify({ status: "error", message: "after required" })); return; }
          // Save writes every match — apply in DESCENDING offset per file so earlier
          // spans stay valid, and re-read offsets drift-safely inside applyEdit.
          const ordered = [...matches].sort((a, b) => (a.abs === b.abs ? b.start - a.start : a.abs.localeCompare(b.abs)));
          for (const m of ordered) {
            await lits.applyEdit({ ...m, newText: after, fromText: m.content, context: "in-app freeze" });
            cached = null; // offsets in this file moved
          }
          res.end(JSON.stringify({ status: "saved", count: matches.length, files }));
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
