// [[C16]] polarsEngine
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct IpcError {
    #[serde(rename = "__solError")]
    sol_error: bool,
    code: String,
    message: String,
}

impl IpcError {
    #[allow(dead_code)] // used by WS2's engine commands
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        IpcError { sol_error: true, code: code.into(), message: message.into() }
    }

    #[allow(dead_code)] // used by WS2's engine commands
    pub fn internal(message: impl Into<String>) -> Self {
        IpcError::new("#ERROR!", message)
    }
}

#[derive(Debug, Serialize)]
pub struct EngineInfo {
    name: String,
    version: String,
    backend: String,
}

#[tauri::command]
pub fn engine_ping() -> Result<EngineInfo, IpcError> {
    Ok(EngineInfo {
        name: "solenoid-engine".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        backend: "polars".to_string(),
    })
}
