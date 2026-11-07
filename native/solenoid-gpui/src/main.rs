// [[A1]] visualGraphCalculator
//! Solenoid's canvas drawn by GPUI (`docs/fast-render.md` § GPUI): a scene captured from the live app
//! (`scripts/scene-export.mjs`) as boxes, text, paths and cables, panned, zoomed and dragged natively.
//!
//!   solenoid-gpui <scene-dir> [--zoom Z] [--tile N] [--lod] [--bench] [--exit-after MS]
//!
//! `--tile N` lays N × N copies of the scene side by side (thousands of real cards); `--lod` turns on far-zoom
//! silhouettes (off by default: every card draws whole at every zoom).
//!
//! Wheel zooms about the cursor, a drag on a card moves it (and a group's members), a drag on the canvas pans, a
//! double click on the canvas fits the graph. `--bench` pans and zooms through the findings doc's zoom levels and
//! prints the CPU cost of a frame at each, then quits.
#![forbid(unsafe_code)]

use gpui::{
    App, Application, AssetSource, BorderStyle, Bounds, BoxShadow, ContentMask, Context, Corners,
    Edges, FontStyle, FontWeight, Hsla, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    PathBuilder, Pixels, Radians, Render, RenderImage, ScrollDelta, ScrollWheelEvent, SharedString,
    TextAlign, TextRun, TransformationMatrix, Window, WindowBounds, WindowOptions, canvas, div,
    font, point, prelude::*, px, quad, size,
};
use solenoid_scene::lod::{self, Detail, Frame};
use solenoid_scene::model::Align;
use solenoid_scene::{Camera, Item, Path, Point, Rect, Rgba, Scene, Seg};
use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

const SVG_PREFIX: &str = "scene-svg/";

struct KindTimer(usize, Instant);
impl Drop for KindTimer {
    fn drop(&mut self) {
        KIND_T.with(|k| k.borrow_mut()[self.0] += self.1.elapsed());
    }
}

thread_local! {
    static KIND_T: std::cell::RefCell<[Duration; 5]> = const { std::cell::RefCell::new([Duration::ZERO; 5]) };
    /// `--lod`: far-out cards as silhouettes and small text skipped. Off, every card draws whole at every zoom.
    static LOD: Cell<bool> = const { Cell::new(false) };
    /// The scene's captured pictures (`data:` PNGs), decoded once, by their source.
    static IMAGES: std::cell::RefCell<std::collections::HashMap<String, Arc<RenderImage>>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

fn load_images(scene: &Scene) {
    use base64::Engine as _;
    for card in &scene.cards {
        for item in &card.items {
            let Item::Image { src, .. } = item else {
                continue;
            };
            if IMAGES.with(|m| m.borrow().contains_key(src)) {
                continue;
            }
            let Some(b64) = src.split_once(";base64,").map(|(_, d)| d) else {
                continue;
            };
            let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else {
                continue;
            };
            let Ok(img) = image::load_from_memory(&bytes) else {
                continue;
            };
            let mut rgba = img.to_rgba8();
            // GPUI's image atlas is BGRA.
            for p in rgba.pixels_mut() {
                p.0.swap(0, 2);
            }
            let frame = image::Frame::new(rgba);
            let ri = Arc::new(RenderImage::new(smallvec::smallvec![frame]));
            IMAGES.with(|m| m.borrow_mut().insert(src.clone(), ri));
        }
    }
}

/// Serves the scene's icon SVGs to GPUI's SVG renderer, which loads by path.
struct SceneAssets(Vec<String>);

impl AssetSource for SceneAssets {
    fn load(&self, path: &str) -> gpui::Result<Option<std::borrow::Cow<'static, [u8]>>> {
        Ok(path
            .strip_prefix(SVG_PREFIX)
            .and_then(|i| i.parse::<usize>().ok())
            .and_then(|i| self.0.get(i))
            .map(|s| s.clone().into_bytes().into()))
    }
    fn list(&self, _path: &str) -> gpui::Result<Vec<SharedString>> {
        Ok(Vec::new())
    }
}

fn hsla(c: Rgba) -> Hsla {
    gpui::rgba(c.to_u32()).into()
}

fn gp(p: Point) -> gpui::Point<Pixels> {
    point(px(p.x), px(p.y))
}

fn bounds(r: Rect) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(r.x), px(r.y)),
        size: size(px(r.w), px(r.h)),
    }
}

/// The app's font families by the names their TTFs carry (the CSS names add "Variable").
fn family(scene: &Scene, i: u16) -> SharedString {
    let name = scene
        .fonts
        .get(i as usize)
        .map(String::as_str)
        .unwrap_or("Atkinson Hyperlegible Next");
    SharedString::from(name.trim_end_matches(" Variable").to_string())
}

#[derive(Clone, Copy)]
enum Drag {
    Pan { last: Point },
    Card { index: usize, last: Point },
}

struct Bench {
    zooms: Vec<f32>,
    step: usize,
    frame: usize,
    totals: Vec<(f32, Duration, usize)>,
}

struct SceneView {
    scene: Rc<Scene>,
    camera: Camera,
    viewport: Point,
    drag: Option<Drag>,
    last_paint: Rc<Cell<(Duration, usize)>>,
    bench: Option<Bench>,
    fitted: bool,
}

impl SceneView {
    fn fit(&mut self) {
        self.camera = Camera::fit(&self.scene.bounds(), self.viewport, 40.0);
    }

    fn on_wheel(&mut self, e: &ScrollWheelEvent, _w: &mut Window, cx: &mut Context<Self>) {
        let dy = match e.delta {
            ScrollDelta::Pixels(p) => f32::from(p.y),
            ScrollDelta::Lines(l) => l.y * 40.0,
        };
        let at = Point::new(f32::from(e.position.x), f32::from(e.position.y));
        if e.modifiers.control || e.modifiers.platform || matches!(e.delta, ScrollDelta::Lines(_)) {
            self.camera.zoom_at(at, (dy * 0.0025).exp());
        } else {
            let dx = match e.delta {
                ScrollDelta::Pixels(p) => f32::from(p.x),
                ScrollDelta::Lines(l) => l.x * 40.0,
            };
            self.camera.pan(Point::new(dx, dy));
        }
        cx.notify();
    }

    fn on_down(&mut self, e: &MouseDownEvent, _w: &mut Window, cx: &mut Context<Self>) {
        let at = Point::new(f32::from(e.position.x), f32::from(e.position.y));
        if e.click_count == 2 {
            self.fit();
            cx.notify();
            return;
        }
        let flow = self.camera.to_flow(at);
        self.drag = match self
            .scene
            .card_at(flow)
            .and_then(|c| self.scene.card_index(&c.id))
        {
            Some(index) if e.button == MouseButton::Left => Some(Drag::Card { index, last: at }),
            _ => Some(Drag::Pan { last: at }),
        };
    }

    fn on_move(&mut self, e: &MouseMoveEvent, _w: &mut Window, cx: &mut Context<Self>) {
        let at = Point::new(f32::from(e.position.x), f32::from(e.position.y));
        match self.drag {
            Some(Drag::Pan { last }) => {
                self.camera.pan(at.minus(last));
                self.drag = Some(Drag::Pan { last: at });
                cx.notify();
            }
            Some(Drag::Card { index, last }) => {
                let d = at.minus(last).scale(1.0 / self.camera.zoom);
                let id = self.scene.cards[index].id.clone();
                Rc::make_mut(&mut self.scene).move_card(&id, d);
                self.drag = Some(Drag::Card { index, last: at });
                cx.notify();
            }
            None => {}
        }
    }

    fn on_up(&mut self, _e: &MouseUpEvent, _w: &mut Window, _cx: &mut Context<Self>) {
        self.drag = None;
    }

    /// One bench frame: pan 4 px a frame at the current zoom, 60 frames a zoom, then the next zoom.
    fn bench_tick(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(b) = self.bench.as_mut() else { return };
        let (cost, drawn) = self.last_paint.get();
        if b.frame > 5 {
            let t = &mut b.totals[b.step];
            t.1 += cost;
            t.2 = drawn;
        }
        b.frame += 1;
        if b.frame >= 65 {
            b.step += 1;
            b.frame = 0;
            if b.step >= b.zooms.len() {
                println!("zoom  cpu ms/frame  cards drawn");
                for (z, total, drawn) in &b.totals {
                    println!(
                        "{z:<5} {:>12.2}  {drawn}",
                        total.as_secs_f64() * 1000.0 / 59.0
                    );
                }
                cx.quit();
                return;
            }
            let z = b.zooms[b.step];
            let c = self.scene.bounds().center();
            self.camera = Camera {
                x: self.viewport.x / 2.0 - c.x * z,
                y: self.viewport.y / 2.0 - c.y * z,
                zoom: z,
            };
        } else {
            self.camera.pan(Point::new(4.0, 0.0));
        }
        cx.notify();
    }
}

impl Render for SceneView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let vs = window.viewport_size();
        self.viewport = Point::new(f32::from(vs.width), f32::from(vs.height));
        if !self.fitted {
            self.fitted = true;
            if let Some(b) = &self.bench {
                let z = b.zooms[0];
                let c = self.scene.bounds().center();
                self.camera = Camera {
                    x: self.viewport.x / 2.0 - c.x * z,
                    y: self.viewport.y / 2.0 - c.y * z,
                    zoom: z,
                };
            }
        }
        if self.bench.is_some() {
            cx.on_next_frame(window, |this, window, cx| this.bench_tick(window, cx));
        }
        let scene = self.scene.clone();
        let camera = self.camera;
        let viewport = self.viewport;
        let stats = self.last_paint.clone();
        let (cost, drawn) = stats.get();
        let hud = format!(
            "{} · zoom {:.0}% · {} cards · {:.2} ms paint (CPU)",
            scene.name,
            camera.zoom * 100.0,
            drawn,
            cost.as_secs_f64() * 1000.0
        );
        div()
            .size_full()
            .bg(hsla(scene.background))
            .relative()
            .on_scroll_wheel(cx.listener(Self::on_wheel))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_down))
            .on_mouse_down(MouseButton::Middle, cx.listener(Self::on_down))
            .on_mouse_down(MouseButton::Right, cx.listener(Self::on_down))
            .on_mouse_move(cx.listener(Self::on_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_up))
            .on_mouse_up(MouseButton::Middle, cx.listener(Self::on_up))
            .on_mouse_up(MouseButton::Right, cx.listener(Self::on_up))
            .child(
                canvas(
                    |_, _, _| {},
                    move |_bounds, _, window, cx| {
                        let t0 = Instant::now();
                        let n = paint_scene(&scene, &camera, viewport, window, cx);
                        stats.set((t0.elapsed(), n));
                        if std::env::var_os("SOLENOID_GPUI_DEBUG").is_some() {
                            eprintln!("paint: {n} cards in {:?}", t0.elapsed());
                        }
                    },
                )
                .size_full(),
            )
            .child(
                div()
                    .absolute()
                    .bottom_2()
                    .left_2()
                    .px_2()
                    .py_1()
                    .rounded_md()
                    .bg(gpui::rgba(0x000000aa))
                    .text_color(gpui::rgba(0xe8e8e8ff))
                    .text_size(px(12.0))
                    .font_family("Atkinson Hyperlegible Next")
                    .child(hud),
            )
    }
}

fn paint_scene(
    scene: &Scene,
    camera: &Camera,
    viewport: Point,
    window: &mut Window,
    cx: &mut App,
) -> usize {
    if let Some(g) = scene.grid {
        paint_grid(g, camera, viewport, window);
    }
    let skip = std::env::var("SKIP").unwrap_or_default();
    let t = Instant::now();
    let frame = Frame::build_with(scene, camera, viewport, LOD.with(|l| l.get()));
    let t_frame = t.elapsed();
    let t = Instant::now();
    for &i in &frame.cables {
        if skip.contains("cable") {
            break;
        }
        let c = &scene.cables[i];
        let path = scene.cable_path(c);
        let w = (c.width * camera.zoom).max(1.0);
        stroke_path(&path, camera, w, c.color.fade(c.opacity), window);
    }
    let t_cables = t.elapsed();
    let t = Instant::now();
    for &(i, detail) in &frame.cards {
        if skip.contains("cards") {
            break;
        }
        let card = &scene.cards[i];
        let r = camera.rect_to_screen(&card.rect);
        match detail {
            Detail::Block => window.paint_quad(gpui::fill(bounds(r), hsla(card.accent.fade(0.85)))),
            Detail::Silhouette => paint_silhouette(scene, card, r, camera, window, cx),
            Detail::Full => paint_items(scene, card, camera, window, cx),
        }
    }
    if std::env::var_os("SOLENOID_GPUI_DEBUG").is_some() {
        let k = KIND_T.with(|k| std::mem::take(&mut *k.borrow_mut()));
        eprintln!(
            "frame {t_frame:?} cables {t_cables:?} cards {:?} [box {:?} text {:?} path {:?} image {:?} icon {:?}]",
            t.elapsed(),
            k[0],
            k[1],
            k[2],
            k[3],
            k[4]
        );
    }
    frame.cards.len()
}

fn paint_grid(
    g: solenoid_scene::model::Grid,
    camera: &Camera,
    viewport: Point,
    window: &mut Window,
) {
    // Thin the dots out as they crowd: every 2nd, 4th … dot once they are under 20 px apart.
    let mut gap = g.gap;
    while gap * camera.zoom < 20.0 {
        gap *= 2.0;
    }
    let r = (g.radius * camera.zoom).clamp(0.6, 1.5);
    let vis = camera.visible(viewport);
    let x0 = (vis.x / gap).floor() as i64;
    let y0 = (vis.y / gap).floor() as i64;
    let x1 = (vis.right() / gap).ceil() as i64;
    let y1 = (vis.bottom() / gap).ceil() as i64;
    let color = hsla(g.color);
    for gy in y0..=y1 {
        for gx in x0..=x1 {
            let p = camera.to_screen(Point::new(gx as f32 * gap, gy as f32 * gap));
            window.paint_quad(quad(
                bounds(Rect::new(p.x - r, p.y - r, 2.0 * r, 2.0 * r)),
                px(r),
                color,
                px(0.0),
                gpui::transparent_black(),
                BorderStyle::Solid,
            ));
        }
    }
}

fn paint_silhouette(
    scene: &Scene,
    card: &solenoid_scene::Card,
    r: Rect,
    camera: &Camera,
    window: &mut Window,
    cx: &mut App,
) {
    let radius = px((8.0 * camera.zoom).max(1.0));
    let body = if card.kind == "group" {
        card.accent.fade(0.10)
    } else {
        Rgba::rgb(0x1e, 0x1e, 0x1e)
    };
    window.paint_quad(quad(
        bounds(r),
        radius,
        hsla(body),
        px(1.0),
        hsla(card.accent.fade(0.6)),
        BorderStyle::Solid,
    ));
    let hh = (card.header_h.max(20.0) * camera.zoom).min(r.h);
    window.paint_quad(quad(
        bounds(Rect::new(r.x, r.y, r.w, hh)),
        Corners {
            top_left: radius,
            top_right: radius,
            bottom_left: px(0.0),
            bottom_right: px(0.0),
        },
        hsla(card.accent),
        px(0.0),
        gpui::transparent_black(),
        BorderStyle::Solid,
    ));
    // The title stays legible further out than the card's own text: drawn at a floor of 9 px while the header holds it.
    let size = (13.0 * camera.zoom).max(9.0);
    if !card.title.is_empty() && hh >= size * 0.9 && r.w > 40.0 {
        let ink = if luminance(card.accent) > 0.45 {
            Rgba::rgb(0x1a, 0x1a, 0x1a)
        } else {
            Rgba::rgb(0xff, 0xff, 0xff)
        };
        let style = TextStyle {
            family: 0,
            weight: 700,
            italic: false,
            size,
            color: ink,
        };
        paint_text(
            scene,
            &card.title,
            style,
            Rect::new(r.x + 6.0, r.y, r.w - 12.0, hh),
            Align::Left,
            hh,
            window,
            cx,
        );
    }
}

fn luminance(c: Rgba) -> f32 {
    (0.2126 * c.r() as f32 + 0.7152 * c.g() as f32 + 0.0722 * c.b() as f32) / 255.0
}

fn paint_items(
    scene: &Scene,
    card: &solenoid_scene::Card,
    camera: &Camera,
    window: &mut Window,
    cx: &mut App,
) {
    let o = card.rect.origin();
    for item in &card.items {
        let t0 = Instant::now();
        let kind = match item {
            Item::Box { .. } => 0,
            Item::Text { .. } => 1,
            Item::Path { .. } => 2,
            Item::Image { .. } => 3,
            Item::Icon { .. } => 4,
        };
        let _g = KindTimer(kind, t0);
        match item.clip() {
            Some(c) => {
                let mask = ContentMask {
                    bounds: bounds(camera.rect_to_screen(&c.offset(o))),
                };
                window.with_content_mask(Some(mask), |w| paint_item(scene, item, o, camera, w, cx));
            }
            None => paint_item(scene, item, o, camera, window, cx),
        }
    }
}

fn paint_item(
    scene: &Scene,
    item: &Item,
    o: Point,
    camera: &Camera,
    window: &mut Window,
    cx: &mut App,
) {
    let to = |r: &Rect| camera.rect_to_screen(&r.offset(o));
    match item {
        Item::Box {
            rect,
            fill,
            stroke,
            stroke_w,
            radius,
            shadow,
            dashed,
            ..
        } => {
            let r = to(rect);
            if r.w < 0.3 && r.h < 0.3 {
                return;
            }
            let corner = px((radius * camera.zoom).min(r.w / 2.0).min(r.h / 2.0));
            if let Some(s) = shadow
                && s.color.is_visible()
            {
                window.paint_shadows(
                    bounds(r),
                    corner.into(),
                    &[BoxShadow {
                        color: hsla(s.color),
                        offset: point(px(s.dx * camera.zoom), px(s.dy * camera.zoom)),
                        blur_radius: px(s.blur * camera.zoom),
                        spread_radius: px(0.0),
                    }],
                );
            }
            let bw = if stroke.is_visible() {
                (stroke_w * camera.zoom).max(0.5)
            } else {
                0.0
            };
            if !fill.is_visible() && bw == 0.0 {
                return;
            }
            let style = if *dashed {
                BorderStyle::Dashed
            } else {
                BorderStyle::Solid
            };
            window.paint_quad(quad(
                bounds(r),
                corner,
                hsla(*fill),
                Edges::all(px(bw)),
                hsla(*stroke),
                style,
            ));
        }
        Item::Text {
            rect,
            text,
            color,
            size,
            weight,
            family,
            italic,
            align,
            line_h,
            ..
        } => {
            if LOD.with(|l| l.get()) && !lod::text_visible(*size, camera.zoom) {
                return;
            }
            let lh = if *line_h > 0.0 {
                line_h * camera.zoom
            } else {
                size * 1.2 * camera.zoom
            };
            let style = TextStyle {
                family: *family,
                weight: *weight,
                italic: *italic,
                size: size * camera.zoom,
                color: *color,
            };
            paint_text(scene, text, style, to(rect), *align, lh, window, cx);
        }
        Item::Path {
            path,
            fill,
            stroke,
            stroke_w,
            ..
        } => {
            let p = path.translate(o);
            if fill.is_visible() {
                fill_path(&p, camera, *fill, window);
            }
            if stroke.is_visible() && *stroke_w > 0.0 {
                stroke_path(
                    &p,
                    camera,
                    (stroke_w * camera.zoom).max(0.5),
                    *stroke,
                    window,
                );
            }
        }
        Item::Image { rect, src, .. } => {
            if let Some(img) = IMAGES.with(|m| m.borrow().get(src).cloned()) {
                let _ = window.paint_image(bounds(to(rect)), px(0.0).into(), img, 0, false);
            }
        }
        Item::Icon {
            rect,
            svg,
            color,
            rotate,
            ..
        } => {
            let r = to(rect);
            if r.w < 1.5 {
                return;
            }
            let sf = window.scale_factor();
            let c = r.center();
            let m = TransformationMatrix::unit()
                .translate(point(px(c.x).scale(sf), px(c.y).scale(sf)))
                .rotate(Radians(rotate.to_radians()))
                .translate(point(px(-c.x).scale(sf), px(-c.y).scale(sf)));
            let path: SharedString = format!("{SVG_PREFIX}{svg}").into();
            let _ = window.paint_svg(bounds(r), path, m, hsla(*color), cx);
        }
    }
}

#[derive(Clone, Copy)]
struct TextStyle {
    family: u16,
    weight: u16,
    italic: bool,
    size: f32,
    color: Rgba,
}

#[allow(clippy::too_many_arguments)]
fn paint_text(
    scene: &Scene,
    text: &str,
    st: TextStyle,
    r: Rect,
    align: Align,
    line_h: f32,
    window: &mut Window,
    cx: &mut App,
) {
    let (fam, weight, italic, size, color) = (st.family, st.weight, st.italic, st.size, st.color);
    let mut f = font(family(scene, fam));
    f.weight = FontWeight(weight as f32);
    f.style = if italic {
        FontStyle::Italic
    } else {
        FontStyle::Normal
    };
    let run = TextRun {
        len: text.len(),
        font: f,
        color: hsla(color),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    let text: SharedString = text.to_string().into();
    let wrapped = r.h > line_h * 1.5;
    let ts = window.text_system().clone();
    if wrapped {
        let Ok(lines) = ts.shape_text(text, px(size), &[run], Some(px(r.w + 1.0)), None) else {
            return;
        };
        let ta = match align {
            Align::Left => TextAlign::Left,
            Align::Center => TextAlign::Center,
            Align::Right => TextAlign::Right,
        };
        let mut y = r.y;
        for line in lines {
            let _ = line.paint(
                point(px(r.x), px(y)),
                px(line_h),
                ta,
                Some(bounds(r)),
                window,
                cx,
            );
            y += f32::from(line.size(px(line_h)).height);
        }
    } else {
        let line = ts.shape_line(text, px(size), &[run], None);
        // Chromium's line box is `r`; center the line in it, as an inline box centers its text.
        let y = r.y + (r.h - line_h) / 2.0;
        let _ = line.paint(point(px(r.x), px(y)), px(line_h), window, cx);
    }
}

fn build(path: &Path, camera: &Camera, mut b: PathBuilder) -> Option<gpui::Path<Pixels>> {
    let mut any = false;
    for s in &path.0 {
        match *s {
            Seg::Move { to } => b.move_to(gp(camera.to_screen(to))),
            Seg::Line { to } => {
                b.line_to(gp(camera.to_screen(to)));
                any = true;
            }
            Seg::Quad { c, to } => {
                b.curve_to(gp(camera.to_screen(to)), gp(camera.to_screen(c)));
                any = true;
            }
            Seg::Cubic { c1, c2, to } => {
                b.cubic_bezier_to(
                    gp(camera.to_screen(to)),
                    gp(camera.to_screen(c1)),
                    gp(camera.to_screen(c2)),
                );
                any = true;
            }
        }
    }
    if !any {
        return None;
    }
    b.build().ok()
}

fn stroke_path(path: &Path, camera: &Camera, width: f32, color: Rgba, window: &mut Window) {
    if let Some(p) = build(path, camera, PathBuilder::stroke(px(width))) {
        window.paint_path(p, hsla(color));
    }
}

fn fill_path(path: &Path, camera: &Camera, color: Rgba, window: &mut Window) {
    if let Some(p) = build(path, camera, PathBuilder::fill()) {
        window.paint_path(p, hsla(color));
    }
}

fn main() {
    env_logger::init();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let dir = PathBuf::from(
        args.iter()
            .find(|a| !a.starts_with("--"))
            .cloned()
            .unwrap_or_else(|| {
                eprintln!(
                    "usage: solenoid-gpui <scene-dir> [--zoom Z] [--tile N] [--lod] [--bench] [--exit-after MS]"
                );
                std::process::exit(2);
            }),
    );
    let flag = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    let bench = args.iter().any(|a| a == "--bench");
    let zoom: Option<f32> = flag("--zoom").and_then(|z| z.parse().ok());
    let exit_after: Option<u64> = flag("--exit-after").and_then(|z| z.parse().ok());
    let json = std::fs::read_to_string(dir.join("scene.json")).expect("scene.json");
    let tile: usize = flag("--tile").and_then(|z| z.parse().ok()).unwrap_or(1);
    let scene = Scene::from_json(&json).expect("a scene").tiled(tile);
    LOD.with(|l| l.set(args.iter().any(|a| a == "--lod")));
    load_images(&scene);
    if tile > 1 {
        eprintln!(
            "tiled {tile}×{tile}: {} cards, {} items, {} cables",
            scene.cards.len(),
            scene.cards.iter().map(|c| c.items.len()).sum::<usize>(),
            scene.cables.len()
        );
    }
    let mut fonts: Vec<std::borrow::Cow<'static, [u8]>> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir.join("fonts")) {
        for e in rd.flatten() {
            if e.path().extension().is_some_and(|x| x == "ttf") {
                fonts.push(std::fs::read(e.path()).unwrap().into());
            }
        }
    }
    let viewport = scene.viewport;

    let assets = SceneAssets(scene.svgs.clone());
    Application::new()
        .with_assets(assets)
        .run(move |cx: &mut App| {
            cx.text_system().add_fonts(fonts).expect("fonts");
            let b = Bounds::centered(None, size(px(viewport.x), px(viewport.y)), cx);
            cx.open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(b)),
                    titlebar: Some(gpui::TitlebarOptions {
                        title: Some("Solenoid (GPUI)".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                move |_, cx| {
                    cx.new(|_| {
                        let mut v = SceneView {
                            camera: scene.camera,
                            viewport,
                            scene: Rc::new(scene),
                            drag: None,
                            last_paint: Rc::new(Cell::new((Duration::ZERO, 0))),
                            bench: bench.then(|| Bench {
                                zooms: vec![1.0, 0.5, 0.25, 0.1],
                                step: 0,
                                frame: 0,
                                totals: [1.0, 0.5, 0.25, 0.1]
                                    .iter()
                                    .map(|&z| (z, Duration::ZERO, 0))
                                    .collect(),
                            }),
                            fitted: false,
                        };
                        if let Some(z) = zoom {
                            let c = v.scene.bounds().center();
                            v.camera = Camera {
                                x: viewport.x / 2.0 - c.x * z,
                                y: viewport.y / 2.0 - c.y * z,
                                zoom: z,
                            };
                            v.fitted = true;
                        }
                        v
                    })
                },
            )
            .unwrap();
            cx.activate(true);
            if let Some(ms) = exit_after {
                cx.spawn(async move |cx| {
                    cx.background_executor()
                        .timer(Duration::from_millis(ms))
                        .await;
                    let _ = cx.update(|cx| cx.quit());
                })
                .detach();
            }
        });
}
