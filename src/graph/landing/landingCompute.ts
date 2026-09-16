import { getEditor, getEngine, getView, setEditorRefs, processGraph } from "../process";
import type { SurfaceStack } from "../flow/FlowSurface";

// The landing page mounts several local canvases (the interactive hero + the
// locked scene cards) but process.ts has ONE global editor/engine/view slot, and
// processGraph runs only over it. Every build-time compute serializes through this
// one chain so two never overlap and corrupt the slot mid-pass: point the globals
// at a stack, run a single pass (values land in the id-keyed, additive
// cableValueStore and persist), then either KEEP the globals there (the hero, which
// stays live) or RESTORE the previous owner (a locked scene only borrows the slot
// for its one compute). After load only the hero holds the slot, so its
// interaction-driven recomputes run without any borrowing in flight.
let chain: Promise<void> = Promise.resolve();

export function computeStack(stack: SurfaceStack, keepGlobal = false): Promise<void> {
  chain = chain.then(async () => {
    const prevEditor = getEditor();
    const prevEngine = getEngine();
    const prevView = getView();
    setEditorRefs(stack.editor, stack.engine, stack.view);
    try {
      await processGraph();
    } finally {
      if (!keepGlobal && prevEditor && prevEngine && prevView) {
        setEditorRefs(prevEditor, prevEngine, prevView);
      }
    }
  });
  return chain;
}
