// [[C107]] obsidianPlugin
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import license from "rollup-plugin-license";
import postcss from "postcss";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = path.resolve(import.meta.dirname, "..");
const SHIMS = path.join(import.meta.dirname, "src/shims");
const OUT = path.join(REPO, "demo-vault/.obsidian/plugins/solenoid-properties");

/** App modules that reach the graph, and what stands in for each ([[C107]]: the whole seam). */
const SHIMMED: Record<string, string> = {
  [path.join(REPO, "src/graph/persistence.ts")]: path.join(SHIMS, "persistence.ts"),
  [path.join(REPO, "src/graph/process.ts")]: path.join(SHIMS, "process.ts"),
  [path.join(REPO, "src/graph/fileBridge.ts")]: path.join(SHIMS, "fileBridge.ts"),
  [path.join(REPO, "src/graph/frameBackend.ts")]: path.join(SHIMS, "frameBackend.ts"),
  [path.join(REPO, "src/graph/activeGraph.ts")]: path.join(SHIMS, "activeGraph.ts"),
  [path.join(REPO, "src/graph/flyToNode.ts")]: path.join(SHIMS, "flyToNode.ts"),
  [path.join(REPO, "src/graph/packs.ts")]: path.join(SHIMS, "packs.ts"),
  [path.join(REPO, "src/graph/formulaSyntax.ts")]: path.join(SHIMS, "formulaSyntax.ts"),
  [path.join(REPO, "src/graph/perfProbe.ts")]: path.join(SHIMS, "perfProbe.ts"),
  [path.join(REPO, "src/graph/nativeAccent.ts")]: path.join(SHIMS, "nativeAccent.ts"),
};
const REACT_DOM_SHIM = path.join(SHIMS, "reactDom.ts");

function shims(): Plugin {
  return {
    name: "solenoid-plugin-shims",
    enforce: "pre",
    async resolveId(source, importer, options) {
      // App code only: react-dom/client reads its own internals off the real module.
      if (source === "react-dom") return importer?.startsWith(path.join(REPO, "src") + path.sep) ? REACT_DOM_SHIM : null;
      if (!importer || !source.startsWith(".")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && SHIMMED[resolved.id] ? SHIMMED[resolved.id] : null;
    },
  };
}

/** The bundled CSS splits in two: `@font-face` must live in the document (`styles.css`); the
 *  rest goes into the shadow roots as a string, `:root` rewritten to `:host`. */
function shadowCss(): Plugin {
  return {
    name: "solenoid-plugin-shadow-css",
    enforce: "post",
    generateBundle(_options, bundle) {
      const fonts: string[] = [];
      let css = "";
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== "asset" || !name.endsWith(".css")) continue;
        const root = postcss.parse(String(file.source));
        root.walkAtRules("font-face", (rule) => { fonts.push(rule.toString()); rule.remove(); });
        root.walkRules((rule) => {
          rule.selector = rule.selector.replace(/:root((?:\[[^\]]*\])+)/g, ":host($1)").replace(/:root/g, ":host");
        });
        css += root.toString();
        delete bundle[name];
      }
      for (const file of Object.values(bundle)) {
        if (file.type === "chunk") file.code = file.code.replace(/__SOLENOID_CSS__/g, () => JSON.stringify(css));
      }
      const hostCss = readFileSync(path.join(import.meta.dirname, "src/host.css"), "utf8");
      this.emitFile({ type: "asset", fileName: "styles.css", source: `${fonts.join("\n")}\n${hostCss}` });
      this.emitFile({ type: "asset", fileName: "manifest.json", source: readFileSync(path.join(import.meta.dirname, "manifest.json")) });
    },
    // `PLUGIN_REPORT=1` lists what the bundle pulled in, largest first; with
    // `PLUGIN_TRACE=src/graph/x.ts,…` it also prints how the entry reaches each of those.
    writeBundle(_options, bundle) {
      if (!process.env.PLUGIN_REPORT) return;
      const rows: [number, string][] = [];
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        for (const [id, m] of Object.entries(file.modules)) rows.push([m.renderedLength, path.relative(REPO, id)]);
      }
      rows.sort((a, b) => b[0] - a[0]);
      const chains = (process.env.PLUGIN_TRACE ?? "").split(",").filter(Boolean).map((target) => {
        const goal = [...this.getModuleIds()].find((id) => id.endsWith(target));
        if (!goal) return `${target}: not in the bundle`;
        const next = new Map<string, string | null>([[goal, null]]);
        const queue = [goal];
        let entry: string | null = null;
        while (queue.length && !entry) {
          const id = queue.shift()!;
          for (const importer of this.getModuleInfo(id)?.importers ?? []) {
            if (next.has(importer)) continue;
            next.set(importer, id);
            if (this.getModuleInfo(importer)?.isEntry) { entry = importer; break; }
            queue.push(importer);
          }
        }
        const chain: string[] = [];
        for (let at = entry; at; at = next.get(at) ?? null) chain.push(path.relative(REPO, at));
        return `${target}:\n  ${chain.join("\n  -> ")}`;
      });
      const total = rows.reduce((s, r) => s + r[0], 0);
      writeFileSync(
        path.join(OUT, "bundle-report.txt"),
        [...chains, `${rows.length} modules, ${total} bytes`, ...rows.map((r) => `${r[0]}\t${r[1]}`)].join("\n"),
      );
    },
  };
}

export default defineConfig({
  root: REPO,
  publicDir: false,
  plugins: [
    shims(),
    react(),
    shadowCss(),
    // Every bundled package's license, beside the release files (the fonts are OFL, the rest MIT).
    license({ thirdParty: { includePrivate: false, multipleVersions: true, output: { file: path.join(OUT, "third-party-licenses.txt"), encoding: "utf-8" } } }),
  ],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: OUT,
    // The folder also holds the plugin's own `data.json`.
    emptyOutDir: false,
    cssCodeSplit: false,
    minify: !process.env.PLUGIN_DEBUG,
    lib: { entry: path.join(import.meta.dirname, "src/main.tsx"), formats: ["cjs"], fileName: () => "main.js" },
    rollupOptions: {
      external: ["obsidian", "electron"],
      // Tracing only: lets a build finish while a shim is still short an export.
      shimMissingExports: !!process.env.PLUGIN_TRACE,
      output: { exports: "default", codeSplitting: false },
    },
  },
});
