// The web layer's door to the native Rust engine (`src-tauri/src/ipc.rs`); callers
// must gate on `engineAvailable()`. Rust returns failures SolError-shaped.
import { isDesktop } from "./fileBridge";
import { solError, isSolError, ERROR_EXPLANATIONS, type SolError, type SolErrorCode } from "./errorValue";
import { perfEnabled, recordIpc } from "./perfProbe";

// Cell count for the perf probe — deliberately not JSON.stringify; anything without
// a frame payload is a handle/opts scalar, so 0.
function estimateCells(args?: Record<string, unknown>): number {
  const cols = (args?.frame as { columns?: { values?: unknown[] }[] } | undefined)?.columns;
  if (Array.isArray(cols)) return cols.reduce((n, c) => n + (c.values?.length ?? 0), 0);
  return 0;
}

/** The native Rust engine only exists inside the desktop shell. */
export function engineAvailable(): boolean {
  return isDesktop();
}

// The real code set, not a "starts with #" heuristic — a foreign or malformed code
// from the boundary is coerced to #ERROR! rather than trusted.
const CANONICAL_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_EXPLANATIONS));

function isCanonicalCode(c: unknown): c is SolErrorCode {
  return typeof c === "string" && CANONICAL_CODES.has(c);
}

/** Coerce anything thrown across the IPC boundary to a tagged `SolError` with a
 *  CANONICAL code — Rust sets `__solError` itself, so its code must be re-validated. */
export function toSolError(thrown: unknown): SolError {
  if (isSolError(thrown)) {
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

/** Call a Rust command; throws `#ERROR!` without the desktop engine, so guard with
 *  `engineAvailable()`. `invoke` is lazy so this module stays Tauri-free at load. */
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

/** Identity the native engine reports — mirrors `ipc::EngineInfo`. `initFrameBackend`
 *  selects the Polars frame backend when `backend` is "polars". */
export interface EngineInfo {
  name: string;
  version: string;
  backend: string;
}

/** Round-trips the IPC boundary as a health check; null in the browser. */
export async function enginePing(): Promise<EngineInfo | null> {
  if (!engineAvailable()) return null;
  return ipcInvoke<EngineInfo>("engine_ping");
}
