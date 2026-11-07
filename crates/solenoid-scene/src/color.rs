//! Colors as the exporter writes them: Chromium's computed style strings (`rgb(…)`, `rgba(…)`, `#rrggbb`).

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// An sRGB color with straight alpha, 0 to 255 a channel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Rgba(pub [u8; 4]);

impl Rgba {
    pub const TRANSPARENT: Rgba = Rgba([0, 0, 0, 0]);

    pub const fn rgb(r: u8, g: u8, b: u8) -> Rgba {
        Rgba([r, g, b, 255])
    }

    pub fn r(self) -> u8 {
        self.0[0]
    }
    pub fn g(self) -> u8 {
        self.0[1]
    }
    pub fn b(self) -> u8 {
        self.0[2]
    }
    pub fn a(self) -> u8 {
        self.0[3]
    }

    pub fn is_visible(self) -> bool {
        self.0[3] > 0
    }

    /// The same color at `factor` times its alpha.
    pub fn fade(self, factor: f32) -> Rgba {
        let [r, g, b, a] = self.0;
        Rgba([r, g, b, (a as f32 * factor.clamp(0.0, 1.0)).round() as u8])
    }

    /// `0xRRGGBBAA`, the packed form GPUI's `rgba()` takes.
    pub fn to_u32(self) -> u32 {
        let [r, g, b, a] = self.0;
        u32::from_be_bytes([r, g, b, a])
    }

    /// `#rrggbbaa`.
    pub fn to_hex(self) -> String {
        let [r, g, b, a] = self.0;
        format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
    }

    /// Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)`, the space-separated
    /// `rgb(r g b / a)` and `transparent`. Anything else is `None`.
    pub fn parse(s: &str) -> Option<Rgba> {
        let s = s.trim();
        if s.eq_ignore_ascii_case("transparent") {
            return Some(Rgba::TRANSPARENT);
        }
        if let Some(hex) = s.strip_prefix('#') {
            return parse_hex(hex);
        }
        let inner = s
            .strip_prefix("rgba(")
            .or_else(|| s.strip_prefix("rgb("))?
            .strip_suffix(')')?;
        let parts: Vec<&str> = inner
            .split(|c: char| c == ',' || c == '/' || c.is_whitespace())
            .filter(|p| !p.is_empty())
            .collect();
        if parts.len() < 3 {
            return None;
        }
        let ch = |p: &str| -> Option<u8> {
            let v = if let Some(pc) = p.strip_suffix('%') {
                pc.parse::<f32>().ok()? * 2.55
            } else {
                p.parse::<f32>().ok()?
            };
            Some(v.round().clamp(0.0, 255.0) as u8)
        };
        let alpha = match parts.get(3) {
            None => 255,
            Some(p) => {
                let v = if let Some(pc) = p.strip_suffix('%') {
                    pc.parse::<f32>().ok()? / 100.0
                } else {
                    p.parse::<f32>().ok()?
                };
                (v.clamp(0.0, 1.0) * 255.0).round() as u8
            }
        };
        Some(Rgba([ch(parts[0])?, ch(parts[1])?, ch(parts[2])?, alpha]))
    }
}

fn parse_hex(hex: &str) -> Option<Rgba> {
    let nib = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let b = hex.as_bytes();
    match b.len() {
        3 | 4 => {
            let mut out = [255u8; 4];
            for (i, &c) in b.iter().enumerate() {
                let n = nib(c)?;
                out[i] = n * 17;
            }
            Some(Rgba(out))
        }
        6 | 8 => {
            let mut out = [255u8; 4];
            for i in 0..b.len() / 2 {
                out[i] = nib(b[2 * i])? * 16 + nib(b[2 * i + 1])?;
            }
            Some(Rgba(out))
        }
        _ => None,
    }
}

impl Serialize for Rgba {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Rgba {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Rgba, D::Error> {
        let s = String::deserialize(d)?;
        // An unparseable color draws nothing rather than failing the whole scene.
        Ok(Rgba::parse(&s).unwrap_or(Rgba::TRANSPARENT))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_forms_chromium_writes() {
        assert_eq!(
            Rgba::parse("rgb(123, 100, 237)"),
            Some(Rgba([123, 100, 237, 255]))
        );
        assert_eq!(
            Rgba::parse("rgba(123, 100, 237, 0.5)"),
            Some(Rgba([123, 100, 237, 128]))
        );
        assert_eq!(Rgba::parse("rgb(1 2 3 / 0%)"), Some(Rgba([1, 2, 3, 0])));
        assert_eq!(Rgba::parse("#f5b914"), Some(Rgba([0xf5, 0xb9, 0x14, 255])));
        assert_eq!(Rgba::parse("#fff8"), Some(Rgba([255, 255, 255, 0x88])));
        assert_eq!(Rgba::parse("transparent"), Some(Rgba::TRANSPARENT));
        assert_eq!(Rgba::parse("color-mix(in srgb, red, blue)"), None);
    }

    #[test]
    fn round_trips_through_json_as_hex() {
        let c = Rgba([1, 2, 3, 4]);
        let j = serde_json::to_string(&c).unwrap();
        assert_eq!(j, "\"#01020304\"");
        assert_eq!(serde_json::from_str::<Rgba>(&j).unwrap(), c);
        assert_eq!(c.to_u32(), 0x01020304);
    }
}
