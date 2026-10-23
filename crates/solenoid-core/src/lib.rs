// [[C130]] rustCore, [[D99]] rustIsSpec
//! Solenoid's headless core, for wasm and native. The Rust is the spec: it began as a port of the TypeScript and keeps
//! its names and order of operations where a fixture depends on them (`tree/specs/computation/rust-core.md`).
#![allow(clippy::neg_cmp_op_on_partial_ord, reason = "`!(a < b)` is how JS reads a comparison that NaN fails")]
#![allow(clippy::manual_range_contains, reason = "`x < lo || x > hi` lets NaN through, and `contains` would not")]
#![allow(clippy::needless_range_loop, reason = "the matrix bodies index rows and columns as the math writes them")]

pub mod binary;
pub mod card_helpers;
pub mod convert_units;
pub mod csv;
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
pub mod fns_random;
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
pub mod qr;
pub mod schedule;
pub mod shapers;
pub mod spelled;
pub mod string_order;
pub mod external;
pub mod text_ops;
pub mod unit_catalog;
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
