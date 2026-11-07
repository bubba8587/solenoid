//! The windowed viewer: a retained GPU scene. Blitz lays out and paints the canvas page once into recorded
//! `vello::Scene` chunks (square pieces of the canvas, each clipped to its square); every frame after that appends the
//! chunks in view under the camera's transform. Panning and zooming cost the CPU only that append, the GPU draws every
//! card at full fidelity, and a frame's work follows what is on screen rather than the size of the graph.
//!
//! The window title shows frames per second, the chunks drawn, and the CPU time of the scene build.

use crate::{Camera, Canvas, scene_info};
use anyrender::PaintScene;
use anyrender_vello::VelloScenePainter;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use vello::kurbo::{Affine, Rect, Vec2};
use vello::peniko::{Color, Fill};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene, wgpu};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};

/// Room around the cards' bounds that the recording keeps, for cables and shadows that reach past a card.
const PAD: f64 = 400.0;
/// A chunk's side in flow pixels.
const CHUNK: f64 = 2048.0;

struct Chunk {
    scene: Scene,
    /// The chunk's square in flow coordinates.
    rect: Rect,
    /// The chunk rasterized at each cached scale (`RASTER`), made the first time a frame needs it.
    cached: [Option<vello::peniko::ImageData>; 2],
}

/// Far out, a chunk draws as a picture of itself: rendered once at 1/4 (zoom under 25%) or 1/16 (under 6.25%) and
/// sampled after, so a view of every card costs one image per chunk instead of every path.
/// `SOLENOID_NO_RASTER=1` keeps vector drawing at every zoom.
const RASTER: [f64; 2] = [0.25, 0.0625];

fn raster_level(zoom: f64) -> Option<usize> {
    if std::env::var_os("SOLENOID_NO_RASTER").is_some() {
        return None;
    }
    if zoom >= RASTER[0] {
        None
    } else if zoom >= RASTER[1] {
        Some(0)
    } else {
        Some(1)
    }
}

/// The live page: the Blitz document the chunks are painted from, kept so an edit can re-record the chunks it touches,
/// and the scene model the hit tests and cable reroutes read.
struct Page {
    canvas: Canvas,
    model: solenoid_scene::Scene,
    /// Flow coordinates of the chunk grid's corner, and the grid's size.
    origin: Vec2,
    nx: usize,
    ny: usize,
}

impl Page {
    fn load(dir: &std::path::Path) -> Page {
        let json = std::fs::read_to_string(dir.join("scene.json")).expect("scene.json");
        let model = solenoid_scene::Scene::from_json(&json).expect("a scene");
        let b = model.bounds();
        let origin = Vec2::new(b.x as f64 - PAD, b.y as f64 - PAD);
        let (w, h) = (b.w as f64 + 2.0 * PAD, b.h as f64 + 2.0 * PAD);
        let canvas = Canvas::load(dir, CHUNK as u32, CHUNK as u32, 1.0);
        Page {
            canvas,
            model,
            origin,
            nx: (w / CHUNK).ceil() as usize,
            ny: (h / CHUNK).ceil() as usize,
        }
    }

    fn chunk_rect(&self, i: usize) -> Rect {
        let (cx, cy) = (i % self.nx, i / self.nx);
        let at = self.origin + Vec2::new(cx as f64 * CHUNK, cy as f64 * CHUNK);
        Rect::from_origin_size(at.to_point(), (CHUNK, CHUNK))
    }

    /// Lays the page out with chunk `i`'s square under the viewport and paints it, clipped to the square.
    fn record_chunk(&mut self, i: usize) -> Scene {
        let at = self.chunk_rect(i).origin();
        self.canvas.set_camera(Camera {
            x: -at.x,
            y: -at.y,
            zoom: 1.0,
        });
        let c = CHUNK as u32;
        let mut scene = Scene::new();
        {
            let mut p = VelloScenePainter::new(&mut scene);
            // Exactly the square: the frame places chunks on whole pixels, so neighbours meet without a seam or overlap.
            let square = Rect::new(0.0, 0.0, CHUNK, CHUNK);
            p.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &square);
            blitz_paint::paint_scene(&mut p, &mut self.canvas.doc, 1.0, c, c, 0, 0);
            p.pop_layer();
        }
        scene
    }

    /// Every chunk; `tile` repeats the whole recording N × N (a still picture: tiled copies don't edit).
    fn record(&mut self, tile: usize) -> Vec<Chunk> {
        let t0 = Instant::now();
        let one: Vec<Chunk> = (0..self.nx * self.ny)
            .map(|i| Chunk {
                scene: self.record_chunk(i),
                rect: self.chunk_rect(i),
                cached: [None, None],
            })
            .collect();
        let paths: u32 = one.iter().map(|c| c.scene.encoding().n_paths).sum();
        let (w, h) = (self.nx as f64 * CHUNK, self.ny as f64 * CHUNK);
        let mut chunks = Vec::with_capacity(one.len() * tile * tile);
        for row in 0..tile {
            for col in 0..tile {
                let d = Vec2::new(col as f64 * (w - PAD), row as f64 * (h - PAD));
                for c in &one {
                    let mut scene = Scene::new();
                    scene.append(&c.scene, None);
                    chunks.push(Chunk {
                        scene,
                        rect: c.rect + d,
                        cached: [None, None],
                    });
                }
            }
        }
        eprintln!(
            "recorded {} cards in {} chunks ({paths} paths) in {:?}; × {}",
            self.model.cards.len(),
            one.len(),
            t0.elapsed(),
            tile * tile
        );
        chunks
    }

    /// Moves a card (and a group's members) by `d` flow pixels in the page, reroutes its cables, and returns the flow
    /// box the change touched.
    fn move_card(&mut self, id: &str, d: solenoid_scene::Point) -> Rect {
        let before = self.footprint(id);
        self.model.move_card(id, d);
        let moved: Vec<(String, solenoid_scene::Rect)> = self
            .model
            .cards
            .iter()
            .filter(|c| c.moved)
            .map(|c| (c.id.clone(), c.rect))
            .collect();
        let doc = &mut self.canvas.doc;
        for (cid, r) in &moved {
            let sel = format!(".react-flow__node[data-id=\"{cid}\"]");
            if let Ok(Some(node)) = doc.query_selector(&sel) {
                doc.set_style_property(
                    node,
                    "transform",
                    &format!("translate({}px, {}px)", r.x, r.y),
                );
            }
        }
        let ids: std::collections::HashSet<&str> = moved.iter().map(|(i, _)| i.as_str()).collect();
        let d_attr = blitz_dom::QualName::new(None, blitz_dom::ns!(), blitz_dom::local_name!("d"));
        for cable in &self.model.cables {
            if !ids.contains(cable.source.as_str()) && !ids.contains(cable.target.as_str()) {
                continue;
            }
            let path = self.model.cable_path(cable).to_svg();
            let sel = format!(".react-flow__edge[data-id=\"{}\"] path", cable.id);
            if let Ok(nodes) = doc.query_selector_all(&sel) {
                let mut m = doc.mutate();
                for n in nodes {
                    m.set_attribute(n, d_attr.clone(), &path);
                }
            }
        }
        let after = self.footprint(id);
        before.union(after)
    }

    /// The flow box a card, its group's members and their cables cover.
    fn footprint(&self, id: &str) -> Rect {
        let m = &self.model;
        let mut ids = vec![id.to_string()];
        let mut i = 0;
        while i < ids.len() {
            for c in &m.cards {
                if c.parent.as_deref() == Some(ids[i].as_str()) && !ids.contains(&c.id) {
                    ids.push(c.id.clone());
                }
            }
            i += 1;
        }
        let r = |r: solenoid_scene::Rect| {
            Rect::new(r.x as f64, r.y as f64, r.right() as f64, r.bottom() as f64)
        };
        let mut b = m.card(id).map(|c| r(c.rect)).unwrap_or_default();
        for cid in &ids {
            if let Some(c) = m.card(cid) {
                b = b.union(r(c.rect));
            }
        }
        for cable in &m.cables {
            if (ids.contains(&cable.source) || ids.contains(&cable.target))
                && let Some(pb) = m.cable_path(cable).bounds()
            {
                b = b.union(r(pb));
            }
        }
        b.inflate(24.0, 24.0)
    }
}

/// The GPU side: a wgpu device with the adapter's own limits (a big graph's scene outgrows wgpu's defaults), the
/// window's surface, and the texture Vello renders into before it is copied to the surface.
struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    target_view: wgpu::TextureView,
    blitter: wgpu::util::TextureBlitter,
    renderer: Renderer,
}

impl Gpu {
    fn new(window: Arc<Window>) -> Gpu {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            display: None,
            backends: wgpu::Backends::from_env().unwrap_or_default(),
            flags: wgpu::InstanceFlags::from_build_config().with_env(),
            memory_budget_thresholds: wgpu::MemoryBudgetThresholds::default(),
            backend_options: wgpu::BackendOptions::from_env_or_default(),
        });
        let surface = instance.create_surface(window.clone()).expect("a surface");
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            ..Default::default()
        }))
        .expect("an adapter");
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: None,
            required_features: adapter.features() & wgpu::Features::CLEAR_TEXTURE,
            required_limits: adapter.limits(),
            ..Default::default()
        }))
        .expect("a device");
        let size = window.inner_size();
        let format = wgpu::TextureFormat::Bgra8Unorm;
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .expect("a surface configuration");
        config.format = format;
        config.present_mode = wgpu::PresentMode::AutoNoVsync;
        surface.configure(&device, &config);
        let target_view = Self::target(&device, config.width, config.height);
        let blitter = wgpu::util::TextureBlitter::new(&device, format);
        let renderer = Renderer::new(
            &device,
            RendererOptions {
                use_cpu: false,
                antialiasing_support: AaSupport::area_only(),
                num_init_threads: None,
                pipeline_cache: None,
            },
        )
        .expect("a Vello renderer");
        Gpu {
            device,
            queue,
            surface,
            config,
            target_view,
            blitter,
            renderer,
        }
    }

    fn target(device: &wgpu::Device, w: u32, h: u32) -> wgpu::TextureView {
        device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("vello target"),
                size: wgpu::Extent3d {
                    width: w,
                    height: h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
                format: wgpu::TextureFormat::Rgba8Unorm,
                view_formats: &[],
            })
            .create_view(&wgpu::TextureViewDescriptor::default())
    }

    fn resize(&mut self, w: u32, h: u32) {
        self.config.width = w.max(1);
        self.config.height = h.max(1);
        self.surface.configure(&self.device, &self.config);
        self.target_view = Self::target(&self.device, self.config.width, self.config.height);
    }

    /// Renders a chunk at `scale` into its own texture and hands it to Vello as an image.
    fn raster(&mut self, scene: &Scene, scale: f64) -> vello::peniko::ImageData {
        let side = (CHUNK * scale).ceil() as u32;
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("chunk raster"),
            size: wgpu::Extent3d {
                width: side,
                height: side,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            usage: wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            format: wgpu::TextureFormat::Rgba8Unorm,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut scaled = Scene::new();
        scaled.append(scene, Some(Affine::scale(scale)));
        self.renderer
            .render_to_texture(
                &self.device,
                &self.queue,
                &scaled,
                &view,
                &RenderParams {
                    base_color: Color::TRANSPARENT,
                    width: side,
                    height: side,
                    antialiasing_method: AaConfig::Area,
                },
            )
            .expect("render a chunk");
        self.renderer.register_texture(texture)
    }

    fn render(&mut self, scene: &Scene, base: Color) {
        let (w, h) = (self.config.width, self.config.height);
        self.renderer
            .render_to_texture(
                &self.device,
                &self.queue,
                scene,
                &self.target_view,
                &RenderParams {
                    base_color: base,
                    width: w,
                    height: h,
                    antialiasing_method: AaConfig::Area,
                },
            )
            .expect("render");
        let out = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            _ => return,
        };
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        let view = out
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        self.blitter
            .copy(&self.device, &mut enc, &self.target_view, &view);
        self.queue.submit([enc.finish()]);
        self.queue.present(out);
    }
}

struct Viewer {
    info: crate::SceneInfo,
    page: Page,
    editable: bool,
    held: Option<String>,
    chunks: Vec<Chunk>,
    base: Color,
    camera: Camera,
    window: Option<Arc<Window>>,
    gpu: Option<Gpu>,
    frame: Scene,
    cursor: (f64, f64),
    dragging: Option<(f64, f64)>,
    cards: usize,
    frames: u32,
    drawn: usize,
    since: Instant,
    build: Duration,
    animate: bool,
}

impl Viewer {
    fn to_flow(&self, p: (f64, f64)) -> solenoid_scene::Point {
        let c = self.camera;
        solenoid_scene::Point::new(((p.0 - c.x) / c.zoom) as f32, ((p.1 - c.y) / c.zoom) as f32)
    }

    /// Drags a card by a screen delta: the page moves it and reroutes its cables, and the chunks it touched are
    /// recorded again (their cached pictures dropped).
    fn move_card(&mut self, id: &str, dx: f64, dy: f64) {
        let t0 = Instant::now();
        let z = self.camera.zoom;
        let touched = self.page.move_card(
            id,
            solenoid_scene::Point::new((dx / z) as f32, (dy / z) as f32),
        );
        for i in 0..self.page.nx * self.page.ny {
            if self.page.chunk_rect(i).overlaps(touched) {
                self.chunks[i].scene = self.page.record_chunk(i);
                self.chunks[i].cached = [None, None];
            }
        }
        if std::env::var_os("SOLENOID_VIEW_LOG").is_some() {
            eprintln!("moved {id}: {:?}", t0.elapsed());
        }
    }

    fn zoom_at(&mut self, ax: f64, ay: f64, factor: f64) {
        let c = &mut self.camera;
        let fx = (ax - c.x) / c.zoom;
        let fy = (ay - c.y) / c.zoom;
        c.zoom = (c.zoom * factor).clamp(0.02, 8.0);
        c.x = ax - fx * c.zoom;
        c.y = ay - fy * c.zoom;
    }

    fn draw(&mut self) {
        let (Some(window), Some(gpu)) = (&self.window, &mut self.gpu) else {
            return;
        };
        let t0 = Instant::now();
        let c = self.camera;
        let (w, h) = (gpu.config.width as f64, gpu.config.height as f64);
        // What the window shows, in flow coordinates.
        let view = Rect::new(
            -c.x / c.zoom,
            -c.y / c.zoom,
            (w - c.x) / c.zoom,
            (h - c.y) / c.zoom,
        );
        self.frame.reset();
        crate::paint_backdrop(
            &mut VelloScenePainter::new(&mut self.frame),
            &self.info,
            c,
            w,
            h,
        );
        self.drawn = 0;
        let level = raster_level(c.zoom);
        for ch in &mut self.chunks {
            if !ch.rect.overlaps(view) {
                continue;
            }
            // The chunk's corners on whole screen pixels (a stretch under a pixel), so chunks tile the screen exactly.
            let (x0, y0) = (
                (c.x + ch.rect.x0 * c.zoom).round(),
                (c.y + ch.rect.y0 * c.zoom).round(),
            );
            let (x1, y1) = (
                (c.x + ch.rect.x1 * c.zoom).round(),
                (c.y + ch.rect.y1 * c.zoom).round(),
            );
            let place = Affine::translate(Vec2::new(x0, y0))
                * Affine::scale_non_uniform((x1 - x0) / CHUNK, (y1 - y0) / CHUNK);
            match level {
                None => self.frame.append(&ch.scene, Some(place)),
                Some(l) => {
                    let scale = RASTER[l];
                    let img = ch.cached[l].get_or_insert_with(|| gpu.raster(&ch.scene, scale));
                    let brush = vello::peniko::ImageBrush::new(img.clone())
                        .with_quality(vello::peniko::ImageQuality::Medium);
                    self.frame
                        .draw_image(&brush, place * Affine::scale(1.0 / scale));
                }
            }
            self.drawn += 1;
        }
        self.build += t0.elapsed();
        gpu.render(&self.frame, self.base);
        self.frames += 1;
        let el = self.since.elapsed();
        if el >= Duration::from_secs(1) {
            let fps = self.frames as f64 / el.as_secs_f64();
            let build = self.build.as_secs_f64() * 1000.0 / self.frames as f64;
            let title = format!(
                "Solenoid (Blitz + Vello) · {} cards · zoom {:.0}% · {fps:.0} fps · {}/{} chunks{} · scene {build:.2} ms CPU",
                self.cards,
                self.camera.zoom * 100.0,
                self.drawn,
                self.chunks.len(),
                match raster_level(self.camera.zoom) {
                    Some(0) => " (as 1/4 pictures)",
                    Some(_) => " (as 1/16 pictures)",
                    None => "",
                }
            );
            window.set_title(&title);
            if std::env::var_os("SOLENOID_VIEW_LOG").is_some() {
                eprintln!("{title}");
            }
            self.frames = 0;
            self.build = Duration::ZERO;
            self.since = Instant::now();
        }
        if self.animate {
            self.camera.x -= 3.0;
            window.request_redraw();
        }
    }
}

impl ApplicationHandler for Viewer {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let window = Arc::new(
            el.create_window(
                Window::default_attributes()
                    .with_title("Solenoid (Blitz + Vello)")
                    .with_inner_size(winit::dpi::LogicalSize::new(1600.0, 1000.0)),
            )
            .unwrap(),
        );
        self.gpu = Some(Gpu::new(window.clone()));
        window.request_redraw();
        self.window = Some(window);
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let redraw = |s: &Self| {
            if let Some(w) = &s.window {
                w.request_redraw();
            }
        };
        match event {
            WindowEvent::CloseRequested => el.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gpu) = &mut self.gpu {
                    gpu.resize(size.width, size.height);
                }
                redraw(self);
            }
            WindowEvent::RedrawRequested => self.draw(),
            WindowEvent::CursorMoved { position, .. } => {
                if let Some((x, y)) = self.dragging {
                    let (dx, dy) = (position.x - x, position.y - y);
                    match self.held.clone() {
                        Some(id) => self.move_card(&id, dx, dy),
                        None => {
                            self.camera.x += dx;
                            self.camera.y += dy;
                        }
                    }
                    self.dragging = Some((position.x, position.y));
                    redraw(self);
                }
                self.cursor = (position.x, position.y);
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if !matches!(
                    button,
                    MouseButton::Left | MouseButton::Middle | MouseButton::Right
                ) {
                    return;
                }
                if state == ElementState::Pressed {
                    self.dragging = Some(self.cursor);
                    // The left button on a card holds it; anywhere else pans.
                    self.held = (button == MouseButton::Left && self.editable)
                        .then(|| {
                            let p = self.to_flow(self.cursor);
                            self.page.model.card_at(p).map(|c| c.id.clone())
                        })
                        .flatten();
                } else {
                    self.dragging = None;
                    self.held = None;
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let dy = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y as f64 * 40.0,
                    MouseScrollDelta::PixelDelta(p) => p.y,
                };
                self.zoom_at(self.cursor.0, self.cursor.1, (dy * 0.0025).exp());
                redraw(self);
            }
            _ => {}
        }
    }
}

pub fn run(dir: PathBuf, zoom: Option<f64>, tile: usize, animate: bool) {
    let info = scene_info(&dir);
    let mut page = Page::load(&dir);
    let chunks = page.record(tile);
    let [r, g, b, _] = page.model.background.0;
    let base = Color::from_rgb8(r, g, b);
    let cards = page.model.cards.len() * tile * tile;
    let camera = match zoom {
        Some(z) => crate::centered(&info, z),
        None => info.camera,
    };
    let event_loop = EventLoop::new().unwrap();
    let mut viewer = Viewer {
        info,
        page,
        editable: tile == 1,
        held: None,
        chunks,
        base,
        camera,
        window: None,
        gpu: None,
        frame: Scene::new(),
        cursor: (0.0, 0.0),
        dragging: None,
        cards,
        frames: 0,
        drawn: 0,
        since: Instant::now(),
        build: Duration::ZERO,
        animate,
    };
    event_loop.run_app(&mut viewer).unwrap();
}
