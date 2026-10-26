// [[D102]] graphOnCore
//! Solenoid's graph: the canvas's nodes and cables in a Ruggine editor
//! (<https://github.com/bubba8587/ruggine>), its dataflow engine, and the compute pass's graph
//! walks (`tree/specs/computation/graph-core.md`). It links `solenoid-core` and is the one
//! WebAssembly module, so the engine calls a card's body in Rust.

// Linked whole, so the core's own wasm entries (`engine_invoke` and the rest) are this module's too.
extern crate solenoid_core;

#[cfg(target_arch = "wasm32")]
mod boundary;
pub mod boundary_core;
pub mod conduit;
#[cfg(target_arch = "wasm32")]
mod direct;
pub mod lattice;
pub mod model;
pub mod pass;
pub mod session;
pub mod settle;
#[cfg(target_arch = "wasm32")]
mod value;
#[cfg(target_arch = "wasm32")]
mod wasm;
