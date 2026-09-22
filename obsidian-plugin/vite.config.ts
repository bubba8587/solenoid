// [[C107]] obsidianPlugin
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import license from "rollup-plugin-license";
import postcss from "postcss";
import MagicString from "magic-string";
import { walk } from "estree-walker";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// App TypeScript, so the config is bundled to load; `VITE_CONFIG_NATIVE_IGNORE_WARNING` in the
// build scripts is Vite's way of saying so.
import { LOOK_CLASS, defaultLookCss, paletteLookCss } from "./src/lookTokens";

const REPO = path.resolve(import.meta.dirname, "..");
const SHIMS = path.join(import.meta.dirname, "src/shims");
// Where the build lands: `obsidian-plugin/dist/` (ignored), or `PLUGIN_OUT`. Never a vault by
// default: the demo vault installs the plugin from the community store, and the rig copies this
// build into its own private vault.
const OUT = process.env.PLUGIN_OUT ? path.resolve(process.env.PLUGIN_OUT) : path.join(import.meta.dirname, "dist");
const LOOK = path.join(import.meta.dirname, "src/look.css");
const SNIPPET = path.join(REPO, "demo-vault/.obsidian/snippets/solenoid.css");

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
  [path.join(REPO, "src/graph/appTheme.ts")]: path.join(SHIMS, "appTheme.ts"),
  [path.join(REPO, "src/graph/clipboard.ts")]: path.join(SHIMS, "clipboard.ts"),
  [path.join(REPO, "src/graph/mobileUa.ts")]: path.join(SHIMS, "mobileUa.ts"),
};
const REACT_DOM_SHIM = path.join(SHIMS, "reactDom.ts");

function shims(): Plugin {
  return {
    name: "solenoid-plugin-shims",
    enforce: "pre",
    resolveId(source, importer) {
      // App code only: react-dom/client reads its own internals off the real module.
      if (source === "react-dom") return importer?.startsWith(path.join(REPO, "src") + path.sep) ? REACT_DOM_SHIM : null;
      if (!importer || !source.startsWith(".")) return null;
      // By path, not by resolving: the plugin's own repository holds a snapshot of this source
      // with the stand-ins and WITHOUT the app modules they replace.
      const target = path.resolve(path.dirname(importer.split("?")[0]), source);
      return SHIMMED[`${target}.ts`] ?? SHIMMED[`${target}.tsx`] ?? SHIMMED[target] ?? null;
    },
  };
}

/** Globals the app's code reaches for, pointed at the plugin's own. In `src/graph/components/`
 *  a free `document` / `window` becomes the popup layer's (`shadow.ts`): in a popped-out note the
 *  globals are still the MAIN window's, and Escape, an outside press, the resize grip and
 *  measuring all use them. Anywhere in app code a free `localStorage` / `sessionStorage` becomes
 *  memory (`memoryStorage.ts`): a plugin keeps its data in Obsidian's plugin data. */
function pluginGlobals(): Plugin {
  const app = path.join(REPO, "src") + path.sep;
  const components = path.join(REPO, "src/graph/components") + path.sep;
  const from = { shadow: path.join(import.meta.dirname, "src/shadow.ts"), memory: path.join(import.meta.dirname, "src/memoryStorage.ts") };
  const WINDOW = { document: "__popupDocument", window: "__popupWindow" } as Record<string, string>;
  const STORAGE = { localStorage: "__memoryStorage", sessionStorage: "__memoryStorage" } as Record<string, string>;
  return {
    name: "solenoid-plugin-globals",
    enforce: "post",
    transform(code, id) {
      const file = id.split("?")[0];
      if (!file.startsWith(app) || !/\b(document|window|localStorage|sessionStorage)\b/.test(code)) return null;
      const names = { ...STORAGE, ...(file.startsWith(components) ? WINDOW : {}) };
      const out = new MagicString(code);
      const used = new Set<string>();
      walk(this.parse(code) as never, {
        enter(node: any, parent: any) {
          if (node.type !== "Identifier" || !(node.name in names) || !parent) return;
          if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
          if (/^(Property|PropertyDefinition|MethodDefinition)$/.test(parent.type) && parent.key === node && !parent.computed) return;
          if (parent.type === "UnaryExpression" && parent.operator === "typeof") return;
          out.overwrite(node.start, node.end, names[node.name]);
          used.add(names[node.name]);
        },
      });
      if (used.size === 0) return null;
      const imports: string[] = [];
      if (used.has("__popupDocument") || used.has("__popupWindow")) imports.push(`import { popupDocument as __popupDocument, popupWindow as __popupWindow } from ${JSON.stringify(from.shadow)};`);
      if (used.has("__memoryStorage")) imports.push(`import { memoryStorage as __memoryStorage } from ${JSON.stringify(from.memory)};`);
      out.prepend(imports.join("\n") + "\n");
      return { code: out.toString(), map: out.generateMap({ hires: true }) };
    },
  };
}

/** The Solenoid look, every rule scoped under `body.solenoid-look` (the settings toggle adds
 *  the class). `body`, `.theme-*` and Obsidian's platform classes (`.is-mobile`, `.is-phone`,
 *  `.is-tablet`) ARE the body, so they join it; the rest hang under it. Then one token block per
 *  built-in palette, under the palette's own class. */
function scopedLook(): string {
  const root = postcss.parse(readFileSync(LOOK, "utf8"));
  root.walkRules((rule) => {
    rule.selectors = rule.selectors.map((sel) => {
      if (/^body(?![\w-])/.test(sel)) return sel.replace(/^body/, `body.${LOOK_CLASS}`);
      if (/^\.(theme-(dark|light)|is-(mobile|phone|tablet))(?![\w-])/.test(sel)) return `body.${LOOK_CLASS}${sel}`;
      return `body.${LOOK_CLASS} ${sel}`;
    });
  });
  return root.toString() + paletteLookCss();
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
      this.emitFile({ type: "asset", fileName: "styles.css", source: `${fonts.join("\n")}\n${hostCss}\n${scopedLook()}` });
      this.emitFile({ type: "asset", fileName: "manifest.json", source: readFileSync(path.join(import.meta.dirname, "manifest.json")) });
    },
    // `PLUGIN_REPORT=1` lists what the bundle pulled in, largest first; with
    // `PLUGIN_TRACE=src/graph/x.ts,…` it also prints how the entry reaches each of those.
    writeBundle(_options, bundle) {
      // The demo vault wears the look as a snippet: the rules as they stand, with the Default
      // palette's tokens (a snippet cannot follow a setting).
      if (existsSync(path.dirname(SNIPPET))) writeFileSync(SNIPPET, readFileSync(LOOK, "utf8") + defaultLookCss());
      // `PLUGIN_MODULES=<file>`: every source file this build read, for the snapshot export.
      if (process.env.PLUGIN_MODULES) {
        const ids = [...this.getModuleIds()].map((id) => id.split("?")[0]).filter((id) => path.isAbsolute(id) && !id.includes("node_modules"));
        writeFileSync(process.env.PLUGIN_MODULES, JSON.stringify([...new Set(ids)].map((id) => path.relative(REPO, id)).sort(), null, 1));
      }
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
    pluginGlobals(),
    shadowCss(),
    // Every bundled package's license, beside the release files (the fonts are OFL, the rest MIT).
    license({ thirdParty: { includePrivate: false, multipleVersions: true, output: { file: path.join(OUT, "third-party-licenses.txt"), encoding: "utf-8" } } }),
  ],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: OUT,
    // `PLUGIN_OUT` may be a vault's plugin folder, which also holds the plugin's `data.json`.
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
