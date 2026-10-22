// [[D102]] graphOnCore
//! Solenoid's graph engine: a mirror of the canvas's nodes and cables on Ruggine
//! (<https://github.com/bubba8587/ruggine>), its dataflow engine, and the compute pass's graph
//! walks (`tree/specs/computation/graph-core.md`). Its own WebAssembly module, apart from
//! `solenoid-core`, so a formula's trap and the instance swap after it never reach the graph.

pub mod pass;
#[cfg(target_arch = "wasm32")]
mod wasm;
