// dte:C2
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

// Resolve once every card has reported a real measured size (RF's onNodesChange
// `dimensions` → view.setSize), or after a frame budget. ELK then lays out on the
// cards' TRUE heights instead of the declared estimate — a content-sized card (a
// Frame preview, a Note) renders taller than its constructor height, and a headless
// layout that trusts the estimate stacks a neighbor into it. Cards must be COMPUTED
// first: an unfilled Frame preview measures short.
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
  /** Skip the headless ELK/Tidy pass — the build fn positions the nodes itself (for
   *  a scene ELK can't arrange well, e.g. unwired cards that should sit side by side). */
  manualLayout?: boolean;
  /** The scene reads a connection (a Vault Folder). Its first compute kicks off an
   *  async read and returns empty, so wait for every in-flight read to land and
   *  recompute before measuring — the headless-run pattern (whenConnectionsSettled). */
  awaitConnections?: boolean;
}) {
  const stack = useMemo(makeSceneStack, []);
  const rfId = useId();
  // The scene lays out headlessly (ELK) AFTER mount, so the cards start stacked at the
  // origin and move. Hold the entrance choreography until that has settled, or it would
  // play at the wrong place — SceneInner flips this once the cards are framed.
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
      // No fitViewOnInit: SceneInner frames AFTER the ELK layout has moved the cards,
      // so the one-shot init fit can't fire on the pre-layout (origin-stacked) graph.
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

// Inside the provider, so it can frame with fitView once the real work has landed:
// build the graph, reconcile the mutable sockets, lay it out headlessly with the
// app's ELK/Tidy, compute the values once, then fit to the laid-out cards.
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
  // Make the scene's nodes resolvable by the render-time cross-node resolvers (output
  // socket type → date formatting, docked FC → unit annotation). Without this a scene
  // Display shows a date as its raw serial and a united result as base SI. Registered
  // for the life of the mount; never the action target.
  useEffect(() => registerOwnedGraph({ editor: stack.editor, view: stack.view }), [stack]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await build(stack);
      if (cancelled) return;
      reconcileFcTypes(stack.editor, stack.view);
      // Compute BEFORE laying out: the cards then render their real content, so their
      // measured heights (fed to ELK below) are the true card sizes, not empty stubs.
      await computeStack(stack, false);
      if (cancelled) return;
      // A connection node's first compute returns empty and kicks off an async read;
      // wait for every read to land, then recompute so the real value is present
      // before measuring. Loop to a fixed point — a recompute can start a new read (a
      // reader feeding another reader) — settling once more each time, until a compute
      // starts nothing new.
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
        // Stamp each node's box from its rendered size so ELK reserves the real space.
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
      // Two frames for the moved cards to re-measure, then frame them and start the
      // entrance choreography (cards are now at their laid-out positions).
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          // Bump every node so it re-renders and re-measures its handles now that the cards
          // sit at their laid-out positions with real content — routed through the version
          // bump so updateNodeInternals runs in the adapter's effect AFTER the DOM commits
          // (a bare imperative call fired too early and left the cables a pixel high). This
          // is exactly what a manual collapse/expand does. Frame + reveal on the next frame,
          // once the re-measure has landed.
          for (const n of stack.editor.getNodes()) void stack.view.rerenderNode(n.id);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (cancelled) return;
              void fitView({ padding: 0.16, duration: 0 });
              onReady();
            }),
          );
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
