//! The camera, as React Flow keeps it: `screen = flow × zoom + (x, y)`.

use crate::geom::{Point, Rect};
use serde::{Deserialize, Serialize};

pub const MIN_ZOOM: f32 = 0.05;
pub const MAX_ZOOM: f32 = 4.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Camera {
    pub x: f32,
    pub y: f32,
    pub zoom: f32,
}

impl Default for Camera {
    fn default() -> Self {
        Camera {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

impl Camera {
    pub fn to_screen(&self, p: Point) -> Point {
        Point::new(p.x * self.zoom + self.x, p.y * self.zoom + self.y)
    }
    pub fn to_flow(&self, p: Point) -> Point {
        Point::new((p.x - self.x) / self.zoom, (p.y - self.y) / self.zoom)
    }
    pub fn rect_to_screen(&self, r: &Rect) -> Rect {
        let o = self.to_screen(r.origin());
        Rect::new(o.x, o.y, r.w * self.zoom, r.h * self.zoom)
    }
    /// The part of the canvas a viewport of `size` screen pixels shows.
    pub fn visible(&self, size: Point) -> Rect {
        let o = self.to_flow(Point::default());
        Rect::new(o.x, o.y, size.x / self.zoom, size.y / self.zoom)
    }
    pub fn pan(&mut self, d: Point) {
        self.x += d.x;
        self.y += d.y;
    }
    /// Zooms by `factor` about a screen point, which stays where it is.
    pub fn zoom_at(&mut self, at: Point, factor: f32) {
        let before = self.to_flow(at);
        self.zoom = (self.zoom * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        self.x = at.x - before.x * self.zoom;
        self.y = at.y - before.y * self.zoom;
    }
    /// The camera that shows `bounds` whole in a viewport of `size`, `pad` screen pixels in from each edge.
    pub fn fit(bounds: &Rect, size: Point, pad: f32) -> Camera {
        let zx = (size.x - 2.0 * pad).max(1.0) / bounds.w.max(1.0);
        let zy = (size.y - 2.0 * pad).max(1.0) / bounds.h.max(1.0);
        let zoom = zx.min(zy).clamp(MIN_ZOOM, MAX_ZOOM);
        let c = bounds.center();
        Camera {
            x: size.x / 2.0 - c.x * zoom,
            y: size.y / 2.0 - c.y * zoom,
            zoom,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_keeps_the_point_under_the_cursor() {
        let mut c = Camera {
            x: 10.0,
            y: 20.0,
            zoom: 0.5,
        };
        let at = Point::new(400.0, 300.0);
        let f = c.to_flow(at);
        c.zoom_at(at, 1.7);
        let back = c.to_screen(f);
        assert!((back.x - at.x).abs() < 1e-3 && (back.y - at.y).abs() < 1e-3);
    }

    #[test]
    fn fit_centers_the_bounds() {
        let b = Rect::new(100.0, 100.0, 1000.0, 500.0);
        let c = Camera::fit(&b, Point::new(800.0, 600.0), 0.0);
        assert!((c.zoom - 0.8).abs() < 1e-6);
        let mid = c.to_screen(b.center());
        assert!((mid.x - 400.0).abs() < 1e-3 && (mid.y - 300.0).abs() < 1e-3);
    }
}
