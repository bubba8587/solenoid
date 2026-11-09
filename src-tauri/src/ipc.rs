// [[C130]] rustCore
use serde::Serialize;

/// A failed command, shaped as the app's own tagged `SolError` so it renders as a value.
#[derive(Debug, Serialize)]
pub struct IpcError {
    #[serde(rename = "__solError")]
    sol_error: bool,
    code: String,
    message: String,
}

impl From<solenoid_core::error_value::SolError> for IpcError {
    fn from(e: solenoid_core::error_value::SolError) -> Self {
        IpcError {
            sol_error: true,
            code: e.code.as_str().to_string(),
            message: e.message,
        }
    }
}

/// Local File's Parquet read: the file's frame as the columnar hand-off's one buffer (`crates/solenoid-parquet`
/// `read_bytes`, capped at `MAX_CELLS`), which crosses as bytes, not JSON. Async and on a blocking thread: a sync
/// command runs on the main thread, and a large file decoding there froze the window.
#[tauri::command]
pub async fn read_parquet(folder: String, name: String) -> Result<tauri::ipc::Response, IpcError> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, IpcError> {
        let path = solenoid_parquet::inside(std::path::Path::new(&folder), &name)?;
        Ok(solenoid_parquet::read_bytes(&path)?)
    })
    .await
    .map_err(|e| {
        IpcError::from(solenoid_core::error_value::sol_error(
            solenoid_core::error_value::ErrorCode::Error,
            format!("The Parquet read stopped: {e}"),
        ))
    })?
    .map(tauri::ipc::Response::new)
}

/// Every web fetch the webview makes ([[B18]] safeToShare): `net.rs` keeps a document someone else wrote off this
/// computer and the local network.
#[tauri::command]
pub async fn net_fetch(req: crate::net::NetRequest) -> Result<crate::net::NetReply, String> {
    crate::net::fetch(req).await
}
