// [[C130]] rustCore, [[C120]] linearWork
// A big frame or list that crossed between JavaScript and the core, either way, is kept by the core under an id for as
// long as its JavaScript object lives, so the same object crossing again sends the id alone (`nodes/columnar.rs`
// `keep`). A value is never changed in place once a card made it, so an object's identity is its content. The core
// forgets an id once the object is collected; a fresh instance after a trap starts with none.
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
