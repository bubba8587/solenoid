// [[C69]]
import { defineConfig } from "vitest/config";

// Headless logic tests — no DOM, no Rete rendering. Node compute lives in
// pure `data()` methods and standalone helper modules (excelFormula, mathUtils,
// coerce, unit conversion), all exercisable without the UI.
import path from "node:path";

const ALL = ["tests/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"];
// Files that call vi.mock (a mocked module must not reach another file), stub a
// global before importing the app (the import itself must see the stub), read the
// bundled demo vault (another file's unawaited load can leave it half-imported), or
// assert a module's initial state (another file's import changes it).
// sourceInvariants.test.ts fails a vi.mock file missing from this list.
const ISOLATED = [
  "tests/graph/coerceInputs.test.ts",
  "tests/graph/demoVault.test.ts",
  "tests/graph/documentStorePersist.test.ts",
  "tests/graph/fileSession.test.ts",
  "tests/graph/lazyChain.test.ts",
  "tests/graph/nodes/sink.test.ts",
  "tests/graph/obsidianWriteBatch.test.ts",
  "tests/graph/polarsBackend.test.ts",
  "tests/graph/saveTimeStore.test.ts",
];

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
    maxWorkers: 4,
    // Transformed modules persist across runs (in node_modules/.vite), so a rerun skips most transforms.
    fsModuleCache: true,
    // Re-importing the node catalog per file was most of the run, so files share each
    // worker's module cache; tests/setup/sharedWorker.ts undoes a file's global edits.
    // A file that mocks a module would leak the mock, so it runs isolated.
    projects: [
      { extends: true, test: { name: "shared", isolate: false, setupFiles: ["tests/setup/sharedWorker.ts"], include: ALL, exclude: ISOLATED } },
      { extends: true, test: { name: "isolated", include: ISOLATED } },
    ],
  },
});
