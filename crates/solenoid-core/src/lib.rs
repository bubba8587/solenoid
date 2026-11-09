// [[C130]] rustCore, [[D99]] rustIsSpec
//! Solenoid's headless core, for wasm and native. The Rust is the spec, and keeps its names and order of operations
//! where a fixture depends on them (`tree/specs/computation/rust-core.md`).
#![forbid(unsafe_code)]
// Tests may compute an expected value with the platform's float math; clippy.toml bars it from shipped code.
#![cfg_attr(test, allow(clippy::disallowed_methods))]
#![allow(clippy::neg_cmp_op_on_partial_ord, reason = "`!(a < b)` is how JS reads a comparison that NaN fails")]
#![allow(clippy::manual_range_contains, reason = "`x < lo || x > hi` lets NaN through, and `contains` would not")]
#![allow(clippy::needless_range_loop, reason = "the matrix bodies index rows and columns as the math writes them")]

pub mod binary;
pub mod card_helpers;
pub mod compare;
pub mod convert_units;
pub mod csv;
pub mod date_ops;
pub mod date_serial;
pub mod date_values;
pub mod decision;
pub mod dists;
pub mod error_value;
pub mod eval;
pub mod exact_sum;
pub mod excel_criteria;
pub mod excel_format;
pub mod excel_formula;
pub mod excel_functions;
pub mod excel_regex;
pub mod finance_ops;
pub mod finance_units;
pub mod fns_complex;
pub mod fns_lists;
pub mod fns_matrix;
pub mod fns_packs;
pub mod fns_random;
pub mod fns_stats;
pub mod formulajs;
pub mod frame;
pub mod frame_backend;
pub mod frame_fns;
pub mod frame_ref;
pub mod frame_verbs;
pub mod grid_filters;
pub mod hash_ops;
pub mod jsnum;
pub mod ladder;
pub mod nodes;
pub mod plan_files;
pub mod planners;
pub mod providers;
pub mod relative_date;
pub mod shapers;
pub mod sort;
pub mod spelled;
pub mod string_order;
pub mod text_ops;
pub mod unit_catalog;
pub mod unit_dims;
pub mod unit_expression;
pub mod unit_fold;
pub mod unit_lists;
pub mod unit_value;
pub mod value_kinds;
pub mod wire;
pub mod zone;

#[cfg(target_arch = "wasm32")]
mod wasm;
