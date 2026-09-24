// [[B3]] sameNodeEverywhere
import { useEffect, useId, useMemo, useState } from "react";
import { NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { Schemes } from "../schemes";
import { FlowSurfaceContext, FlowRevealContext } from "../flowSurface";
import { FlowSurface, idleHandlers, type SurfaceStack, type SurfaceHooks } from "../flow/FlowSurface";
import { makeFlowView } from "../flow/flowView";
import { installInputCoercion } from "../coerceInputs";
import { installErrorGuards } from "../errorValue";
import { reconcileFcTypes } from "../fcReconcile";
import { makeEnsureElk, elkTidyLayout, tidyOptionsFromSettings } from "../tidyArrange";
import { measuredBox } from "../nodeSize";
import { registerOwnedGraph } from "../activeGraph";
import { whenConnectionsSettled, hasInflightConnections } from "../connectionStore";
import { computeStack } from "./landingCompute";

const ensureElk = makeEnsureElk(() => false);


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
  // A locked card's only topology change is the build; no recompute here, computeStack does the one pass.
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

// ELK must lay out on measured heights of computed cards: a content-sized card renders taller than its constructor height.
function waitForMeasured(stack: SurfaceStack, budget = 30): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    const tick = () => {
      const ids = stack.editor.getNodes().map((n) => n.id);
      if (ids.every((id) => stack.view.measured?.(id)) || frames++ >= budget) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function SceneStage({
  build,
  className,
  manualLayout,
  awaitConnections,
}: {
  build: (s: SurfaceStack) => Promise<void>;
  className?: string;
  /** The build fn positions the nodes itself, so the ELK/Tidy pass is skipped. */
  manualLayout?: boolean;
  /** The scene reads a connection: wait for every in-flight read and recompute before measuring. */
  awaitConnections?: boolean;
}) {
  const stack = useMemo(makeSceneStack, []);
  const rfId = useId();
  // Held until the headless layout settles, or the entrance plays at the origin-stacked positions.
  const [ready, setReady] = useState(false);

  const hooks: SurfaceHooks = useMemo(
    () => ({
      rfId: `scene${rfId}`,
      locked: true,
      staticView: true,
      noKeyboard: true,
      noContextMenu: true,
      standoffs: false,
      drawnCables: false,
      // No fitViewOnInit: the init fit would frame the pre-layout, origin-stacked graph.
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
    <div className={`sol-scene-stage${ready ? " sol-flow-reveal" : ""}${className ? ` ${className}` : ""}`}>
      <ReactFlowProvider>
        <FlowSurfaceContext.Provider value={true}>
          <FlowRevealContext.Provider value={ready}>
            <SceneInner
              stack={stack}
              build={build}
              hooks={hooks}
              manualLayout={manualLayout}
              awaitConnections={awaitConnections}
              onReady={() => setReady(true)}
            />
          </FlowRevealContext.Provider>
        </FlowSurfaceContext.Provider>
      </ReactFlowProvider>
    </div>
  );
}

function SceneInner({
  stack,
  build,
  hooks,
  manualLayout,
  awaitConnections,
  onReady,
}: {
  stack: SurfaceStack;
  build: (s: SurfaceStack) => Promise<void>;
  hooks: SurfaceHooks;
  manualLayout?: boolean;
  awaitConnections?: boolean;
  onReady: () => void;
}) {
  const { fitView } = useReactFlow();
  // Registered so render-time resolvers find the scene's nodes, or a Display shows raw serials and base SI.
  useEffect(() => registerOwnedGraph({ editor: stack.editor, view: stack.view }), [stack]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await build(stack);
      if (cancelled) return;
      reconcileFcTypes(stack.editor, stack.view);
      // Compute before layout, so the measured heights fed to ELK are real card sizes.
      await computeStack(stack, false);
      if (cancelled) return;
      // A recompute can start a new read (a reader feeding a reader), so settle to a fixed point.
      if (awaitConnections) {
        do {
          await whenConnectionsSettled();
          if (cancelled) return;
          await computeStack(stack, false);
          if (cancelled) return;
        } while (hasInflightConnections());
      }
      if (!manualLayout) {
        await waitForMeasured(stack);
        if (cancelled) return;
        for (const n of stack.editor.getNodes()) {
          const b = measuredBox(stack.view, n.id, stack.editor);
          if (b) Object.assign(n as unknown as { width: number; height: number }, { width: b.w, height: b.h });
        }
        const elk = await ensureElk();
        if (cancelled) return;
        if (elk) {
          await elkTidyLayout(elk, {
            nodes: stack.editor.getNodes(),
            connections: stack.editor.getConnections(),
            options: tidyOptionsFromSettings(),
            translate: (id, x, y) => stack.view.moveNode(id, { x, y }),
          });
        }
      }
      // Two frames for the moved cards to re-measure before framing and the entrance.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          void fitView({ padding: 0.16, duration: 0 });
          onReady();
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack]);
  return <FlowSurface stack={stack} hooks={hooks} />;
}
