// [[C130]] rustCore, [[C120]] linearWork
// A big frame or list that crossed to or from the core is kept there under an id while its JavaScript object lives
// (`nodes/columnar.rs` `keep`); a value never changes in place once a card made it, so its identity is its content.
import { onWasmEngineReset, wasmCardForget } from "./engineWasm";

let ids = new WeakMap<object, number>();
let generation = 0;
const collected: number[] = [];
const gone = typeof FinalizationRegistry !== "undefined"
  ? new FinalizationRegistry<[number, number]>(([gen, id]) => { if (gen === generation) collected.push(id); })
  : null;
onWasmEngineReset(() => { ids = new WeakMap(); generation++; collected.length = 0; });

/** `v` is the value the core keeps under `id`. */
export function holdAs(v: object, id: number): void {
  if (!gone) { collected.push(id); return; }
  ids.set(v, id);
  gone.register(v, [generation, id]);
}

/** The id the core keeps `v` under, if it does. */
export function heldId(v: unknown): number | undefined {
  return v !== null && typeof v === "object" ? ids.get(v) : undefined;
}

/** Tells the core which kept values' objects were collected. Called before a call into the core, never inside one. */
export function forgetCollected(): void {
  if (collected.length) wasmCardForget(Uint32Array.from(collected.splice(0)));
}
