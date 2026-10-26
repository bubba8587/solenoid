// [[C23]] calcModes, [[C25]] firstClassUnits, [[D99]] rustIsSpec
//! The data providers' replies read into what their cards output: Open-Meteo's forecast, Nager.Date's public
//! holidays and Frankfurter's rates. The cards fetch and cache the text; these read it. A malformed body reads as
//! empty, never as an error.

use std::rc::Rc;

use serde_json::Value as Json;

use crate::excel_criteria::{parse_date, DateReading};
use crate::excel_functions::V;
use crate::frame::{ColumnUnit, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::jsnum::{js_trim, math_round, number_to_string};
use crate::unit_catalog::fc_unit_to_unit;

/// An ISO date as a serial; NaN for text that isn't one. The APIs write machine dates (YYYY-MM-DD), so none is
/// ambiguous.
fn date_serial(s: &str) -> f64 {
    match parse_date(js_trim(s)) {
        DateReading::Serial(d) => d,
        _ => f64::NAN,
    }
}

fn body(text: &str) -> Json {
    serde_json::from_str(text).unwrap_or(Json::Null)
}

fn num(v: &Json) -> FrameCell {
    v.as_f64().map_or(FrameCell::Null, FrameCell::Num)
}

fn column(name: &str, ty: FrameColType, values: Vec<FrameCell>) -> FrameColumn {
    FrameColumn::new(name, ty, values)
}

/// Open-Meteo's weather codes (WMO) and their short text.
const WMO: [(f64, &str); 28] = [
    (0.0, "Clear"),
    (1.0, "Mainly clear"),
    (2.0, "Partly cloudy"),
    (3.0, "Overcast"),
    (45.0, "Fog"),
    (48.0, "Rime fog"),
    (51.0, "Light drizzle"),
    (53.0, "Drizzle"),
    (55.0, "Dense drizzle"),
    (56.0, "Freezing drizzle"),
    (57.0, "Freezing drizzle"),
    (61.0, "Light rain"),
    (63.0, "Rain"),
    (65.0, "Heavy rain"),
    (66.0, "Freezing rain"),
    (67.0, "Freezing rain"),
    (71.0, "Light snow"),
    (73.0, "Snow"),
    (75.0, "Heavy snow"),
    (77.0, "Snow grains"),
    (80.0, "Light showers"),
    (81.0, "Showers"),
    (82.0, "Violent showers"),
    (85.0, "Snow showers"),
    (86.0, "Heavy snow showers"),
    (95.0, "Thunderstorm"),
    (96.0, "Thunderstorm, hail"),
    (99.0, "Thunderstorm, hail"),
];

/// A weather code's short text; "Code n" for one outside the table.
pub fn wmo_text(code: f64) -> String {
    WMO.iter().find(|w| w.0 == code).map_or_else(|| format!("Code {}", number_to_string(code)), |w| w.1.into())
}

/// The daily frame, a row per day of `time`; the temperatures carry the °C or °F `unit` picked. Beside it: the
/// temperature now (null when absent) and the condition now ("" when absent).
pub fn weather(text: &str, unit: &str) -> (FrameValue, V, V) {
    let Ok(root) = serde_json::from_str::<Json>(text) else {
        return (FrameValue { columns: Vec::new() }, V::Null, V::str(""));
    };
    let d = &root["daily"];
    let time = d["time"].as_array().map_or(&[][..], Vec::as_slice);
    let nums = |key: &str| -> Vec<FrameCell> {
        let a = d[key].as_array();
        (0..time.len()).map(|i| a.and_then(|a| a.get(i)).map_or(FrameCell::Null, num)).collect()
    };
    let id = if unit == "F" { "degF" } else { "degC" };
    let temp_unit = fc_unit_to_unit(id).map(|u| Rc::new(ColumnUnit { dim: u.dim, display: Some(id.into()) }));
    let temp = |name: &str, key: &str| FrameColumn {
        unit: temp_unit.clone(),
        ..column(name, FrameColType::Number, nums(key))
    };
    let codes = d["weather_code"].as_array();
    let columns = vec![
        column(
            "Date",
            FrameColType::Date,
            time.iter().map(|t| t.as_str().map_or(FrameCell::Null, |s| FrameCell::Num(date_serial(s)))).collect(),
        ),
        column("Rain mm", FrameColType::Number, nums("precipitation_sum")),
        column("Rain %", FrameColType::Number, nums("precipitation_probability_max")),
        temp("High", "temperature_2m_max"),
        temp("Low", "temperature_2m_min"),
        column("ET₀ mm", FrameColType::Number, nums("et0_fao_evapotranspiration")),
        column(
            "Condition",
            FrameColType::String,
            (0..time.len())
                .map(|i| match codes.and_then(|c| c.get(i)).and_then(Json::as_f64) {
                    Some(c) => FrameCell::Str(wmo_text(c).into()),
                    None => FrameCell::Null,
                })
                .collect(),
        ),
    ];
    let cur = &root["current"];
    let now = cur["temperature_2m"].as_f64().map_or(V::Null, V::Num);
    let condition = cur["weather_code"].as_f64().map_or_else(String::new, wmo_text);
    (FrameValue { columns }, now, V::str(&condition))
}

/// The year's public holidays that apply in `region` (blank: all; else nationwide days and that subdivision's), a row
/// each in the API's order; and the whole days from `today` to the next, or null when none remain. An undated row is
/// dropped.
pub fn holidays(text: &str, region: &str, today: f64) -> (FrameValue, V) {
    let root = body(text);
    let region = js_trim(region);
    let mut rows: Vec<(f64, &str, &str)> = Vec::new();
    for o in root.as_array().into_iter().flatten() {
        let Some(serial) = o["date"].as_str().map(date_serial).filter(|s| s.is_finite()) else { continue };
        let counties: Vec<&str> = o["counties"].as_array().into_iter().flatten().filter_map(Json::as_str).collect();
        if !region.is_empty() && !counties.is_empty() && !counties.contains(&region) {
            continue;
        }
        rows.push((serial, o["name"].as_str().unwrap_or(""), o["localName"].as_str().unwrap_or("")));
    }
    let text = |s: &str| if s.is_empty() { FrameCell::Null } else { FrameCell::Str(s.into()) };
    let next = rows.iter().map(|r| math_round(r.0 - today)).filter(|d| *d >= 0.0).reduce(f64::min);
    let columns = vec![
        column("Date", FrameColType::Date, rows.iter().map(|r| FrameCell::Num(r.0)).collect()),
        column("Name", FrameColType::String, rows.iter().map(|r| text(r.1)).collect()),
        column("Local", FrameColType::String, rows.iter().map(|r| text(r.2)).collect()),
    ];
    (FrameValue { columns }, next.map_or(V::Null, V::Num))
}

/// Frankfurter's latest rate of `to`: its as-of date as text ("" when absent), that date as a serial (NaN when
/// absent) and the rate (null when absent).
pub fn fx_rate(text: &str, to: &str) -> (String, f64, V) {
    let root = body(text);
    let date = root["date"].as_str().unwrap_or("").to_string();
    let serial = if date.is_empty() { f64::NAN } else { date_serial(&date) };
    let rate = root["rates"][js_trim(to).to_uppercase()].as_f64().map_or(V::Null, V::Num);
    (date, serial, rate)
}

/// Frankfurter's rates of `to` over a range: a Date and a Rate column, by date; a day with no rate gives no row.
pub fn fx_series(text: &str, to: &str) -> FrameValue {
    let root = body(text);
    let sym = js_trim(to).to_uppercase();
    let mut pts: Vec<(f64, f64)> = match &root["rates"] {
        Json::Object(days) => {
            days.iter().filter_map(|(date, day)| Some((date_serial(date), day[&sym].as_f64()?))).collect()
        }
        Json::Array(days) => days
            .iter()
            .enumerate()
            .filter_map(|(i, day)| Some((date_serial(&i.to_string()), day[&sym].as_f64()?)))
            .collect(),
        _ => Vec::new(),
    };
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    FrameValue {
        columns: vec![
            column("Date", FrameColType::Date, pts.iter().map(|p| FrameCell::Num(p.0)).collect()),
            column("Rate", FrameColType::Number, pts.iter().map(|p| FrameCell::Num(p.1)).collect()),
        ],
    }
}

/// Open-Meteo's place matches, best first as the API ranks them: each one's "City, Region, Country" label, latitude,
/// longitude and IANA time zone ("" when absent). A match without coordinates is dropped.
pub fn geocode(text: &str) -> Vec<(String, f64, f64, String)> {
    let root = body(text);
    let text_of = |v: &Json| v.as_str().unwrap_or("").to_string();
    root["results"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|o| {
            let (lat, lon) = (o["latitude"].as_f64()?, o["longitude"].as_f64()?);
            let parts: Vec<String> =
                [&o["name"], &o["admin1"], &o["country"]].into_iter().map(text_of).filter(|s| !s.is_empty()).collect();
            let label = if parts.is_empty() { "(unknown place)".to_string() } else { parts.join(", ") };
            Some((label, lat, lon, text_of(&o["timezone"])))
        })
        .collect()
}
