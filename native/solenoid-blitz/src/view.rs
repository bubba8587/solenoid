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
}

/// Lays the page out over each chunk of the graph in turn (by moving the canvas's transform) and paints each into its
/// own scene, clipped to its square. `tile` repeats the whole recording N × N.
fn record(dir: &std::path::Path, tile: usize) -> (Vec<Chunk>, Color, usize) {
    let json = std::fs::read_to_string(dir.join("scene.json")).expect("scene.json");
    let s = solenoid_scene::Scene::from_json(&json).expect("a scene");
    let b = s.bounds();
    let origin = Vec2::new(b.x as f64 - PAD, b.y as f64 - PAD);
    let (w, h) = (b.w as f64 + 2.0 * PAD, b.h as f64 + 2.0 * PAD);
    let t0 = Instant::now();
    let c = CHUNK as u32;
    let mut canvas = Canvas::load(dir, c, c, 1.0);
    let mut one = Vec::new();
    let (nx, ny) = ((w / CHUNK).ceil() as usize, (h / CHUNK).ceil() as usize);
    for cy in 0..ny {
        for cx in 0..nx {
            let at = origin + Vec2::new(cx as f64 * CHUNK, cy as f64 * CHUNK);
            canvas.set_camera(Camera {
                x: -at.x,
                y: -at.y,
                zoom: 1.0,
            });
            let mut scene = Scene::new();
            {
                let mut p = VelloScenePainter::new(&mut scene);
                // Half a pixel past the square, so neighbouring chunks' antialiased edges don't leave a seam.
                let square = Rect::new(-0.5, -0.5, CHUNK + 0.5, CHUNK + 0.5);
                p.push_clip_layer(Fill::NonZero, Affine::IDENTITY, &square);
                blitz_paint::paint_scene(&mut p, &mut canvas.doc, 1.0, c, c, 0, 0);
                p.pop_layer();
            }
            one.push(Chunk {
                scene,
                rect: Rect::from_origin_size(at.to_point(), (CHUNK, CHUNK)),
            });
        }
    }
    let paths: u32 = one.iter().map(|c| c.scene.encoding().n_paths).sum();
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
                });
            }
        }
    }
    eprintln!(
        "recorded {} cards in {} chunks ({paths} paths) in {:?}; × {}",
        s.cards.len(),
        one.len(),
        t0.elapsed(),
        tile * tile
    );
    let [r, g, bl, _] = s.background.0;
    (
        chunks,
        Color::from_rgb8(r, g, bl),
        s.cards.len() * tile * tile,
    )
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
        let cam = Affine::translate(Vec2::new(c.x, c.y)) * Affine::scale(c.zoom);
        self.frame.reset();
        crate::paint_backdrop(
            &mut VelloScenePainter::new(&mut self.frame),
            &self.info,
            c,
            w,
            h,
        );
        self.drawn = 0;
        for ch in &self.chunks {
            if ch.rect.overlaps(view) {
                let at = Affine::translate(ch.rect.origin().to_vec2());
                self.frame.append(&ch.scene, Some(cam * at));
                self.drawn += 1;
            }
        }
        self.build += t0.elapsed();
        gpu.render(&self.frame, self.base);
        self.frames += 1;
        let el = self.since.elapsed();
        if el >= Duration::from_secs(1) {
            let fps = self.frames as f64 / el.as_secs_f64();
            let build = self.build.as_secs_f64() * 1000.0 / self.frames as f64;
            let title = format!(
                "Solenoid (Blitz + Vello) · {} cards · zoom {:.0}% · {fps:.0} fps · {}/{} chunks · scene {build:.2} ms CPU",
                self.cards,
                self.camera.zoom * 100.0,
                self.drawn,
                self.chunks.len()
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
                    self.camera.x += position.x - x;
                    self.camera.y += position.y - y;
                    self.dragging = Some((position.x, position.y));
                    redraw(self);
                }
                self.cursor = (position.x, position.y);
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if matches!(
                    button,
                    MouseButton::Left | MouseButton::Middle | MouseButton::Right
                ) {
                    self.dragging = (state == ElementState::Pressed).then_some(self.cursor);
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
    let (chunks, base, cards) = record(&dir, tile);
    let camera = match zoom {
        Some(z) => crate::centered(&info, z),
        None => info.camera,
    };
    let _ = base;
    let event_loop = EventLoop::new().unwrap();
    let mut viewer = Viewer {
        info,
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
