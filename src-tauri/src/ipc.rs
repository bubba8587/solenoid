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
/// `read_bytes`), which crosses as bytes, not JSON.
#[tauri::command]
pub fn read_parquet(folder: String, name: String) -> Result<tauri::ipc::Response, IpcError> {
    let path = solenoid_parquet::inside(std::path::Path::new(&folder), &name)?;
    Ok(tauri::ipc::Response::new(solenoid_parquet::read_bytes(&path)?))
}
