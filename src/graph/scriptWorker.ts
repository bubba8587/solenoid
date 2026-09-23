// [[C66]]
// The Script sandbox: the worker drops every I/O door (network, storage, spawning) before the first call. `import()`
// can't be removed; this guards against accidents, not a hostile author.
import { invokeScript } from "./nodes/scriptRun";

type Scope = {
  postMessage: (msg: unknown) => void;
  onmessage: ((e: MessageEvent<{ id: number; src: string; args: unknown[] }>) => void) | null;
};
const scope = self as unknown as Scope;
const reply = scope.postMessage.bind(scope);

const DOORS = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection",
  "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker",
  "Notification", "navigator", "postMessage",
];
for (const name of DOORS) {
  let o: object | null = self;
  while (o) {
    if (Object.prototype.hasOwnProperty.call(o, name)) {
      try { delete (o as Record<string, unknown>)[name]; } catch { /* non-configurable: stays */ }
    }
    o = Object.getPrototypeOf(o);
  }
}

scope.onmessage = async (e) => {
  const { id, src, args } = e.data;
  reply({ id, outcome: await invokeScript(src, args) });
};
