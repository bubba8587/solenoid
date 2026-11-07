//! The windowed viewer: blitz-shell's window and Vello GPU renderer over the canvas page, with the document wrapped so
//! a drag pans and the wheel zooms by rewriting the canvas's transform, the way React Flow moves its viewport.

use crate::{Camera, Canvas, scene_info};
use anyrender_vello::VelloWindowRenderer;
use blitz_dom::{BaseDocument, DocGuard, DocGuardMut, Document};
use blitz_shell::{BlitzApplication, BlitzShellProxy, WindowConfig, create_default_event_loop};
use blitz_traits::events::{BlitzWheelDelta, UiEvent};
use std::path::PathBuf;

struct CanvasDocument {
    doc: BaseDocument,
    viewport_node: blitz_dom::NodeId,
    camera: Camera,
    drag: Option<(f32, f32)>,
}

impl CanvasDocument {
    fn apply(&mut self) {
        let c = self.camera;
        let t = format!("translate({}px, {}px) scale({})", c.x, c.y, c.zoom);
        self.doc
            .set_style_property(self.viewport_node, "transform", &t);
    }
}

impl Document for CanvasDocument {
    fn inner(&self) -> DocGuard<'_> {
        DocGuard::Ref(&self.doc)
    }
    fn inner_mut(&mut self) -> DocGuardMut<'_> {
        DocGuardMut::Ref(&mut self.doc)
    }
    fn handle_ui_event(&mut self, event: UiEvent) {
        match event {
            UiEvent::PointerDown(e) => self.drag = Some((e.coords.client_x, e.coords.client_y)),
            UiEvent::PointerUp(_) | UiEvent::PointerCancel(_) | UiEvent::PointerLeave(_) => {
                self.drag = None
            }
            UiEvent::PointerMove(e) => {
                if let Some((x, y)) = self.drag {
                    self.camera.x += (e.coords.client_x - x) as f64;
                    self.camera.y += (e.coords.client_y - y) as f64;
                    self.drag = Some((e.coords.client_x, e.coords.client_y));
                    self.apply();
                }
            }
            UiEvent::Wheel(e) => {
                let dy = match e.delta {
                    BlitzWheelDelta::Lines(_, y) => y * 40.0,
                    BlitzWheelDelta::Pixels(_, y) => y,
                };
                let (ax, ay) = (e.coords.client_x as f64, e.coords.client_y as f64);
                let fx = (ax - self.camera.x) / self.camera.zoom;
                let fy = (ay - self.camera.y) / self.camera.zoom;
                self.camera.zoom = (self.camera.zoom * (dy * 0.0025).exp()).clamp(0.05, 4.0);
                self.camera.x = ax - fx * self.camera.zoom;
                self.camera.y = ay - fy * self.camera.zoom;
                self.apply();
            }
            _ => {}
        }
    }
}

pub fn run(dir: PathBuf, zoom: Option<f64>) {
    let info = scene_info(&dir);
    let canvas = Canvas::load(&dir, info.width, info.height, 1.0);
    let camera = zoom
        .map(|z| crate::centered(&info, z))
        .unwrap_or(info.camera);
    let mut doc = CanvasDocument {
        viewport_node: canvas.viewport_node,
        doc: canvas.doc,
        camera,
        drag: None,
    };
    doc.apply();

    let event_loop = create_default_event_loop();
    let (proxy, receiver) = BlitzShellProxy::new(event_loop.create_proxy());
    let mut app = BlitzApplication::new(proxy, receiver);
    let attrs = winit::window::WindowAttributes::default()
        .with_title("Solenoid (Blitz)")
        .with_surface_size(winit::dpi::LogicalSize::new(
            info.width as f64,
            info.height as f64,
        ));
    app.add_window(WindowConfig::with_attributes(
        Box::new(doc),
        VelloWindowRenderer::new(),
        attrs,
    ));
    event_loop.run_app(app).unwrap();
}
