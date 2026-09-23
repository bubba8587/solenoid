// The shared-module test run (vitest `isolate: false`): files share one module
// cache per worker, so each file's global edits are undone after it. A file that
// mocks a module stays in the isolated project instead (vitest.config.ts).
import { afterAll, vi } from "vitest";
import { setEditorRefs } from "../../src/graph/process";
import { setActiveGraph } from "../../src/graph/activeGraph";
import { settingsStore, DEFAULT_SETTINGS, type Settings } from "../../src/graph/settingsStore";
import { forgetAllNodes } from "../../src/graph/nodeStoreRegistry";
import { standoffStore } from "../../src/graph/standoffs";
import { drawnCableStore } from "../../src/graph/drawnCables";
import { cableSelectionStore } from "../../src/graph/cableState";
import { forceDemoVault } from "../../src/graph/demoVault";
import { resetPointerCensus } from "../../src/graph/pointerGesture";

const SNAPSHOT = Symbol.for("solenoid.test.globals");
type Snap = Map<PropertyKey, PropertyDescriptor>;
const g = globalThis as unknown as Record<PropertyKey, unknown> & { [SNAPSHOT]?: Snap };

if (!g[SNAPSHOT]) {
  const snap: Snap = new Map();
  for (const key of Reflect.ownKeys(globalThis)) {
    const d = Object.getOwnPropertyDescriptor(globalThis, key);
    if (d) snap.set(key, d);
  }
  g[SNAPSHOT] = snap;
}

afterAll(() => {
  // The app's module-level slots: a file's fake editor/view must not reach the next file.
  setEditorRefs(null as never, null as never, null as never);
  setActiveGraph(null);
  // Node-keyed stores and the canvas-wide selections (a leaked standoff selection
  // would make the next file's delete remove it instead of the node).
  forgetAllNodes();
  standoffStore.clear();
  drawnCableStore.clear();
  cableSelectionStore.clear();
  forceDemoVault(false);
  // A finger left down in one file reads as a pinch to the next file's lasso.
  resetPointerCensus();
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) settingsStore.set(key, DEFAULT_SETTINGS[key] as never);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const snap = g[SNAPSHOT]!;
  for (const key of Reflect.ownKeys(globalThis)) {
    if (key === SNAPSHOT) continue;
    const before = snap.get(key);
    const now = Object.getOwnPropertyDescriptor(globalThis, key);
    if (!before) {
      if (now?.configurable) delete g[key];
    } else if (now && (now.value !== before.value || now.get !== before.get || now.set !== before.set) && now.configurable) {
      Object.defineProperty(globalThis, key, before);
    }
  }
});
