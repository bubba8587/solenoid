import { defineConfig } from "vitest/config";

// Headless logic tests — no DOM, no Rete rendering. Node compute lives in
// pure `data()` methods and standalone helper modules (excelFormula, mathUtils,
// coerce, unit conversion), all exercisable without the UI.
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@solenoid/schedule-engine": path.resolve("packages/schedule-engine/src/index.ts"),
      "@solenoid/gantt-layout": path.resolve("packages/gantt-layout/src/index.ts"),
      "@solenoid/gantt-react": path.resolve("packages/gantt-react/src/index.ts"),
    },
  },
  esbuild: { keepNames: true },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    maxWorkers: 4,
  },
});
