// [[B3]] sameNodeEverywhere
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
      await processGraph(undefined, undefined, { force: true });
    } finally {
      if (!keepGlobal && prevEditor && prevEngine && prevView) {
        setEditorRefs(prevEditor, prevEngine, prevView);
      }
    }
  });
  return chain;
}

/** Runs tasks one at a time; a task superseded by a newer one before it starts is dropped. */
export function latestOnlyQueue(): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  let latest = 0;
  return (task) => {
    const gen = ++latest;
    const run = tail.then(() => (gen === latest ? task() : undefined));
    tail = run.catch(() => {});
    return run;
  };
}
