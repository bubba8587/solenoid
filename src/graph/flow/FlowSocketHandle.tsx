// [[engineering#Performance]], [[B3]] sameNodeEverywhere
import { useSyncExternalStore, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from "react";
import { Position, useNodeId, useReactFlowStoreApi, addEdge, type Connection } from "@xyflow/react";
import { XYHandle, isMouseEvent, getHostForElement } from "@xyflow/system";
import { SocketComponent } from "../components/SocketComponent";
import { SocketLitRing } from "../components/NodeSocket";
import type { FlowSocketProps } from "../flowSurface";
import { litTargetStore } from "./FlowConnectionLine";

/** React Flow's handle markup, rendered here so a socket never subscribes to the RF store (react-flow-surface-contract § Sockets). */
const IDLE_CLASSES = "connectable connectablestart connectableend connectionindicator";

export function FlowSocketHandle({ side, socketKey, payload, shape, lit, flipped }: FlowSocketProps) {
  const nodeId = useNodeId();
  const { optionsStore: store, viewportStore, connectionStore, nodesStore, edgesStore } = useReactFlowStoreApi();
  const isValidTarget = useSyncExternalStore(litTargetStore.subscribe, () => litTargetStore.get() === litTargetStore.key(nodeId, socketKey));
  const visualSide = flipped ? (side === "input" ? "output" : "input") : side;
  const type = side === "input" ? "target" : "source";
  const position = visualSide === "input" ? Position.Left : Position.Right;
  const { rfId, noPanClassName } = store.getState();

  const connect = (params: Connection) => {
    const { defaultEdgeOptions, onConnect, hasDefaultEdges } = store.getState();
    const edgeParams = { ...defaultEdgeOptions, ...params };
    if (hasDefaultEdges) {
      const { setEdges, onError } = store.getState();
      setEdges(addEdge(edgeParams, edgesStore.getState().edges, { onError }));
    }
    onConnect?.(edgeParams);
  };

  const onPointerDown = (event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => {
    if (!nodeId) return;
    const mouse = isMouseEvent(event.nativeEvent);
    if (mouse && (event as ReactMouseEvent).button !== 0) return;
    const s = store.getState();
    XYHandle.onPointerDown(event.nativeEvent, {
      handleDomNode: event.currentTarget,
      autoPanOnConnect: s.autoPanOnConnect,
      connectionMode: s.connectionMode,
      connectionRadius: s.connectionRadius,
      domNode: s.domNode,
      nodeLookup: nodesStore.getState().nodeLookup,
      lib: "react",
      isTarget: type === "target",
      handleId: socketKey,
      nodeId,
      flowId: s.rfId,
      panBy: s.panBy,
      cancelConnection: s.cancelConnection,
      onConnectStart: s.onConnectStart,
      onConnectEnd: (...args) => store.getState().onConnectEnd?.(...args),
      updateConnection: s.updateConnection,
      onConnect: connect,
      isValidConnection: (...args) => store.getState().isValidConnection?.(...args) ?? true,
      getTransform: () => viewportStore.getState().transform,
      getFromHandle: () => connectionStore.getState().connection.fromHandle,
      autoPanSpeed: s.autoPanSpeed,
      dragThreshold: s.connectionDragThreshold,
    });
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const { onClickConnectStart, onClickConnectEnd, updateConnectionClickStart, connectionMode, isValidConnection, rfId: flowId, connectOnClick } = store.getState();
    const { connectionClickStartHandle, connection: connectionState } = connectionStore.getState();
    const { nodeLookup } = nodesStore.getState();
    if (!connectOnClick || !nodeId) return;
    if (!connectionClickStartHandle) {
      onClickConnectStart?.(event.nativeEvent, { nodeId, handleId: socketKey, handleType: type });
      updateConnectionClickStart({ nodeId, type, id: socketKey });
      return;
    }
    const { connection, isValid } = XYHandle.isValid(event.nativeEvent, {
      handle: { nodeId, id: socketKey, type },
      connectionMode,
      fromNodeId: connectionClickStartHandle.nodeId,
      fromHandleId: connectionClickStartHandle.id || null,
      fromType: connectionClickStartHandle.type,
      isValidConnection,
      flowId,
      doc: getHostForElement(event.target as HTMLElement),
      lib: "react",
      nodeLookup,
    });
    if (isValid && connection) connect(connection);
    const ended = structuredClone(connectionState) as Partial<typeof connectionState> & { toPosition?: unknown };
    delete ended.inProgress;
    ended.toPosition = ended.toHandle ? ended.toHandle.position : null;
    onClickConnectEnd?.(event.nativeEvent, ended as never);
    updateConnectionClickStart(null);
  };

  return (
    <div
      data-handleid={socketKey}
      data-nodeid={nodeId ?? undefined}
      data-handlepos={position}
      data-id={`${rfId}-${nodeId}-${socketKey}-${type}`}
      className={`react-flow__handle react-flow__handle-${position} nodrag ${noPanClassName} sol-rf-handle-reset ${type} ${IDLE_CLASSES}`}
      onMouseDown={onPointerDown}
      onTouchStart={onPointerDown}
      onClick={onClick}
    >
      <SocketComponent data={payload} />
      {isValidTarget && !lit && <SocketLitRing shape={shape} />}
    </div>
  );
}
