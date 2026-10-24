// [[D102]] graphOnCore
//! Solenoid's graph: the canvas's nodes and cables in a Ruggine editor
//! (<https://github.com/bubba8587/ruggine>), its dataflow engine, and the compute pass's graph
//! walks (`tree/specs/computation/graph-core.md`). Its own WebAssembly module, apart from
//! `solenoid-core`, so a formula's trap and the instance swap after it never reach the graph.

#[cfg(target_arch = "wasm32")]
mod boundary;
pub mod model;
pub mod pass;
#[cfg(target_arch = "wasm32")]
mod wasm;
