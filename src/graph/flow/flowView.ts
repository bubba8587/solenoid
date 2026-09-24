// [[B10]] reactFlowView, [[C43]] oneFlowSurface
import type { NodeEditor } from "rete";
import type { Schemes } from "../schemes";
import type { View } from "../view";
import { clampZoom } from "../viewPresets";

export type FlowViewCallbacks = {
  bumpNode(id: string): void;
  bumpConnections(): void;
  moveNode(id: string, pos: { x: number; y: number }): void;
  setViewport(v: { x: number; y: number; zoom: number }): void;
  getContainer(): HTMLElement | null;
};

export type FlowView = View & {
  setTransform(t: { x: number; y: number; k: number }): void;
  setPointer(p: { x: number; y: number }): void;
  setSize(id: string, size: { w: number; h: number }): void;
};

export function makeFlowView(editor: NodeEditor<Schemes>, cb: FlowViewCallbacks): FlowView {
  const sizes = new Map<string, { w: number; h: number }>();
  const transform = { x: 0, y: 0, k: 1 };
  const pointer = { x: 0, y: 0 };
  const detached = document.createElement("div");
  const renderListeners = new Set<(id: string) => void>();

  const pushViewport = () => cb.setViewport({ x: transform.x, y: transform.y, zoom: transform.k });

  const view: FlowView = {
    hasNode(id) {
      return !!editor.getNode(id);
    },
    position(id) {
      return editor.getNode(id)?.position;
    },
    nodeElement(id) {
      return document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(id)}"]`,
      );
    },
    connectionElement(id) {
      return document.querySelector<HTMLElement>(
        `.react-flow__edge[data-id="${CSS.escape(id)}"]`,
      );
    },
    get container(): HTMLElement {
      return cb.getContainer() ?? detached;
    },
    get viewport(): HTMLElement {
      return cb.getContainer()?.querySelector<HTMLElement>(".react-flow__viewport") ?? detached;
    },
    transform,
    pointer,
    async zoom(k, ox = 0, oy = 0) {
      transform.k = clampZoom(k);
      transform.x += ox;
      transform.y += oy;
      pushViewport();
    },
    async pan(x, y) {
      transform.x = x;
      transform.y = y;
      pushViewport();
    },
    async moveNode(id, pos) {
      const node = editor.getNode(id);
      if (!node) return;
      node.position = { x: pos.x, y: pos.y };
      cb.moveNode(id, pos);
    },
    async rerenderNode(id) {
      cb.bumpNode(id);
      for (const l of renderListeners) l(id);
    },
    async rerenderCables() {
      cb.bumpConnections();
    },
    onRender(fn) {
      renderListeners.add(fn);
      return () => { renderListeners.delete(fn); };
    },
    measured(id) {
      return sizes.get(id);
    },
    setTransform(t) {
      transform.x = t.x;
      transform.y = t.y;
      transform.k = t.k;
    },
    setPointer(p) {
      pointer.x = p.x;
      pointer.y = p.y;
    },
    setSize(id, size) {
      sizes.set(id, size);
    },
  };
  return view;
}
