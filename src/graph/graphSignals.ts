// Tiny version/flag stores the canvas raises and cards subscribe to.
// Bumped by Canvas's editor pipe on connectioncreated / connectionremoved.
let _connVersion = 0;
const _connListeners = new Set<() => void>();

export function bumpConnectionVersion() {
  _connVersion++;
  for (const l of _connListeners) l();
}

export const connectionVersionStore = {
  get: () => _connVersion,
  subscribe: (l: () => void) => {
    _connListeners.add(l);
    return () => { _connListeners.delete(l); };
  },
};

// True across the pickup → drop window (connectionpick / connectiondrop).
let _cableDragging = false;
const _cableDragListeners = new Set<() => void>();

export function setCableDragging(v: boolean) {
  if (_cableDragging === v) return;
  _cableDragging = v;
  for (const l of _cableDragListeners) l();
}

export const cableDragStore = {
  get: () => _cableDragging,
  subscribe: (l: () => void) => {
    _cableDragListeners.add(l);
    return () => { _cableDragListeners.delete(l); };
  },
};

// Bumped whenever a Conduit's `angle` is mutated from OUTSIDE its own React root
// (the Canvas keyboard rotate); ConduitComponent subscribes here.
let _conduitAngleVersion = 0;
const _conduitAngleListeners = new Set<() => void>();

export function bumpConduitAngle() {
  _conduitAngleVersion++;
  for (const l of _conduitAngleListeners) l();
}

export const conduitAngleStore = {
  get: () => _conduitAngleVersion,
  subscribe: (l: () => void) => {
    _conduitAngleListeners.add(l);
    return () => { _conduitAngleListeners.delete(l); };
  },
};

