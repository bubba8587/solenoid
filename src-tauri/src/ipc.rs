// IPC surface — the error contract + health check for the Rust engine boundary.
//
// This module defines `IpcError` (the tagged-error convention every engine
// command returns) and `engine_ping` (the round-trip health check). The frame
// engine commands themselves — `source` / `apply` / `preview` / `column` /
// `drop` — live in `engine.rs`, each `#[tauri::command] -> Result<T, IpcError>`.
//
// Error convention: a command's `Err` serializes to the SAME shape the web
// layer's tagged `SolError` uses — `{ "__solError": true, code, message }` — so a
// failure crossing IPC arrives as a value the app already renders (#CODE! badge,
// IFERROR-catchable) with no per-call translation. See `src/graph/errorValue.ts`
// and the `toSolError` mapper in `src/graph/ipcBridge.ts`.

use serde::Serialize;

/// A failure that crosses the IPC boundary as a tagged `SolError`. The
/// `__solError` flag + `code` + `message` match `errorValue.ts` exactly, so the
/// web side can treat a rejected `invoke` as a first-class error value.
#[derive(Debug, Serialize)]
pub struct IpcError {
    #[serde(rename = "__solError")]
    sol_error: bool,
    code: String,
    message: String,
}

impl IpcError {
    /// `code` should be one of the canonical `SolErrorCode` tokens (e.g.
    /// "#SHAPE!", "#VALUE!", "#ERROR!"); anything else is coerced to "#ERROR!"
    /// on the web side.
    #[allow(dead_code)] // used by WS2's engine commands
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        IpcError { sol_error: true, code: code.into(), message: message.into() }
    }

    /// The catch-all for an unexpected internal failure.
    #[allow(dead_code)] // used by WS2's engine commands
    pub fn internal(message: impl Into<String>) -> Self {
        IpcError::new("#ERROR!", message)
    }
}

/// What `engine_ping` reports back — proves the round-trip and tells the web
/// layer which compute backend is live. `backend` is "polars" now that WS2's
/// engine (`engine.rs`) is wired; the web layer keys its backend selection off
/// this (`initFrameBackend` in `frameBackend.ts`).
#[derive(Debug, Serialize)]
pub struct EngineInfo {
    name: String,
    version: String,
    backend: String,
}

/// Round-trip health check. Returns the engine's identity so the web layer can
/// confirm the native side is reachable and which backend it got.
#[tauri::command]
pub fn engine_ping() -> Result<EngineInfo, IpcError> {
    Ok(EngineInfo {
        name: "solenoid-engine".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        backend: "polars".to_string(),
    })
}
