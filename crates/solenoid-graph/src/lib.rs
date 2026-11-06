// [[C130]] rustCore
//! Solenoid's graph (`tree/specs/computation/graph-core.md`): the canvas's netcore-rs editor, its dataflow engine and
//! the compute pass's walks; it links `solenoid-core` and is the one WebAssembly module.
#![forbid(unsafe_code)]

// Linked whole, so the core's own wasm entries (`engine_invoke` and the rest) are this module's too.
extern crate solenoid_core;

pub mod annotate;
#[cfg(target_arch = "wasm32")]
mod boundary;
pub mod boundary_core;
pub mod conduit;
#[cfg(target_arch = "wasm32")]
mod direct;
pub mod fc;
pub mod lattice;
pub mod model;
pub mod pass;
pub mod session;
pub mod settle;
pub mod text_form;
#[cfg(target_arch = "wasm32")]
mod value;
#[cfg(target_arch = "wasm32")]
mod wasm;
