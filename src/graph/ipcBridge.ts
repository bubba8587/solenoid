// [[C130]] rustCore
import { isDesktop } from "./fileBridge";
import { solError, toSolError } from "./errorValue";
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

interface EngineInfo {
  name: string;
  version: string;
  backend: string;
}

export async function enginePing(): Promise<EngineInfo | null> {
  if (!engineAvailable()) return null;
  return ipcInvoke<EngineInfo>("engine_ping");
}
