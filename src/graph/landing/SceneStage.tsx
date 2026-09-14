import { useEffect, useId, useMemo } from "react";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { ReactFlowProvider } from "@xyflow/react";
import type { Schemes } from "../schemes";
import { FlowSurfaceContext } from "../flowSurface";
import { FlowSurface, idleHandlers, type SurfaceStack, type SurfaceHooks } from "../flow/FlowSurface";
import { makeFlowView } from "../flow/flowView";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import { reconcileFcTypes } from "../fcReconcile";
import { makeEnsureElk, elkTidyLayout, tidyOptionsFromSettings } from "../tidyArrange";
import { computeStack } from "./landingCompute";

// ELK is loaded once, shared by every scene card (makeEnsureElk caches the instance).
const ensureElk = makeEnsureElk(() => false);

// A locked, self-contained real canvas for a landing feature card: the actual node
// components (so they can never drift from the app), over a LOCAL stack, computed
// ONCE at build. It never claims the process.ts globals for interaction — the hero
// canvas owns those — so this card is view-only (locked). The build fn adds the
// scene's nodes/cables through the stack's editor/view, exactly like any surface.

function makeSceneStack(): SurfaceStack {
  const editor = new NodeEditor<Schemes>();
  installInputCoercion(editor);
  editor.addPipe((ctx) => {
    if (ctx.type === "nodecreated") installErrorGuards(ctx.data);
    return ctx;
  });
  const engine = new DataflowEngine<Schemes>();
  editor.use(engine);
  const handlers = idleHandlers();
  const view = makeFlowView(editor, {
    bumpNode: (id) => handlers.bumpNode(id),
    bumpConnections: () => handlers.bumpConnections(),
    moveNode: (id, pos) => handlers.moveNode(id, pos),
    setViewport: (v) => handlers.setViewport(v),
    getContainer: () => handlers.getContainer(),
  });
  const s: SurfaceStack = { editor, engine, view, handlers };
  // A locked card takes no edits, so the only topology change is the build itself:
  // reflect it into RF state (no recompute here — computeStack does the one pass).
  let queued = false;
  editor.addPipe((ctx) => {
    const t = (ctx as { type?: string }).type;
    if (
      t === "nodecreated" || t === "noderemoved" ||
      t === "connectioncreated" || t === "connectionremoved"
    ) {
      if (!queued) {
        queued = true;
        queueMicrotask(() => {
          queued = false;
          handlers.syncTopology();
        });
      }
    }
    return ctx;
  });
  return s;
}

const NOOP = () => {};
const ASYNC_NOOP = async () => {};

export function SceneStage({
  build,
  className,
}: {
  build: (s: SurfaceStack) => Promise<void>;
  className?: string;
}) {
  const stack = useMemo(makeSceneStack, []);
  const rfId = useId();

  useEffect(() => {
    void (async () => {
      await build(stack);
      // Mutable sockets (FC / Convert / adoptive) reconcile against the wired types,
      // then lay the graph out headlessly with the app's own ELK/Tidy, then compute
      // the values once.
      reconcileFcTypes(stack.editor, stack.view);
      const elk = await ensureElk();
      if (elk) {
        await elkTidyLayout(elk, {
          nodes: stack.editor.getNodes(),
          connections: stack.editor.getConnections(),
          options: tidyOptionsFromSettings(),
          translate: (id, x, y) => stack.view.moveNode(id, { x, y }),
        });
      }
      await computeStack(stack, false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack]);

  const hooks: SurfaceHooks = useMemo(
    () => ({
      rfId: `scene${rfId}`,
      locked: true,
      staticView: true,
      noKeyboard: true,
      noContextMenu: true,
      standoffs: false,
      drawnCables: false,
      fitViewOnInit: true,
      history: { undo: ASYNC_NOOP, redo: ASYNC_NOOP },
      deleteSelected: ASYNC_NOOP,
      afterMove: NOOP,
      afterProgrammaticMove: NOOP,
      afterNodeAdded: ASYNC_NOOP,
      afterConnect: NOOP,
    }),
    [rfId],
  );

  return (
    <div className={`sol-scene-stage${className ? ` ${className}` : ""}`}>
      <ReactFlowProvider>
        <FlowSurfaceContext.Provider value={true}>
          <FlowSurface stack={stack} hooks={hooks} />
        </FlowSurfaceContext.Provider>
      </ReactFlowProvider>
    </div>
  );
}
