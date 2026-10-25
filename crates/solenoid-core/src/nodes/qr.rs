//! [[C100]] chartIsAValue, [[B2]] webTryDesktopFull. The QR Code card, a text, a Wi-Fi
//! network or a contact as a QR image: the payload and the SVG are Solenoid's, the symbol is `qrcodegen`'s.

use super::Cv;
use super::{err, Answer, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use crate::jsnum::js_trim;
use qrcodegen::{QrCode, QrCodeEcc, QrSegment, Version};
use serde_json::{json, Value as Json};
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "QrCodeNode" => qr_code(c),
        _ => return None,
    })
}

/// The smallest symbol that holds `text` at exactly `ecc` (no boost, so the card's level is the level drawn), the
/// text in one numeric, alphanumeric or UTF-8 byte segment, with the mask whose penalty is lowest.
pub fn encode(text: &str, ecc: QrCodeEcc) -> Result<QrCode, String> {
    QrCode::encode_segments_advanced(&QrSegment::make_segments(text), ecc, Version::MIN, Version::MAX, None, false)
        .map_err(|_| "The amount of data is too big to be stored in a QR Code".to_string())
}

/// The Wi-Fi MECARD-style grammar escapes \ ; , : and ".
fn esc_wifi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if matches!(ch, '\\' | ';' | ',' | ':' | '"') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// The template's fields read by `lit`: an empty essential field gives "" (no code).
fn payload(template: &str, text: &str, lit: &dyn Fn(&str) -> String) -> String {
    match template {
        "wifi" => {
            let ssid = lit("ssid");
            let ssid = js_trim(&ssid);
            if ssid.is_empty() {
                return String::new();
            }
            let auth = match lit("wifiAuth") {
                a if a.is_empty() => "WPA".to_string(),
                a => a,
            };
            let hidden = if lit("wifiHidden") == "true" { "H:true;" } else { "" };
            if auth == "nopass" {
                format!("WIFI:T:nopass;S:{};{hidden};", esc_wifi(ssid))
            } else {
                format!("WIFI:T:{auth};S:{};P:{};{hidden};", esc_wifi(ssid), esc_wifi(&lit("wifiPass")))
            }
        }
        "vcard" => {
            let lines: Vec<String> =
                [("FN", "vcName"), ("TEL", "vcPhone"), ("EMAIL", "vcEmail"), ("ORG", "vcOrg"), ("URL", "vcUrl")]
                    .iter()
                    .filter_map(|(k, f)| {
                        let v = lit(f);
                        let v = js_trim(&v);
                        (!v.is_empty()).then(|| format!("{k}:{v}"))
                    })
                    .collect();
            if lines.is_empty() {
                return String::new();
            }
            ["BEGIN:VCARD".to_string(), "VERSION:3.0".to_string()]
                .into_iter()
                .chain(lines)
                .chain(["END:VCARD".to_string()])
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => js_trim(text).to_string(),
    }
}

/// The symbol as SVG with its four-module quiet zone, as a `data:` URL.
fn svg_src(size: usize, dark: &dyn Fn(usize, usize) -> bool) -> String {
    let margin = 4;
    let dim = size + margin * 2;
    let mut path = String::new();
    for r in 0..size {
        for col in 0..size {
            if dark(col, r) {
                path.push_str(&format!("M{} {}h1v1h-1z", col + margin, r + margin));
            }
        }
    }
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {dim} {dim}\" shape-rendering=\"crispEdges\"><rect width=\"{dim}\" height=\"{dim}\" fill=\"#ffffff\"/><path d=\"{path}\" fill=\"#000000\"/></svg>"
    );
    format!("data:image/svg+xml,{}", crate::text_ops::encode_uri_component(&svg))
}

fn qr_code(c: &mut Call) -> Answer {
    let template = c.field_str("qrTemplate", "text").to_string();
    let text = if template == "text" {
        let typed = match c.string_literal("text") {
            V::Undef | V::Null => V::str(""),
            v => v,
        };
        match c.read_input("text", typed) {
            V::Str(s) => s.to_string(),
            _ => String::new(),
        }
    } else {
        String::new()
    };
    let lit = |k: &str| match c.string_literal(k) {
        V::Str(s) => s.to_string(),
        _ => String::new(),
    };
    let payload = payload(&template, &text, &lit);
    if payload.is_empty() {
        c.show("cachedResult", V::Null);
        return Ok(vec![("chart".into(), Cv::from(V::Null))]);
    }
    let symbol = encode(&payload, QrCodeEcc::Medium)
        .map_err(|m| err(ErrorCode::Error, format!("This node failed to compute: {m}")))?;
    let label = c.field_str("label", "QR Code").to_string();
    let height = c.field("imageHeight").cloned().unwrap_or(Json::from(200));
    let image = Cv::Json(Rc::new(
        json!({ "__image": true, "src": svg_src(symbol.size() as usize, &|x, y| symbol.get_module(x as i32, y as i32)), "height": height, "alt": label, "title": label }),
    ));
    c.show("cachedResult", image.clone());
    Ok(vec![("chart".into(), image)])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build(template: &str, text: &str, fields: &[(&str, &str)]) -> String {
        payload(template, text, &|k| fields.iter().find(|(f, _)| *f == k).map_or(String::new(), |(_, v)| v.to_string()))
    }

    #[test]
    fn a_text_is_trimmed() {
        assert_eq!(build("text", "  https://example.com  ", &[]), "https://example.com");
        assert_eq!(build("text", "   ", &[]), "");
    }

    #[test]
    fn a_network_is_the_wifi_grammar() {
        assert_eq!(
            build("wifi", "", &[("ssid", "MyNet"), ("wifiPass", "secret"), ("wifiAuth", "WPA")]),
            "WIFI:T:WPA;S:MyNet;P:secret;;"
        );
        assert_eq!(
            build("wifi", "", &[("ssid", "Cafe;A"), ("wifiPass", "p:a\"b"), ("wifiAuth", "WPA")]),
            "WIFI:T:WPA;S:Cafe\\;A;P:p\\:a\\\"b;;"
        );
        assert_eq!(build("wifi", "", &[("ssid", "Open"), ("wifiAuth", "nopass")]), "WIFI:T:nopass;S:Open;;");
        assert_eq!(
            build("wifi", "", &[("ssid", "N"), ("wifiPass", "p"), ("wifiAuth", "WPA"), ("wifiHidden", "true")]),
            "WIFI:T:WPA;S:N;P:p;H:true;;"
        );
        assert_eq!(
            build("wifi", "", &[("ssid", "N"), ("wifiAuth", "nopass"), ("wifiHidden", "true")]),
            "WIFI:T:nopass;S:N;H:true;;"
        );
        assert_eq!(build("wifi", "", &[("ssid", ""), ("wifiPass", "p")]), "");
    }

    #[test]
    fn a_contact_holds_its_filled_lines() {
        assert_eq!(
            build("vcard", "", &[("vcName", "Ada Lovelace"), ("vcEmail", "ada@x.io")]),
            "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEMAIL:ada@x.io\nEND:VCARD"
        );
        assert_eq!(build("vcard", "", &[]), "");
    }

    #[test]
    fn the_image_rings_the_modules_with_a_quiet_zone() {
        let src = svg_src(2, &|x, y| x == y);
        let svg = src.strip_prefix("data:image/svg+xml,").unwrap();
        assert!(svg.contains("viewBox%3D%220%200%2010%2010%22"), "{svg}");
        assert!(svg.contains("M4%204h1v1h-1z") && svg.contains("M5%205h1v1h-1z") && !svg.contains("M4%205"), "{svg}");
        assert!(svg.contains("%23ffffff") && svg.contains("%23000000"), "{svg}");
    }
}
