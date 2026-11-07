//! What one frame draws: the cards and cables in view, and how much of each card. Far out a card is a silhouette (its
//! accent header, its body, its title) instead of its whole display list, which is where a DOM canvas spends its
//! frame at low zoom (`docs/archive/rust-gpu-ui-findings.md` § Pan and zoom).

use crate::camera::Camera;
use crate::geom::{Point, Rect};
use crate::model::Scene;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Detail {
    /// Every box, text run and path.
    Full,
    /// The card's outline, header band and title.
    Silhouette,
    /// One filled rectangle.
    Block,
}

/// At or above this zoom cards draw whole.
pub const FULL_ZOOM: f32 = 0.35;
/// A card narrower than this on screen is one rectangle.
pub const BLOCK_PX: f32 = 10.0;
/// Text smaller than this on screen is skipped.
pub const MIN_TEXT_PX: f32 = 3.0;

pub fn detail(zoom: f32, screen_w: f32) -> Detail {
    if screen_w < BLOCK_PX {
        Detail::Block
    } else if zoom >= FULL_ZOOM {
        Detail::Full
    } else {
        Detail::Silhouette
    }
}

/// Whether text of `size` is worth shaping at `zoom` when level of detail is on; full fidelity draws all of it.
pub fn text_visible(size: f32, zoom: f32) -> bool {
    size * zoom >= MIN_TEXT_PX
}

#[derive(Debug, Default)]
pub struct Frame {
    pub visible: Rect,
    /// Indexes into `scene.cards`, in drawing order, with their detail.
    pub cards: Vec<(usize, Detail)>,
    /// Indexes into `scene.cables`.
    pub cables: Vec<usize>,
}

impl Frame {
    /// Every card in view at full detail (a card under 2 px is one rectangle, which is all it covers anyway).
    pub fn build(scene: &Scene, camera: &Camera, size: Point) -> Frame {
        Frame::build_with(scene, camera, size, false)
    }

    /// As `build`, and with `lod` far-out cards step down to silhouettes and blocks ([`detail`]).
    pub fn build_with(scene: &Scene, camera: &Camera, size: Point, lod: bool) -> Frame {
        // A margin so a socket or a shadow at the edge isn't clipped by the cull.
        let visible = camera.visible(size).inflate(24.0 / camera.zoom);
        let cards = scene
            .draw_order()
            .into_iter()
            .filter(|&i| scene.cards[i].rect.intersects(&visible))
            .map(|i| {
                let w = scene.cards[i].rect.w * camera.zoom;
                let d = if lod {
                    detail(camera.zoom, w)
                } else if w < 2.0 {
                    Detail::Block
                } else {
                    Detail::Full
                };
                (i, d)
            })
            .collect();
        let cables = scene
            .cables
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                scene
                    .cable_path(c)
                    .bounds()
                    .is_some_and(|b| b.inflate(4.0).intersects(&visible))
            })
            .map(|(i, _)| i)
            .collect();
        Frame {
            visible,
            cards,
            cables,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Card;

    #[test]
    fn detail_steps_down_with_zoom() {
        assert_eq!(detail(1.0, 260.0), Detail::Full);
        assert_eq!(detail(0.2, 52.0), Detail::Silhouette);
        assert_eq!(detail(0.03, 7.8), Detail::Block);
        assert!(!text_visible(11.0, 0.2));
        assert!(text_visible(11.0, 0.3));
    }

    #[test]
    fn culls_what_is_off_screen() {
        let mut s = Scene::default();
        for (i, x) in [0.0, 5000.0].into_iter().enumerate() {
            s.cards.push(Card {
                id: i.to_string(),
                rect: Rect::new(x, 0.0, 100.0, 50.0),
                ..Default::default()
            });
        }
        s.reindex();
        let f = Frame::build(&s, &Camera::default(), Point::new(1600.0, 1000.0));
        assert_eq!(f.cards, vec![(0, Detail::Full)]);
    }
}
