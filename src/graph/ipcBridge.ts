// Thin wrapper over Tauri's `invoke` — the web layer's door to the native Rust
// engine. Guarded like `fileBridge.ts`: the browser/dev build has no Tauri
// runtime, so `engineAvailable()` is false there and callers fall back to the
// in-process JS path (the `FrameBackend` seam in WS2). The Rust side is in
// `src-tauri/src/ipc.rs`.
//
// Error convention: a Rust command returns its failure SolError-shaped
// (`{ __solError, code, message }`), so a rejected `invoke` is mapped straight
// back to a tagged `SolError` the rest of the app already handles — see
// `toSolError` below and `errorValue.ts`.
import { isDesktop } from "./fileBridge";
import { solError, isSolError, ERROR_EXPLANATIONS, type SolError, type SolErrorCode } from "./errorValue";
import { perfEnabled, recordIpc } from "./perfProbe";

// Cheap payload-size estimate for the perf probe: the number of cells being shipped,
// for the two commands that carry a whole frame (`source` uploads columns, `append`
// several). Avoids JSON.stringify — walks column value counts only. Anything else is
// a handle/opts scalar, so 0. Called only when the probe is on.
function estimateCells(args?: Record<string, unknown>): number {
  const cols = (args?.frame as { columns?: { values?: unknown[] }[] } | undefined)?.columns;
  if (Array.isArray(cols)) return cols.reduce((n, c) => n + (c.values?.length ?? 0), 0);
  return 0;
}

/** The native Rust engine only exists inside the desktop shell. Callers use this
 *  to choose the native path vs the in-process JS fallback. */
export function engineAvailable(): boolean {
  return isDesktop();
}

// The real canonical code set (keys of ERROR_EXPLANATIONS — one source of truth
// in errorValue.ts), not a "starts with #" heuristic. A foreign or malformed code
// from the boundary is coerced to #ERROR! rather than trusted.
const CANONICAL_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_EXPLANATIONS));

function isCanonicalCode(c: unknown): c is SolErrorCode {
  return typeof c === "string" && CANONICAL_CODES.has(c);
}

/** Coerce anything thrown across the IPC boundary into a tagged `SolError` with a
 *  CANONICAL code. A Rust `IpcError` already arrives SolError-shaped, but its code
 *  is validated all the same — Rust always sets `__solError: true`, so without this
 *  a bad code (`IpcError::new("weird", …)`) would leak through untouched. A bare
 *  string / Error / unknown collapses to `#ERROR!` so a failure is never swallowed. */
export function toSolError(thrown: unknown): SolError {
  if (isSolError(thrown)) {
    // Tagged, but still must carry a canonical code; re-mint if Rust sent a bad one.
    return isCanonicalCode(thrown.code) ? thrown : solError("#ERROR!", thrown.message);
  }
  if (thrown && typeof thrown === "object") {
    const o = thrown as Record<string, unknown>;
    const message = typeof o.message === "string" ? o.message : "IPC call failed";
    if (isCanonicalCode(o.code)) return solError(o.code, message);
    return solError("#ERROR!", message);
  }
  if (typeof thrown === "string") return solError("#ERROR!", thrown);
  return solError("#ERROR!", "IPC call failed");
}

/** Call a Rust command, resolving its result or throwing a tagged `SolError` on
 *  any failure. Desktop-only — calling without the engine throws `#ERROR!`, so
 *  guard with `engineAvailable()` first. `invoke` is imported lazily so this
 *  module stays Tauri-free at load (node tests, the web bundle). */
export async function ipcInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!engineAvailable()) {
    throw solError("#ERROR!", `IPC '${command}' called without the desktop engine`);
  }
  const probe = perfEnabled();
  const t0 = probe ? performance.now() : 0;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch (e) {
    throw toSolError(e);
  } finally {
    if (probe) recordIpc(command, performance.now() - t0, estimateCells(args));
  }
}

/** Identity the native engine reports — mirrors `ipc::EngineInfo`. `backend` is
 *  "polars" now that WS2's engine is wired; `initFrameBackend` selects the Polars
 *  frame backend when it sees that. */
export interface EngineInfo {
  name: string;
  version: string;
  backend: string;
}

/** Round-trip the Rust engine. Returns its info on desktop, or null in the
 *  browser (no native side). A quick health check for the IPC boundary. */
export async function enginePing(): Promise<EngineInfo | null> {
  if (!engineAvailable()) return null;
  return ipcInvoke<EngineInfo>("engine_ping");
}
