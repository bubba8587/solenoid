//! [[C130]] rustCore. The values only cards hand each other, on the wire `nodeWire.ts` speaks: a frame, a cube, and plain data (a chart,
//! a document, an image) carried whole as JSON whose special numbers and errors are tagged.

use crate::excel_functions::V;
use crate::frame::FrameColType;
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

/// A value on a card's wire: a formula's value, or what only cards hand each other, which never enters a formula
/// ([[C15]] matricesInFormulas).
#[derive(Clone, Debug)]
pub enum Cv {
    V(V),
    Frame(Rc<Frame>),
    Cube(Rc<Cube>),
    /// Plain data a card makes or reads whole: a chart, a document, an image, as `nodeWire.ts` encodes it.
    Json(Rc<Json>),
    /// A Cube cell's list with a Frame or a Cube among its items; a list of values is a `V::List`.
    Cells(Rc<Vec<Cv>>),
}

impl From<V> for Cv {
    fn from(v: V) -> Cv {
        Cv::V(v)
    }
}

impl Cv {
    pub const NULL: Cv = Cv::V(V::Null);
    pub const UNDEF: Cv = Cv::V(V::Undef);

    /// A list: a `V::List` when every item is a value, else the cells as they are.
    pub fn list(items: Vec<Cv>) -> Cv {
        if items.iter().all(|c| matches!(c, Cv::V(_))) {
            Cv::V(super::list(items.into_iter().map(|c| if let Cv::V(v) = c { v } else { unreachable!() }).collect()))
        } else {
            Cv::Cells(Rc::new(items))
        }
    }

    /// The formula value, where it is one.
    pub fn v(&self) -> Option<&V> {
        if let Cv::V(v) = self {
            Some(v)
        } else {
            None
        }
    }

    pub fn frame(&self) -> Option<&Rc<Frame>> {
        if let Cv::Frame(f) = self {
            Some(f)
        } else {
            None
        }
    }

    pub fn cube(&self) -> Option<&Rc<Cube>> {
        if let Cv::Cube(c) = self {
            Some(c)
        } else {
            None
        }
    }

    pub fn json(&self) -> Option<&Rc<Json>> {
        if let Cv::Json(j) = self {
            Some(j)
        } else {
            None
        }
    }

    pub fn is_sol_error(&self) -> bool {
        matches!(self, Cv::V(V::Err(_)))
    }

    /// Blank: null or undefined.
    pub fn is_nullish(&self) -> bool {
        matches!(self, Cv::V(V::Null | V::Undef))
    }

    /// The same object, as JS's `===` reads two objects: a list, a LAMBDA, a frame, a cube, plain data, by allocation.
    pub fn same(&self, other: &Cv) -> bool {
        match (self, other) {
            (Cv::V(V::List(a)), Cv::V(V::List(b))) => Rc::ptr_eq(a, b),
            (Cv::V(V::Lambda(a)), Cv::V(V::Lambda(b))) => Rc::ptr_eq(a, b),
            (Cv::Frame(a), Cv::Frame(b)) => Rc::ptr_eq(a, b),
            (Cv::Cube(a), Cv::Cube(b)) => Rc::ptr_eq(a, b),
            (Cv::Json(a), Cv::Json(b)) => Rc::ptr_eq(a, b),
            (Cv::Cells(a), Cv::Cells(b)) => Rc::ptr_eq(a, b),
            _ => false,
        }
    }

    /// A table: a Frame or a Cube.
    pub fn is_table(&self) -> bool {
        matches!(self, Cv::Frame(_) | Cv::Cube(_))
    }
}

/// `CubeColumn`: cells of any shape, a frame or a cube among them.
#[derive(Clone, Debug)]
pub struct CubeColumn {
    pub name: String,
    pub cells: Vec<Cv>,
    pub ty: Option<FrameColType>,
    pub format: Option<Json>,
}

#[derive(Clone, Debug, Default)]
pub struct Cube {
    pub columns: Vec<CubeColumn>,
}

/// A wire value as a card reads it: a frame, a cube or plain data, or anything `decode` reads.
pub fn decode_card(j: &Json) -> Cv {
    match j {
        Json::Object(o) if o.contains_key("__staged") => {
            o["__staged"].as_u64().and_then(super::columnar::take_in).unwrap_or(Cv::UNDEF)
        }
        Json::Array(items) => Cv::list(items.iter().map(decode_card).collect()),
        Json::Object(o) if o.contains_key("__frame") => {
            let f = &o["__frame"];
            let columns =
                f.get("columns").and_then(Json::as_array).map(|cs| cs.iter().map(column).collect()).unwrap_or_default();
            Cv::Frame(Rc::new(Frame {
                columns,
                total_rows: f.get("totalRows").and_then(Json::as_f64),
                approx: f.get("approx").cloned(),
            }))
        }
        Json::Object(o) if o.contains_key("__cube") => {
            let columns = o["__cube"]
                .get("columns")
                .and_then(Json::as_array)
                .map(|cs| {
                    cs.iter()
                        .map(|c| CubeColumn {
                            name: c.get("name").and_then(Json::as_str).unwrap_or("").to_string(),
                            cells: c
                                .get("cells")
                                .and_then(Json::as_array)
                                .map(|a| a.iter().map(decode_card).collect())
                                .unwrap_or_default(),
                            ty: c.get("type").and_then(Json::as_str).and_then(|t| t.parse().ok()),
                            format: c.get("format").cloned(),
                        })
                        .collect()
                })
                .unwrap_or_default();
            Cv::Cube(Rc::new(Cube { columns }))
        }
        Json::Object(o) if o.contains_key("__json") => Cv::Json(Rc::new(o["__json"].clone())),
        // A table with its unit: the unit is the call's (`Call::matrix_unit`), the cells the value.
        Json::Object(o) if o.contains_key("__munit") => decode_card(o.get("m").unwrap_or(&Json::Null)),
        _ => Cv::V(crate::eval::decode_value(j)),
    }
}

/// A wire value as a formula reads it: a literal, a frame's cell, a list's items.
pub fn decode(j: &Json) -> V {
    match j {
        Json::Array(items) => super::list(items.iter().map(decode).collect()),
        Json::Object(o) if o.contains_key("__munit") => decode(o.get("m").unwrap_or(&Json::Null)),
        _ => crate::eval::decode_value(j),
    }
}

fn column(c: &Json) -> Column {
    Column {
        name: c.get("name").and_then(Json::as_str).unwrap_or("").to_string(),
        // A column the wire sends without a type tag is a number column.
        ty: c.get("type").and_then(Json::as_str).and_then(|t| t.parse().ok()).unwrap_or(FrameColType::Number),
        values: c.get("values").and_then(Json::as_array).map(|a| a.iter().map(decode).collect()).unwrap_or_default(),
        unit: c.get("unit").cloned(),
        format: c.get("format").cloned(),
        raw: c.get("raw").cloned(),
    }
}

/// A value in a card's reply: a finite number other than -0 as a bare JSON number, which reads back exact (ryu's
/// shortest form), text and logicals bare too, a list's items the same way, so a big list's or frame's reply stays
/// small and the TS takes its values as they parse; the rest as `Out` writes it.
pub(crate) struct Cell<'a>(pub(crate) &'a V);

impl serde::Serialize for Cell<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::{SerializeMap, SerializeSeq};
        struct Items<'a>(&'a [V]);
        impl serde::Serialize for Items<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut q = s.serialize_seq(Some(self.0.len()))?;
                for v in self.0 {
                    q.serialize_element(&Cell(v))?;
                }
                q.end()
            }
        }
        if let V::List(_) = self.0 {
            if let Some(id) = super::columnar::stage_out(&Cv::V(self.0.clone())) {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("staged", &id)?;
                return m.end();
            }
        }
        match self.0 {
            V::Num(n) if n.is_finite() && !(*n == 0.0 && n.is_sign_negative()) => s.serialize_f64(*n),
            V::Str(t) => s.serialize_str(t),
            V::Bool(b) => s.serialize_bool(*b),
            V::List(items) => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("list", &Items(items))?;
                m.end()
            }
            v => crate::frame_backend::Out(v).serialize(s),
        }
    }
}

/// A card value in a reply: a value as `Cell` writes it, a frame or a cube as `serialize_frame` and `serialize_cube`
/// do, plain data as `{"json": ...}`, a cube cell's list of tables as `{"list": [...]}`; a big frame crosses as buffers
/// (`{"staged": id}`, `nodes::columnar`).
pub struct CvCell<'a>(pub &'a Cv);

impl serde::Serialize for CvCell<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::{SerializeMap, SerializeSeq};
        if let Cv::Frame(_) = self.0 {
            if let Some(id) = super::columnar::stage_out(self.0) {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("staged", &id)?;
                return m.end();
            }
        }
        struct Items<'a>(&'a [Cv]);
        impl serde::Serialize for Items<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut q = s.serialize_seq(Some(self.0.len()))?;
                for v in self.0 {
                    q.serialize_element(&CvCell(v))?;
                }
                q.end()
            }
        }
        match self.0 {
            Cv::V(v) => Cell(v).serialize(s),
            Cv::Frame(f) => serialize_frame(f, s),
            Cv::Cube(c) => serialize_cube(c, s),
            Cv::Json(j) => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("json", j.as_ref())?;
                m.end()
            }
            Cv::Cells(items) => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("list", &Items(items))?;
                m.end()
            }
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
    struct Cells<'a>(&'a [Cv]);
    impl serde::Serialize for Cells<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let mut q = s.serialize_seq(Some(self.0.len()))?;
            for v in self.0 {
                q.serialize_element(&CvCell(v))?;
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

/// A LAMBDA's reply: one with its body's text as `{"lambda": {params, expr, captured, capturedValues, readValues}}`,
/// which `nodeWire.ts` compiles back into a callable LAMBDA, its captures with their units beside the values its body
/// reads; one without (a formula's own LAMBDA, a bare function name) as `{"lambda": true}`, which JS can't take.
pub fn serialize_lambda<S: serde::Serializer>(l: &crate::eval::LambdaV, s: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    struct Cells<'a>(Vec<&'a V>);
    impl serde::Serialize for Cells<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            use serde::ser::SerializeSeq;
            let mut q = s.serialize_seq(Some(self.0.len()))?;
            for v in &self.0 {
                q.serialize_element(&Cell(v))?;
            }
            q.end()
        }
    }
    struct Body<'a>(&'a crate::eval::LambdaV, &'a str, &'a [String]);
    impl serde::Serialize for Body<'_> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let Body(l, src, captured) = *self;
            let read: Vec<&V> = captured.iter().map(|n| l.env.get(n).unwrap_or(&V::Undef)).collect();
            let units: Vec<&V> = (0..captured.len()).map(|i| l.units.get(i).unwrap_or(read[i])).collect();
            let mut m = s.serialize_map(None)?;
            m.serialize_entry("params", &l.params)?;
            m.serialize_entry("expr", src)?;
            m.serialize_entry("captured", captured)?;
            m.serialize_entry("capturedValues", &Cells(units))?;
            m.serialize_entry("readValues", &Cells(read))?;
            if let Some(d) = &l.descriptions {
                m.serialize_entry("descriptions", d.as_ref())?;
            }
            m.end()
        }
    }
    let mut m = s.serialize_map(Some(1))?;
    match (&l.src, &l.captured) {
        (Some(src), Some(captured)) if l.eta.is_none() => m.serialize_entry("lambda", &Body(l, src, captured))?,
        _ => m.serialize_entry("lambda", &true)?,
    }
    m.end()
}
