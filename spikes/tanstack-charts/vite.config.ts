import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: __dirname, plugins: [react()], server: { port: 1430 }, preview: { port: 1431 },
  build: { outDir: resolve(__dirname, "../../.spike-dist"), emptyOutDir: true, target: "esnext",
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), perf: resolve(__dirname, "perf.html") } } },
});
