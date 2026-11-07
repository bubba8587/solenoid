// [[A1]] visualGraphCalculator
//! The canvas as data, for renderers other than the DOM (`docs/fast-render.md`): cards as flat display lists of boxes
//! and text runs, cables as paths between sockets, groups, the camera, and the culling and level-of-detail every
//! renderer shares. A scene is captured from the live app (`scripts/scene-export.mjs`); GPUI, Blitz and the web canvas
//! all read the same one.
#![forbid(unsafe_code)]

pub mod cable;
pub mod camera;
pub mod color;
pub mod geom;
pub mod lod;
pub mod model;
pub mod path;

pub use camera::Camera;
pub use color::Rgba;
pub use geom::{Point, Rect};
pub use lod::{Detail, Frame};
pub use model::{Cable, Card, Item, Scene, Side, Socket};
pub use path::{Path, Seg};
