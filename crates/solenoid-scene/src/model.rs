//! The scene: what the exporter writes (`scene.json`) and every renderer reads.
//!
//! A card is a flat display list captured from Chromium's layout at zoom 1: boxes, text runs and vector paths, each
//! placed relative to the card's top-left corner. A renderer draws the list as given and does no layout of its own,
//! which is what makes every card type "close enough" without porting its component. Moving a card moves its list;
//! editing one is out of a renderer's scope until the cards themselves move to Rust.

use crate::cable::{self, Ends, Shape};
use crate::camera::Camera;
use crate::color::Rgba;
use crate::geom::{Point, Rect};
use crate::path::Path;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const VERSION: u32 = 1;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Scene {
    pub version: u32,
    /// The seed or document it was captured from.
    #[serde(default)]
    pub name: String,
    /// The browser viewport at capture, and its camera.
    pub viewport: Point,
    pub camera: Camera,
    pub background: Rgba,
    #[serde(default)]
    pub grid: Option<Grid>,
    /// The cable shape the app was set to, for rerouting.
    #[serde(default)]
    pub cable_shape: Shape,
    /// Font families the text runs name, in the order the exporter found them.
    #[serde(default)]
    pub fonts: Vec<String>,
    pub cards: Vec<Card>,
    pub cables: Vec<Cable>,
    /// SVG sources the icon items point into, deduplicated.
    #[serde(default)]
    pub svgs: Vec<String>,
    #[serde(skip)]
    index: HashMap<String, usize>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Grid {
    /// The distance between dots in flow pixels.
    pub gap: f32,
    pub radius: f32,
    pub color: Rgba,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    /// `card`, `group`, `note`, `fc` … the root element's role, for renderers that treat groups differently.
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub type_name: String,
    pub accent: Rgba,
    /// The card's box in flow coordinates.
    pub rect: Rect,
    /// Stacking order: higher draws later.
    #[serde(default)]
    pub z: i32,
    /// The group this card sits in; it moves with it.
    #[serde(default)]
    pub parent: Option<String>,
    /// The header band's height, for the far-zoom silhouette.
    #[serde(default)]
    pub header_h: f32,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub sockets: Vec<Socket>,
    /// The card's place at capture, so a renderer knows which cables to reroute.
    #[serde(skip)]
    pub moved: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    In,
    Out,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Socket {
    pub key: String,
    pub side: Side,
    /// The socket's center, relative to the card.
    pub at: Point,
    #[serde(default)]
    pub radius: f32,
    pub color: Rgba,
    #[serde(default)]
    pub ring: Rgba,
    /// `circle`, `square`, `diamond`, `ring` … as the app's `data-socket-shape`.
    #[serde(default)]
    pub shape: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
}

/// Every item may carry `clip`: the box of its nearest clipping ancestor in the card (an `overflow` box, or the
/// `<svg>` a shape sits in), in card coordinates. A renderer masks the item to it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Item {
    /// A filled and/or stroked rounded rectangle.
    Box {
        rect: Rect,
        #[serde(default)]
        fill: Rgba,
        #[serde(default)]
        stroke: Rgba,
        #[serde(default)]
        stroke_w: f32,
        #[serde(default)]
        radius: f32,
        /// Drop shadow color, when the element has one.
        #[serde(default)]
        shadow: Option<Shadow>,
        #[serde(default)]
        dashed: bool,
        #[serde(default)]
        clip: Option<Rect>,
    },
    /// One run of text laid out by Chromium in `rect` (a line box, or the whole block when it wrapped).
    Text {
        rect: Rect,
        text: String,
        color: Rgba,
        size: f32,
        #[serde(default = "default_weight")]
        weight: u16,
        #[serde(default)]
        family: u16,
        #[serde(default)]
        italic: bool,
        #[serde(default)]
        align: Align,
        #[serde(default)]
        line_h: f32,
        #[serde(default)]
        clip: Option<Rect>,
    },
    /// An SVG shape, already in card coordinates.
    Path {
        path: Path,
        #[serde(default)]
        fill: Rgba,
        #[serde(default)]
        stroke: Rgba,
        #[serde(default)]
        stroke_w: f32,
        #[serde(default)]
        clip: Option<Rect>,
    },
    /// A `<canvas>` or `<img>` the exporter could only capture as a picture (`data:` PNG).
    Image {
        rect: Rect,
        src: String,
        #[serde(default)]
        clip: Option<Rect>,
    },
    /// A one-color icon: an SVG (`Scene::svgs[svg]`) used as a CSS mask over a color, as the app's chevrons and
    /// select arrows are. `rotate` is in degrees, about the center.
    Icon {
        rect: Rect,
        svg: u32,
        color: Rgba,
        #[serde(default)]
        rotate: f32,
        #[serde(default)]
        clip: Option<Rect>,
    },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Shadow {
    pub color: Rgba,
    pub dx: f32,
    pub dy: f32,
    pub blur: f32,
}

fn default_weight() -> u16 {
    400
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Cable {
    pub id: String,
    pub source: String,
    pub source_key: String,
    pub target: String,
    pub target_key: String,
    pub color: Rgba,
    #[serde(default = "default_width")]
    pub width: f32,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    /// The path the app drew, in flow coordinates.
    pub path: Path,
}

fn default_width() -> f32 {
    1.8
}
fn default_opacity() -> f32 {
    1.0
}

impl Scene {
    pub fn from_json(s: &str) -> Result<Scene, serde_json::Error> {
        let mut scene: Scene = serde_json::from_str(s)?;
        scene.reindex();
        Ok(scene)
    }

    pub fn reindex(&mut self) {
        self.index = self
            .cards
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id.clone(), i))
            .collect();
    }

    pub fn card(&self, id: &str) -> Option<&Card> {
        self.index.get(id).map(|&i| &self.cards[i])
    }

    pub fn card_index(&self, id: &str) -> Option<usize> {
        self.index.get(id).copied()
    }

    /// The box every card fits in.
    pub fn bounds(&self) -> Rect {
        let mut it = self.cards.iter().map(|c| c.rect);
        let Some(first) = it.next() else {
            return Rect::new(0.0, 0.0, 1.0, 1.0);
        };
        it.fold(first, |a, r| a.union(&r))
    }

    /// Moves a card and every card inside it (a group's members, a docked FC) by `d` flow pixels.
    pub fn move_card(&mut self, id: &str, d: Point) {
        let mut stack = vec![id.to_string()];
        let mut seen = std::collections::HashSet::new();
        while let Some(cur) = stack.pop() {
            if !seen.insert(cur.clone()) {
                continue;
            }
            if let Some(i) = self.card_index(&cur) {
                let c = &mut self.cards[i];
                c.rect = c.rect.offset(d);
                c.moved = true;
            }
            for c in &self.cards {
                if c.parent.as_deref() == Some(cur.as_str()) {
                    stack.push(c.id.clone());
                }
            }
        }
    }

    /// A socket's center in flow coordinates.
    pub fn socket_point(&self, card: &str, key: &str, side: Side) -> Option<Point> {
        let c = self.card(card)?;
        let s = c.sockets.iter().find(|s| s.key == key && s.side == side)?;
        Some(c.rect.origin().plus(s.at))
    }

    /// The path to draw for a cable: the app's own until either end has moved, then a reroute in the scene's shape.
    pub fn cable_path(&self, cable: &Cable) -> Path {
        let moved = |id: &str| self.card(id).is_some_and(|c| c.moved);
        if !moved(&cable.source) && !moved(&cable.target) {
            return cable.path.clone();
        }
        let (Some(a), Some(b)) = (
            self.socket_point(&cable.source, &cable.source_key, Side::Out),
            self.socket_point(&cable.target, &cable.target_key, Side::In),
        ) else {
            // A socket the exporter didn't find (a hidden card's): keep the old path, shifted with whichever end moved.
            return cable.path.clone();
        };
        cable::route(self.cable_shape, &Ends::left_to_right(a, b))
    }

    /// The topmost card under a flow point.
    pub fn card_at(&self, p: Point) -> Option<&Card> {
        self.cards
            .iter()
            .filter(|c| c.rect.contains(p))
            .max_by_key(|c| (c.z, c.kind != "group"))
    }

    /// Cards in drawing order: groups first, then by stacking order, then as the app listed them.
    pub fn draw_order(&self) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.cards.len()).collect();
        order.sort_by_key(|&i| (self.cards[i].kind != "group", self.cards[i].z));
        order
    }
}

impl Item {
    pub fn clip(&self) -> Option<Rect> {
        match self {
            Item::Box { clip, .. }
            | Item::Text { clip, .. }
            | Item::Path { clip, .. }
            | Item::Image { clip, .. }
            | Item::Icon { clip, .. } => *clip,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny() -> Scene {
        let json = r##"{
          "version": 1, "viewport": {"x": 800, "y": 600}, "camera": {"x": 0, "y": 0, "zoom": 1},
          "background": "#0b0b0b", "cable_shape": "diagonal",
          "cards": [
            {"id": "g", "kind": "group", "accent": "#3173e0", "rect": {"x": 0, "y": 0, "w": 400, "h": 300}},
            {"id": "a", "kind": "card", "accent": "#f5b914", "parent": "g", "rect": {"x": 10, "y": 10, "w": 100, "h": 50},
             "sockets": [{"key": "value", "side": "out", "at": {"x": 100, "y": 25}, "color": "#f5b914"}],
             "items": [{"t": "text", "rect": {"x": 4, "y": 4, "w": 80, "h": 14}, "text": "Budget", "color": "#ffffff", "size": 12}]},
            {"id": "b", "kind": "card", "accent": "#7b64ed", "rect": {"x": 600, "y": 200, "w": 100, "h": 50},
             "sockets": [{"key": "x", "side": "in", "at": {"x": 0, "y": 25}, "color": "#f5b914"}]}
          ],
          "cables": [{"id": "c", "source": "a", "source_key": "value", "target": "b", "target_key": "x",
                      "color": "#f5b914", "path": [{"op": "move", "to": {"x": 110, "y": 35}}, {"op": "line", "to": {"x": 600, "y": 225}}]}]
        }"##;
        Scene::from_json(json).unwrap()
    }

    #[test]
    fn reads_a_scene() {
        let s = tiny();
        assert_eq!(s.cards.len(), 3);
        assert_eq!(
            s.socket_point("a", "value", Side::Out),
            Some(Point::new(110.0, 35.0))
        );
        assert_eq!(s.bounds(), Rect::new(0.0, 0.0, 700.0, 300.0));
        assert_eq!(s.card_at(Point::new(20.0, 20.0)).unwrap().id, "a");
        assert_eq!(s.card_at(Point::new(300.0, 200.0)).unwrap().id, "g");
    }

    #[test]
    fn moving_a_group_moves_its_members_and_reroutes() {
        let mut s = tiny();
        let before = s.cable_path(&s.cables[0]);
        assert_eq!(before.0.len(), 2, "the exported path until something moves");
        s.move_card("g", Point::new(0.0, 100.0));
        assert_eq!(s.card("a").unwrap().rect.y, 110.0);
        let after = s.cable_path(&s.cables[0]);
        assert_eq!(after.0.first().unwrap().end(), Point::new(110.0, 135.0));
        assert_eq!(after.0.last().unwrap().end(), Point::new(600.0, 225.0));
        assert!(after.0.len() > 2, "rerouted on the diagonal grid");
    }
}
