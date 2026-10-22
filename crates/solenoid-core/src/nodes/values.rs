//! [[D102]] graphOnCore. The values only cards hand each other, on the wire `nodeWire.ts` speaks: a frame, a cube, and plain data (a chart,
//! a document, an image) carried whole as JSON whose special numbers and errors are tagged.

use crate::frame::FrameColType;
use crate::excel_functions::V;
use serde_json::Value as Json;
use std::rc::Rc;

/// `FrameColumn`: its cells as values, its unit, format and typed text as the TS holds them.
#[derive(Clone, Debug)]
pub struct Column {
    pub name: String,
    pub ty: FrameColType,
    pub values: Vec<V>,
    pub unit: Option<Json>,
    pub format: Option<Json>,
    pub raw: Option<Json>,
}

/// `FrameValue`, with Sketch's row total and sampling factor where it carries them.
#[derive(Clone, Debug, Default)]
pub struct Frame {
    pub columns: Vec<Column>,
    pub total_rows: Option<f64>,
    pub approx: Option<Json>,
}

/// `CubeColumn`: cells of any shape, a frame or a cube among them.
#[derive(Clone, Debug)]
pub struct CubeColumn {
    pub name: String,
    pub cells: Vec<V>,
    pub ty: Option<FrameColType>,
    pub format: Option<Json>,
}

#[derive(Clone, Debug, Default)]
pub struct Cube {
    pub columns: Vec<CubeColumn>,
}

/// A wire value: a frame, a cube or plain data, or anything `decode_value` reads.
pub fn decode(j: &Json) -> V {
    match j {
        Json::Array(items) => super::list(items.iter().map(decode).collect()),
        Json::Object(o) if o.contains_key("__frame") => {
            let f = &o["__frame"];
            let columns = f.get("columns").and_then(Json::as_array).map(|cs| cs.iter().map(column).collect()).unwrap_or_default();
            V::Frame(Rc::new(Frame { columns, total_rows: f.get("totalRows").and_then(Json::as_f64), approx: f.get("approx").cloned() }))
        }
        Json::Object(o) if o.contains_key("__cube") => {
            let columns = o["__cube"]
                .get("columns")
                .and_then(Json::as_array)
                .map(|cs| {
                    cs.iter()
                        .map(|c| CubeColumn {
                            name: c.get("name").and_then(Json::as_str).unwrap_or("").to_string(),
                            cells: c.get("cells").and_then(Json::as_array).map(|a| a.iter().map(decode).collect()).unwrap_or_default(),
                            ty: c.get("type").and_then(Json::as_str).and_then(|t| t.parse().ok()),
                            format: c.get("format").cloned(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            V::Cube(Rc::new(Cube { columns }))
        }
        Json::Object(o) if o.contains_key("__json") => V::Json(Rc::new(o["__json"].clone())),
        // A table with its unit: the unit is the call's (`Call::matrix_unit`), the cells the value.
        Json::Object(o) if o.contains_key("__munit") => decode(&o["m"]),
        _ => crate::eval::decode_value(j),
    }
}

fn column(c: &Json) -> Column {
    Column {
        name: c.get("name").and_then(Json::as_str).unwrap_or("").to_string(),
        // The wire carries frame.ts's tags; a column without one is a number column, as `frameCol` makes it.
        ty: c.get("type").and_then(Json::as_str).and_then(|t| t.parse().ok()).unwrap_or(FrameColType::Number),
        values: c.get("values").and_then(Json::as_array).map(|a| a.iter().map(decode).collect()).unwrap_or_default(),
        unit: c.get("unit").cloned(),
        format: c.get("format").cloned(),
        raw: c.get("raw").cloned(),
    }
}

/// A frame's or a cube's cell: a finite number other than -0 as a bare JSON number, which reads back exact (ryu's
/// shortest form), text and logicals bare too, so a big frame's reply stays small and the TS takes its cells as they
/// parse; the rest as `Out` writes it.
struct Cell<'a>(&'a V);

impl serde::Serialize for Cell<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            V::Num(n) if n.is_finite() && !(*n == 0.0 && n.is_sign_negative()) => s.serialize_f64(*n),
            V::Str(t) => s.serialize_str(t),
            V::Bool(b) => s.serialize_bool(*b),
            v => crate::frame_backend::Out(v).serialize(s),
        }
    }
}

/// A frame's or a cube's reply, as `Out` writes the rest: `{"frame": {...}}`, `{"cube": {...}}`, `{"json": ...}`.
pub fn serialize_frame<S: serde::Serializer>(f: &Frame, s: S) -> Result<S::Ok, S::Error> {
    
    use serde::ser::SerializeMap;
    struct Cells<'a>(&'a [V]);
    impl serde::Serialize for Cells<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            use serde::ser::SerializeSeq;
            let mut q = s.serialize_seq(Some(self.0.len()))?;
            for v in self.0 {
                q.serialize_element(&Cell(v))?;
            }
            q.end()
        }
    }
    struct Col<'a>(&'a Column);
    impl serde::Serialize for Col<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let c = self.0;
            let mut m = s.serialize_map(None)?;
            m.serialize_entry("name", &c.name)?;
            m.serialize_entry("type", &c.ty)?;
            m.serialize_entry("values", &Cells(&c.values))?;
            if let Some(u) = &c.unit {
                m.serialize_entry("unit", u)?;
            }
            if let Some(f) = &c.format {
                m.serialize_entry("format", f)?;
            }
            if let Some(r) = &c.raw {
                m.serialize_entry("raw", r)?;
            }
            m.end()
        }
    }
    struct Body<'a>(&'a Frame);
    impl serde::Serialize for Body<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            use serde::ser::SerializeSeq;
            struct Cols<'a>(&'a [Column]);
            impl serde::Serialize for Cols<'_> {
                fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                    let mut q = s.serialize_seq(Some(self.0.len()))?;
                    for c in self.0 {
                        q.serialize_element(&Col(c))?;
                    }
                    q.end()
                }
            }
            let mut m = s.serialize_map(None)?;
            m.serialize_entry("columns", &Cols(&self.0.columns))?;
            if let Some(t) = self.0.total_rows {
                m.serialize_entry("totalRows", &t)?;
            }
            if let Some(a) = &self.0.approx {
                m.serialize_entry("approx", a)?;
            }
            m.end()
        }
    }
    let mut m = s.serialize_map(Some(1))?;
    m.serialize_entry("frame", &Body(f))?;
    m.end()
}

pub fn serialize_cube<S: serde::Serializer>(c: &Cube, s: S) -> Result<S::Ok, S::Error> {
    
    use serde::ser::{SerializeMap, SerializeSeq};
    struct Cells<'a>(&'a [V]);
    impl serde::Serialize for Cells<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let mut q = s.serialize_seq(Some(self.0.len()))?;
            for v in self.0 {
                q.serialize_element(&Cell(v))?;
            }
            q.end()
        }
    }
    struct Col<'a>(&'a CubeColumn);
    impl serde::Serialize for Col<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let c = self.0;
            let mut m = s.serialize_map(None)?;
            m.serialize_entry("name", &c.name)?;
            m.serialize_entry("cells", &Cells(&c.cells))?;
            if let Some(t) = &c.ty {
                m.serialize_entry("type", t)?;
            }
            if let Some(f) = &c.format {
                m.serialize_entry("format", f)?;
            }
            m.end()
        }
    }
    struct Cols<'a>(&'a [CubeColumn]);
    impl serde::Serialize for Cols<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let mut q = s.serialize_seq(Some(self.0.len()))?;
            for c in self.0 {
                q.serialize_element(&Col(c))?;
            }
            q.end()
        }
    }
    struct Body<'a>(&'a [CubeColumn]);
    impl serde::Serialize for Body<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let mut m = s.serialize_map(Some(1))?;
            m.serialize_entry("columns", &Cols(self.0))?;
            m.end()
        }
    }
    let mut m = s.serialize_map(Some(1))?;
    m.serialize_entry("cube", &Body(&c.columns))?;
    m.end()
}
