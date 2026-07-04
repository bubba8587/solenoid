import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import license from "rollup-plugin-license";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

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
