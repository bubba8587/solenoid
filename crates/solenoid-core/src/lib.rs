// [[C130]] rustCore
//! A faithful Rust port of Solenoid's headless TypeScript core. The TS on `develop` is the spec:
//! each module mirrors one TS file, its functions keep their TS names in snake_case and their
//! order of operations, and any difference from the TS is a bug here (PORTING.md).

pub mod binary;
pub mod date_ops;
pub mod date_serial;
pub mod dists;
pub mod error_value;
pub mod excel_criteria;
pub mod excel_formula;
pub mod excel_functions;
pub mod fdlibm;
pub mod finance_ops;
pub mod frame;
pub mod fxhash;
pub mod frame_backend;
pub mod frame_verbs;
pub mod hash_ops;
pub mod js_sort;
pub mod letters;
pub mod jsnum;
pub mod shapers;
pub mod string_order;
pub mod text_ops;
pub mod unit_value;
pub mod value_kinds;
pub mod wire;

#[cfg(target_arch = "wasm32")]
mod wasm;
