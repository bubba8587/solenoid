// [[C130]] rustCore
//! A faithful Rust port of Solenoid's headless TypeScript core. The TS on `develop` is the spec:
//! each module mirrors one TS file, its functions keep their TS names in snake_case and their
//! order of operations, and any difference from the TS is a bug here (PORTING.md).

pub mod binary;
pub mod convert_units;
pub mod date_ops;
pub mod date_parse;
pub mod date_serial;
pub mod dists;
pub mod error_value;
pub mod eval;
pub mod excel_criteria;
pub mod excel_formula;
pub mod excel_functions;
pub mod fdlibm;
pub mod fns_complex;
pub mod fns_stats;
pub mod finance_ops;
pub mod finance_units;
pub mod fns_lists;
pub mod fns_matrix;
pub mod formulajs;
pub mod frame;
pub mod fxhash;
pub mod frame_backend;
pub mod decision;
pub mod frame_fns;
pub mod frame_verbs;
pub mod hash_ops;
pub mod js_radix;
pub mod js_sort;
pub mod letters;
pub mod jsnum;
pub mod js_regex;
pub mod ladder;
pub mod nfd_table;
pub mod nodes;
pub mod planners;
pub mod shapers;
pub mod string_order;
pub mod external;
pub mod text_ops;
pub mod unit_dims;
pub mod unit_lists;
pub mod unit_expression;
pub mod unit_fold;
pub mod unit_value;
pub mod value_kinds;
pub mod wire;
pub mod zone;

#[cfg(target_arch = "wasm32")]
mod wasm;
