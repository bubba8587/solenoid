// [[C130]] rustCore
use serde::Serialize;
use serde_json::Value as Json;

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

/// Local File's Parquet read: the file's columns in wire form (`crates/solenoid-parquet`).
#[tauri::command]
pub fn read_parquet(folder: String, name: String) -> Result<Vec<Json>, IpcError> {
    Ok(solenoid_parquet::read_wire(
        &std::path::Path::new(&folder).join(&name),
    )?)
}
