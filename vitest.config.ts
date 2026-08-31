import { defineConfig } from "vitest/config";

// Headless logic tests — no DOM, no Rete rendering. Node compute lives in
// pure `data()` methods and standalone helper modules (excelFormula, mathUtils,
// coerce, unit conversion), all exercisable without the UI.
export default defineConfig({
  esbuild: { keepNames: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}"],
    maxWorkers: 4,
  },
});
