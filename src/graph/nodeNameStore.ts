// [[B10]] reactFlowView, [[C40]] storesRegisterForget, [[C19]] namingModel
import { createNotifier } from "./storeKit";
import { registerNodeForget, registerNodeForgetAll } from "./nodeStoreRegistry";
import { NAME_RE, typePrefix, nextAvailableName, counterCheckpoint } from "./nodeNaming";

const _names = new Map<string, string>();
const _ids = new Map<string, string>();
const _counters = new Map<string, number>();
const { notify, subscribe } = createNotifier();

function bumpCounter(name: string): void {
  const chk = counterCheckpoint(name);
  if (!chk) return;
  const cur = _counters.get(chk.prefix) ?? 1;
  if (chk.next > cur) _counters.set(chk.prefix, chk.next);
}

function generate(prefix: string): string {
  const { name, next } = nextAvailableName(prefix, (n) => _ids.has(n), _counters.get(prefix) ?? 1);
  _counters.set(prefix, next);
  return name;
}

export const nodeNameStore = {
  get: (id: string): string | undefined => _names.get(id),
  byName: (name: string): string | undefined => _ids.get(name),

  ensure(id: string, ctorName: string): string {
    const existing = _names.get(id);
    if (existing) return existing;
    const name = generate(typePrefix(ctorName));
    _names.set(id, name);
    _ids.set(name, id);
    notify();
    return name;
  },

  claim(id: string, name: string | undefined, fallbackCtorName: string): string {
    if (typeof name === "string" && NAME_RE.test(name) && _ids.get(name) !== id && !_ids.has(name)) {
      _names.set(id, name);
      _ids.set(name, id);
      bumpCounter(name);
      notify();
      return name;
    }
    return this.ensure(id, fallbackCtorName);
  },

  rename(id: string, newName: string): { ok: true } | { ok: false; reason: string } {
    if (!NAME_RE.test(newName)) {
      return { ok: false, reason: "Name must start with a letter or underscore and contain only letters, digits, or underscores." };
    }
    const owner = _ids.get(newName);
    if (owner && owner !== id) return { ok: false, reason: `"${newName}" is already in use.` };
    const old = _names.get(id);
    if (old === newName) return { ok: true };
    if (old) _ids.delete(old);
    _names.set(id, newName);
    _ids.set(newName, id);
    bumpCounter(newName);
    notify();
    return { ok: true };
  },

  forget(id: string): void {
    const name = _names.get(id);
    if (!name) return;
    _names.delete(id);
    _ids.delete(name);
    notify();
  },

  clear(): void {
    if (_names.size === 0 && _counters.size === 0) return;
    _names.clear();
    _ids.clear();
    _counters.clear();
    notify();
  },

  subscribe,
};

registerNodeForget(nodeNameStore.forget);
registerNodeForgetAll(() => nodeNameStore.clear());
