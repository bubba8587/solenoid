// [[C16]] polarsEngine
import { isDesktop } from "./fileBridge";
import { solError, isSolError, ERROR_EXPLANATIONS, type SolError, type SolErrorCode } from "./errorValue";
import { perfEnabled, recordIpc } from "./perfProbe";

// Cell count for the perf probe, deliberately not JSON.stringify; a payload with no frame is a scalar, so 0.
function estimateCells(args?: Record<string, unknown>): number {
  const cols = (args?.frame as { columns?: { values?: unknown[] }[] } | undefined)?.columns;
  if (Array.isArray(cols)) return cols.reduce((n, c) => n + (c.values?.length ?? 0), 0);
  return 0;
}

export function engineAvailable(): boolean {
  return isDesktop();
}

// The real code set, so a foreign or malformed code from the boundary becomes #ERROR! rather than being trusted.
const CANONICAL_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_EXPLANATIONS));

function isCanonicalCode(c: unknown): c is SolErrorCode {
  return typeof c === "string" && CANONICAL_CODES.has(c);
}

/** Rust sets `__solError` itself, so its code must be re-validated. */
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

// One lazy dynamic import per session, so this module stays Tauri-free at load.
let _core: Promise<typeof import("@tauri-apps/api/core")> | null = null;
const tauriCore = () => (_core ??= import("@tauri-apps/api/core"));

export async function ipcInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!engineAvailable()) {
    throw solError("#ERROR!", `IPC '${command}' called without the desktop engine`);
  }
  const probe = perfEnabled();
  const t0 = probe ? performance.now() : 0;
  try {
    const { invoke } = await tauriCore();
    return await invoke<T>(command, args);
  } catch (e) {
    throw toSolError(e);
  } finally {
    if (probe) recordIpc(command, performance.now() - t0, estimateCells(args));
  }
}

export interface EngineInfo {
  name: string;
  version: string;
  backend: string;
}

export async function enginePing(): Promise<EngineInfo | null> {
  if (!engineAvailable()) return null;
  return ipcInvoke<EngineInfo>("engine_ping");
}
