// [[A1]] visualGraphCalculator
//! Solenoid's canvas drawn by Blitz (`docs/fast-render.md` § Blitz): the app's own DOM and CSS, as the exporter saved
//! them (`canvas.html`), laid out by Stylo and Taffy and painted by Vello, with no browser. The camera is the canvas's
//! CSS transform, rewritten each frame, as React Flow does.
//!
//!   solenoid-blitz shot  <scene-dir> <out.png> [--zoom Z]   render one frame on the CPU (vello_cpu)
//!   solenoid-blitz bench <scene-dir>                        pan and zoom at the findings doc's zoom levels, timed
//!   solenoid-blitz view  <scene-dir>                        a window: wheel zooms, drag pans
#![forbid(unsafe_code)]

mod view;

use anyrender::ImageRenderer;
use anyrender_vello_cpu::VelloCpuImageRenderer;
use blitz_dom::{BaseDocument, DocumentConfig, FontContext};
use blitz_html::HtmlDocument;
use blitz_traits::shell::{ColorScheme, Viewport};
use parley::fontique::{Blob, Collection, CollectionOptions, SourceCache};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// The camera, as React Flow keeps it: `screen = flow × zoom + (x, y)`.
#[derive(Clone, Copy, Debug)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// What the renderer needs from `scene.json`: the viewport, the camera it was shot at, and the graph's bounds.
pub struct SceneInfo {
    pub width: u32,
    pub height: u32,
    pub camera: Camera,
    pub center: (f64, f64),
}

pub fn scene_info(dir: &Path) -> SceneInfo {
    let json = std::fs::read_to_string(dir.join("scene.json")).expect("scene.json");
    let scene = solenoid_scene::Scene::from_json(&json).expect("a scene");
    let c = scene.bounds().center();
    SceneInfo {
        width: scene.viewport.x as u32,
        height: scene.viewport.y as u32,
        camera: Camera {
            x: scene.camera.x as f64,
            y: scene.camera.y as f64,
            zoom: scene.camera.zoom as f64,
        },
        center: (c.x as f64, c.y as f64),
    }
}

/// The page as Blitz takes it: the app's `@font-face` rules point at the dev server, so they go, and the families
/// are named as the static instances the exporter cut (`fonts/*.ttf`) name themselves.
fn prepare_html(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(i) = rest.find("@font-face") {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        let end = after.find('}').map(|j| j + 1).unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out.replace(
        "Atkinson Hyperlegible Next Variable",
        "Atkinson Hyperlegible Next",
    )
    .replace(
        "Atkinson Hyperlegible Mono Variable",
        "Atkinson Hyperlegible Mono",
    )
}

fn font_context(dir: &Path) -> FontContext {
    let mut ctx = FontContext {
        source_cache: SourceCache::new_shared(),
        collection: Collection::new(CollectionOptions {
            shared: false,
            system_fonts: true,
        }),
    };
    if let Ok(rd) = std::fs::read_dir(dir.join("fonts")) {
        for e in rd.flatten() {
            if e.path().extension().is_some_and(|x| x == "ttf") {
                let bytes = std::fs::read(e.path()).expect("a font");
                ctx.collection
                    .register_fonts(Blob::new(Arc::new(bytes)), None);
            }
        }
    }
    ctx
}

pub struct Canvas {
    pub doc: BaseDocument,
    pub viewport_node: blitz_dom::NodeId,
    pub width: u32,
    pub height: u32,
}

impl Canvas {
    pub fn load(dir: &Path, width: u32, height: u32, scale: f32) -> Canvas {
        let html =
            prepare_html(&std::fs::read_to_string(dir.join("canvas.html")).expect("canvas.html"));
        let config = DocumentConfig {
            viewport: Some(Viewport::new(
                (width as f32 * scale) as u32,
                (height as f32 * scale) as u32,
                scale,
                ColorScheme::Dark,
            )),
            font_ctx: Some(font_context(dir)),
            base_url: Some("http://localhost:1420/".to_string()),
            ..Default::default()
        };
        let mut doc = HtmlDocument::from_html(&html, config).into_inner();
        doc.resolve(0.0);
        let viewport_node = doc
            .query_selector(".react-flow__viewport")
            .ok()
            .flatten()
            .expect("the canvas's .react-flow__viewport");
        Canvas {
            doc,
            viewport_node,
            width,
            height,
        }
    }

    /// Points the canvas's transform at the camera and lays the page out again.
    pub fn set_camera(&mut self, c: Camera) {
        let t = format!("translate({}px, {}px) scale({})", c.x, c.y, c.zoom);
        self.doc
            .set_style_property(self.viewport_node, "transform", &t);
        self.doc.resolve(0.0);
    }

    /// One frame as RGBA bytes.
    pub fn render(&mut self, renderer: &mut VelloCpuImageRenderer, scale: f64) -> Vec<u8> {
        let (w, h) = (self.width, self.height);
        let mut buf = Vec::new();
        let doc = &mut self.doc;
        renderer.render_to_vec(
            |scene| {
                blitz_paint::paint_scene(
                    scene,
                    doc,
                    scale,
                    (w as f64 * scale) as u32,
                    (h as f64 * scale) as u32,
                    0,
                    0,
                )
            },
            &mut buf,
        );
        buf
    }
}

pub fn centered(info: &SceneInfo, zoom: f64) -> Camera {
    Camera {
        x: info.width as f64 / 2.0 - info.center.0 * zoom,
        y: info.height as f64 / 2.0 - info.center.1 * zoom,
        zoom,
    }
}

fn write_png(path: &Path, w: u32, h: u32, rgba: &[u8]) {
    let file = std::fs::File::create(path).expect("the output file");
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header().unwrap().write_image_data(rgba).unwrap();
}

fn shot(dir: &Path, out: &Path, zoom: Option<f64>) {
    let info = scene_info(dir);
    let t0 = Instant::now();
    let mut canvas = Canvas::load(dir, info.width, info.height, 1.0);
    let loaded = t0.elapsed();
    canvas.set_camera(zoom.map(|z| centered(&info, z)).unwrap_or(info.camera));
    let mut r = VelloCpuImageRenderer::new(info.width, info.height);
    let t1 = Instant::now();
    let rgba = canvas.render(&mut r, 1.0);
    eprintln!("load {:?}, frame {:?}", loaded, t1.elapsed());
    write_png(out, info.width, info.height, &rgba);
    println!("{}", out.display());
}

fn bench(dir: &Path) {
    let info = scene_info(dir);
    let mut canvas = Canvas::load(dir, info.width, info.height, 1.0);
    let mut r = VelloCpuImageRenderer::new(info.width, info.height);
    println!("zoom  layout ms  paint+raster ms  (vello_cpu, one thread for raster)");
    for zoom in [1.0, 0.5, 0.25, 0.1] {
        let mut cam = centered(&info, zoom);
        let (mut layout, mut paint) = (Duration::ZERO, Duration::ZERO);
        let frames = 30;
        for i in 0..frames + 3 {
            cam.x += 4.0;
            let t0 = Instant::now();
            canvas.set_camera(cam);
            let t1 = Instant::now();
            let _ = canvas.render(&mut r, 1.0);
            if i >= 3 {
                layout += t1 - t0;
                paint += t1.elapsed();
            }
        }
        let ms = |d: Duration| d.as_secs_f64() * 1000.0 / frames as f64;
        println!("{zoom:<5} {:>9.2}  {:>15.2}", ms(layout), ms(paint));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage = || -> ! {
        eprintln!(
            "usage: solenoid-blitz shot <scene-dir> <out.png> [--zoom Z] | bench <scene-dir> | view <scene-dir>"
        );
        std::process::exit(2)
    };
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let zoom = flag("--zoom").and_then(|z| z.parse().ok());
    match args.first().map(String::as_str) {
        Some("shot") if args.len() >= 3 => {
            shot(&PathBuf::from(&args[1]), &PathBuf::from(&args[2]), zoom)
        }
        Some("bench") if args.len() >= 2 => bench(&PathBuf::from(&args[1])),
        Some("view") if args.len() >= 2 => view::run(PathBuf::from(&args[1]), zoom),
        _ => usage(),
    }
}
