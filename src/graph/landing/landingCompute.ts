// [[C2]] realCanvasScenes
import { getEditor, getEngine, getView, setEditorRefs, processGraph } from "../process";
import type { SurfaceStack } from "../flow/FlowSurface";

// Every build-time compute serializes through one chain, so two never overlap on the single process.ts slot.
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
