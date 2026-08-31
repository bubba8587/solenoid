// Class-name → constructor registry: copyPaste.ts can't import nodeCtorRegistry
// directly (catalogUtils → nodeCatalog → rete-nodes → composite → copyPaste cycle).
let _ctorRegistryProvider: () => Map<string, new (init?: Record<string, unknown>) => object> = () => new Map();

export function setCtorRegistryProvider(fn: typeof _ctorRegistryProvider) {
  _ctorRegistryProvider = fn;
}

export function getCtorRegistry() {
  return _ctorRegistryProvider();
}

