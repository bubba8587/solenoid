//! [[D102]] graphOnCore, [[D99]] rustIsSpec: the cards' bodies, each class's `data()`, on the core. A card keeps its
//! TypeScript class (its sockets, its saved fields, its component); its body is one `engine_node` call that names the
//! class and carries what a save holds, the socket types and the inputs as arrival coercion left them. The answer is
//! the outputs, or the error the body threw, beside the fields the body sets on the card for its component.
//! `tree/specs/computation/node-bodies.md` is the mechanism; `fixtures/core/nodes/` the answers each body is held to.

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::V;
use serde_json::{Map, Value as Json};
use std::rc::Rc;

mod backend_verbs;
mod columns;
mod complex;
mod control;
mod date;
mod docs;
mod finance;
mod formula;
pub mod frames;
mod kit;
mod lambda;
mod list;
mod logic;
mod matrix;
pub(crate) mod packs;
pub mod qr;
mod scalar;
mod sched;
mod stats;
mod text;
mod units;
mod values;
mod verbs;
mod visual;
mod widgets;

pub use values::{decode, serialize_cube, serialize_frame, serialize_lambda, Column, Cube, CubeColumn, Frame};

/// A field the body leaves on the card for its component: a value (plain data as `V::Json`), or `undefined`.
pub enum Shown {
    V(V),
    Undef,
}

/// One body call: the card as a save holds it, its sockets, and the inputs it was handed.
/// What a save holds and the sockets are shared, so the graph's calls of a card share one copy (`Call::again`).
pub struct Call {
    pub init: Rc<Map<String, Json>>,
    pub literals: Rc<Map<String, Json>>,
    pub string_literals: Rc<Map<String, Json>>,
    /// The inputs, in the card's order.
    pub sockets: Rc<[Socket]>,
    /// The outputs, in the card's order.
    pub outputs: Rc<[Output]>,
    /// The inputs as `data()` receives them: a key is there when a cable is, and holds each cable's value.
    pub inputs: Vec<(String, Vec<V>)>,
    pub display: Vec<(String, Shown)>,
    /// The type an adoptive socket took up (`socket.dataType`), where it differs from the declared one: inputs, then
    /// outputs, by key. A run-time fact no save keeps.
    pub adopted_in: Rc<[(String, String)]>,
    pub adopted_out: Rc<[(String, String)]>,
    /// A table's unit (`matrixUnitOf`, a hidden field on the JS array) on an input's first value, by input key.
    pub matrix_units_in: Vec<(String, Json)>,
    /// The unit to put on an output table (`withMatrixUnit`), by output key.
    pub matrix_units_out: Vec<(String, Json)>,
}

/// An input socket: its key, its declared type (`declaredTypeOf`) and its label.
pub struct Socket {
    pub key: String,
    pub ty: Option<String>,
    pub label: String,
}

/// An output socket: its key and declared type.
pub struct Output {
    pub key: String,
    pub ty: Option<String>,
}

/// What a body answers: its outputs in order, or the error it throws (the error guard makes it every output's).
pub type Answer = Result<Vec<(String, V)>, V>;

pub fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

pub fn err(code: ErrorCode, message: impl Into<String>) -> V {
    V::err(sol_error(code, message))
}

impl Call {
    /// The call as `engine_node` takes it: the sockets, outputs and inputs as lists of pairs, in the card's order.
    pub fn from_json(j: &Json) -> Call {
        let obj = |k: &str| j.get(k).and_then(Json::as_object).cloned().unwrap_or_default();
        let rows = |k: &str| j.get(k).and_then(Json::as_array).map(Vec::as_slice).unwrap_or_default();
        let text = |r: &Json, i: usize| r.get(i).and_then(Json::as_str).map(String::from);
        let sockets = rows("sockets")
            .iter()
            .map(|r| {
                let key = text(r, 0).unwrap_or_default();
                let label = text(r, 2).unwrap_or_else(|| key.clone());
                Socket { key, ty: text(r, 1), label }
            })
            .collect();
        let outputs =
            rows("outputs").iter().map(|r| Output { key: text(r, 0).unwrap_or_default(), ty: text(r, 1) }).collect();
        let adopted = |k: &str, at: usize| -> Vec<(String, String)> {
            rows(k).iter().filter_map(|r| Some((text(r, 0)?, text(r, at)?))).collect()
        };
        let (adopted_in, adopted_out) = (adopted("sockets", 3), adopted("outputs", 2));
        let mut matrix_units_in = Vec::new();
        let inputs = rows("inputs")
            .iter()
            .map(|r| {
                let key = text(r, 0).unwrap_or_default();
                let values: Vec<V> =
                    r.get(1).and_then(Json::as_array).map(|a| a.iter().map(decode).collect()).unwrap_or_default();
                if let Some(u) = r.get(1).and_then(|a| a.get(0)).and_then(|v| v.get("__munit")) {
                    matrix_units_in.push((key.clone(), u.clone()));
                }
                (key, values)
            })
            .collect();
        Call {
            init: Rc::new(obj("init")),
            literals: Rc::new(obj("literals")),
            string_literals: Rc::new(obj("stringLiterals")),
            sockets,
            outputs,
            inputs,
            display: Vec::new(),
            adopted_in: adopted_in.into(),
            adopted_out: adopted_out.into(),
            matrix_units_in,
            matrix_units_out: Vec::new(),
        }
    }

    /// The same card called again on `inputs`: what a save holds and the sockets shared, nothing shown yet.
    pub fn again(&self, inputs: Vec<(String, Vec<V>)>, matrix_units_in: Vec<(String, Json)>) -> Call {
        Call {
            init: self.init.clone(),
            literals: self.literals.clone(),
            string_literals: self.string_literals.clone(),
            sockets: self.sockets.clone(),
            outputs: self.outputs.clone(),
            inputs,
            display: Vec::new(),
            adopted_in: self.adopted_in.clone(),
            adopted_out: self.adopted_out.clone(),
            matrix_units_in,
            matrix_units_out: Vec::new(),
        }
    }

    /// `inputs[key]`: the cables' values, or `None` with no cable.
    pub fn wired(&self, key: &str) -> Option<&[V]> {
        self.inputs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_slice())
    }

    /// Unwired, the typed literal; wired, the first cable's value, a blank as null.
    pub fn read_input(&self, key: &str, literal: V) -> V {
        match self.wired(key) {
            None | Some([]) => literal,
            Some([first, ..]) => match first {
                V::Undef => V::Null,
                v => v.clone(),
            },
        }
    }

    /// The typed literal, `undefined` where it isn't set.
    pub fn literal(&self, key: &str) -> V {
        self.literals.get(key).map(decode).unwrap_or(V::Undef)
    }

    pub fn string_literal(&self, key: &str) -> V {
        self.string_literals.get(key).map(decode).unwrap_or(V::Undef)
    }

    /// Unwired, the typed literal, else `dflt`; wired, the first cable's value.
    pub fn read_num(&self, key: &str, dflt: f64) -> V {
        let lit = match self.literal(key) {
            V::Undef | V::Null => V::Num(dflt),
            v => v,
        };
        self.read_input(key, lit)
    }

    /// A saved field as text (`this.op`), or `dflt` where the save leaves it out.
    pub fn field_str<'a>(&'a self, key: &str, dflt: &'a str) -> &'a str {
        self.init.get(key).and_then(Json::as_str).unwrap_or(dflt)
    }

    pub fn field(&self, key: &str) -> Option<&Json> {
        self.init.get(key)
    }

    pub fn label(&self, key: &str) -> String {
        self.sockets.iter().find(|s| s.key == key).map_or_else(|| key.to_string(), |s| s.label.clone())
    }

    /// The adopted type, else the declared one.
    pub fn input_type(&self, key: &str) -> Option<&str> {
        self.adopted_in
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, t)| t.as_str())
            .or_else(|| self.sockets.iter().find(|s| s.key == key).and_then(|s| s.ty.as_deref()))
    }

    pub fn output_type(&self, key: &str) -> Option<&str> {
        self.adopted_out
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, t)| t.as_str())
            .or_else(|| self.outputs.iter().find(|o| o.key == key).and_then(|o| o.ty.as_deref()))
    }

    pub fn matrix_unit(&self, key: &str) -> Option<&Json> {
        self.matrix_units_in.iter().find(|(k, _)| k == key).map(|(_, u)| u)
    }

    pub fn set_matrix_unit(&mut self, key: &str, unit: Json) {
        self.matrix_units_out.push((key.to_string(), unit));
    }

    pub fn show(&mut self, field: &str, v: V) {
        self.display.push((field.to_string(), Shown::V(v)));
    }

    pub fn show_undef(&mut self, field: &str) {
        self.display.push((field.to_string(), Shown::Undef));
    }
}

/// The class's body, or `None` where the class has none on the core yet.
pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    scalar::run(kind, c)
        .or_else(|| logic::run(kind, c))
        .or_else(|| complex::run(kind, c))
        .or_else(|| control::run(kind, c))
        .or_else(|| text::run(kind, c))
        .or_else(|| date::run(kind, c))
        .or_else(|| stats::run(kind, c))
        .or_else(|| finance::run(kind, c))
        .or_else(|| list::run(kind, c))
        .or_else(|| matrix::run(kind, c))
        .or_else(|| packs::run(kind, c))
        .or_else(|| visual::run(kind, c))
        .or_else(|| widgets::run(kind, c))
        .or_else(|| frames::run(kind, c))
        .or_else(|| formula::run(kind, c))
        .or_else(|| sched::run(kind, c))
        .or_else(|| docs::run(kind, c))
        .or_else(|| verbs::run(kind, c))
        .or_else(|| columns::run(kind, c))
        .or_else(|| backend_verbs::run(kind, c))
        .or_else(|| lambda::run(kind, c))
        .or_else(|| qr::run(kind, c))
}

/// The classes whose `data()` is their body here and nothing else (for `OFF_CORE`, that and handing on what the core
/// can't hold), which the graph calls in Rust with no JavaScript in between (graph-core.md § Direct calls); `directBodies.test.ts` holds the list to the classes' source.
pub const DIRECT: &[&str] = &[
    "AccruedInterestNode",
    "AddColumnNode",
    "AggregateNode",
    "AllocatorNode",
    "AmortizationNode",
    "AngleDialNode",
    "AntoineNode",
    "ArgMinMaxNode",
    "ArithmeticNode",
    "AwgNode",
    "BaseConvertNode",
    "BesselNode",
    "BetweenNode",
    "BinNode",
    "BinomDistRangeNode",
    "BitwiseNode",
    "BondPricingNode",
    "BooleanOpNode",
    "BoxplotNode",
    "BuildCubeNode",
    "ByAxisNode",
    "CableSwitchNode",
    "CalendarHeatmapNode",
    "CandlestickNode",
    "CastNode",
    "CharCodeNode",
    "ChartBuilderNode",
    "ChartNode",
    "ChoiceLadderNode",
    "ChooseNode",
    "ClampNode",
    "ColebrookNode",
    "ColorBlendNode",
    "ColorPickerNode",
    "CombinationsNode",
    "CombinatoricsNode",
    "ComparisonNode",
    "ComplexBinaryNode",
    "ComplexFromNode",
    "ComplexPowerNode",
    "ComplexUnaryNode",
    "ComplexUnpackNode",
    "ConcatListsNode",
    "ConcatNode",
    "ConfidenceNode",
    "ConstantNode",
    "ContainsNode",
    "ConvertNode",
    "ConvolveNode",
    "CorrMatrixNode",
    "CorrelNode",
    "CouponNode",
    "CovarianceNode",
    "CrossNode",
    "CubeColumnsNode",
    "CubeRollupNode",
    "DateAddNode",
    "DateConstructNode",
    "DateDiffNode",
    "DatePartNode",
    "DateRangeNode",
    "DateTimeValueNode",
    "DateTruncNode",
    "DecisionMatrixNode",
    "DecisionSensitivityNode",
    "DecomposeNode",
    "DepreciationNode",
    "DescribeNode",
    "DiffNode",
    "DiscountSecurityNode",
    "DisplayNode",
    "DollarNode",
    "DurationNode",
    "ESeriesNode",
    "EarnedValueNode",
    "ElementNode",
    "EmSpectrumNode",
    "EpochNode",
    "EquationNode",
    "EtsForecastNode",
    "EwmaNode",
    "ExactNode",
    "ExpandNode",
    "ExpressionNode",
    "FillNode",
    "FindPeaksNode",
    "FisherNode",
    "FitDistributionNode",
    "FixedNode",
    "ForecastNode",
    "FormatControllerNode",
    "FormatDollarNode",
    "FrequencyNode",
    "FuzzyMatchNode",
    "FvScheduleNode",
    "GCDNode",
    "GanttNode",
    "GetRowNode",
    "GroupListsNode",
    "HashNode",
    "HeadersNode",
    "HeatmapNode",
    "HrZonesNode",
    "HypothesisTestNode",
    "IFErrorNode",
    "IRRNode",
    "IfNode",
    "IfsNode",
    "InterleaveNode",
    "IsCloseNode",
    "IsEvenOddNode",
    "IsInNode",
    "IsTestNode",
    "IsaAtmosphereNode",
    "IspmtNode",
    "KMeansNode",
    "LinestNode",
    "ListInputNode",
    "ListLengthNode",
    "LogisticNode",
    "MRoundNode",
    "MakeArrayNode",
    "MapTableNode",
    "MatDetNode",
    "MatEigenNode",
    "MatSolveNode",
    "MathFXNode",
    "MergePlotsNode",
    "MermaidNode",
    "MirrNode",
    "ModeNode",
    "MolarMassNode",
    "MoonPhaseNode",
    "MultinomialNode",
    "NPVNode",
    "NaNode",
    "NestJoinNode",
    "NestNode",
    "NormalizeNode",
    "NotNode",
    "NthElementNode",
    "OdeIntegrateNode",
    "OutliersNode",
    "PadNode",
    "PadTextNode",
    "ParallelCombineNode",
    "PaymentBreakdownNode",
    "PayoffPlannerNode",
    "PcaNode",
    "PhysicsConstantNode",
    "PipeRoughnessNode",
    "PointPlotterNode",
    "PolyRootsNode",
    "PolyfitNode",
    "ProbNode",
    "ProportionNode",
    "QrCodeNode",
    "QuadraticRootsNode",
    "QuiverNode",
    "RankPercentileNode",
    "ReconcileNode",
    "ReduceLambdaNode",
    "RegexNode",
    "RegressionNode",
    "ReptNode",
    "ResistorCodeNode",
    "ReturnsNode",
    "ReverseNode",
    "ReverseTextNode",
    "RleNode",
    "RomanArabicNode",
    "RoundNNode",
    "RunningNode",
    "SankeyNode",
    "ScanLambdaNode",
    "ScheduleNode",
    "SeriesNode",
    "SeriesSumNode",
    "SetCellNode",
    "SetsNode",
    "ShiftNode",
    "SliceNode",
    "SliderInputNode",
    "SmoothNode",
    "SolarPositionNode",
    "SortNode",
    "SparklineNode",
    "SpectrumNode",
    "SpellNumberNode",
    "SplitFrameNode",
    "StackNode",
    "StandardizeNode",
    "SubstituteNode",
    "SumProductNode",
    "SunriseSunsetNode",
    "SwitchNode",
    "TableDiagNode",
    "TableInputNode",
    "TableMultNode",
    "TableOuterNode",
    "TableReshapeNode",
    "TableSelectNode",
    "TableTransposeNode",
    "TableUnitNode",
    "TakeDropNode",
    "TallyNode",
    "TextAfterBeforeNode",
    "TextFindNode",
    "TextJoinNode",
    "TextLenNode",
    "TextReplaceNode",
    "TextSimilarityNode",
    "TextSliceNode",
    "TextSplitNode",
    "TextTransformNode",
    "TimeConstructNode",
    "TimeZoneConvertNode",
    "TodayNowNode",
    "TornadoNode",
    "TrapzNode",
    "TriangleSolverNode",
    "TrimMeanNode",
    "TruncateTextNode",
    "TvmNode",
    "TwoInputMathNode",
    "UniqueNode",
    "UnnestNode",
    "UrlEncodeNode",
    "WaterfallNode",
    "WeekInfoNode",
    "WeightedNode",
    "WorkdaysNode",
    "WrapTextNode",
    "XLookupNode",
    "XMatchNode",
    "XYPadNode",
];

pub fn is_direct(kind: &str) -> bool {
    DIRECT.binary_search(&kind).is_ok()
}

/// Direct classes that hand on in TypeScript a value the core can't hold (a LAMBDA, an object the card wire doesn't
/// carry): their `data()` runs instead of the body when this input holds one.
pub const OFF_CORE: &[(&str, &str)] = &[("DisplayNode", "in"), ("FormatControllerNode", "in")];

pub fn off_core_input(kind: &str) -> Option<&'static str> {
    OFF_CORE.iter().find(|(k, _)| *k == kind).map(|(_, input)| *input)
}

/// A value as a card's reply carries it (`values::Cell`), the JSON `readNodeReply` reads.
pub fn reply_json(v: &V) -> String {
    serde_json::to_string(&values::Cell(v)).expect("a value serializes")
}

/// `engine_node`'s reply: `{"out": {key: value}, "display": {...}}`, `{"thrown": value, "display": ...}`, or
/// `{"none": true}` for a class with no body on the core.
pub struct NodeReply {
    pub answer: Option<Answer>,
    /// The call's inputs, so an output that is one of them can say so.
    pub inputs: Vec<(String, Vec<V>)>,
    pub display: Vec<(String, Shown)>,
    pub matrix_units: Vec<(String, Json)>,
}

pub fn reply(args: &Json) -> NodeReply {
    let kind = args.get("kind").and_then(Json::as_str).unwrap_or("");
    let _calc =
        crate::excel_functions::Calc::begin(args.get("clock").and_then(|j| serde_json::from_value(j.clone()).ok()));
    let mut c = Call::from_json(args);
    let answer = run(kind, &mut c);
    // A field the body shows is often the output itself (`cachedResult = result`): it carries the output's unit too.
    let mut matrix_units = c.matrix_units_out;
    if let Some(Ok(outs)) = &answer {
        let mut shown = Vec::new();
        for (key, unit) in &matrix_units {
            let Some((_, V::List(out))) = outs.iter().find(|(k, _)| k == key) else { continue };
            for (field, v) in &c.display {
                if matches!(v, Shown::V(V::List(l)) if Rc::ptr_eq(l, out)) {
                    shown.push((format!("display:{field}"), unit.clone()));
                }
            }
        }
        matrix_units.extend(shown);
    }
    NodeReply { answer, inputs: c.inputs, display: c.display, matrix_units }
}

impl serde::Serialize for NodeReply {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use crate::frame_backend::Out;
        use serde::ser::SerializeMap;
        use values::Cell;
        // An output that is one of the inputs as it came (a frame ref or a LAMBDA passed through) crosses as where it came from,
        // so the TS hands back that very object: plan flushes and collects are memoized by the ref's identity.
        struct Outs<'a>(&'a [(String, V)], &'a [(String, Vec<V>)]);
        impl serde::Serialize for Outs<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut m = s.serialize_map(Some(self.0.len()))?;
                for (k, v) in self.0 {
                    let from = match v {
                        V::Json(j) => self.1.iter().find_map(|(key, vs)| {
                            vs.iter().position(|x| matches!(x, V::Json(i) if Rc::ptr_eq(i, j))).map(|at| (key, at))
                        }),
                        V::Lambda(l) => self.1.iter().find_map(|(key, vs)| {
                            vs.iter().position(|x| matches!(x, V::Lambda(i) if Rc::ptr_eq(i, l))).map(|at| (key, at))
                        }),
                        _ => None,
                    };
                    match from {
                        Some((key, at)) => m.serialize_entry(k, &serde_json::json!({ "input": [key, at] }))?,
                        None => m.serialize_entry(k, &Cell(v))?,
                    }
                }
                m.end()
            }
        }
        struct Shows<'a>(&'a [(String, Shown)], Option<&'a [(String, V)]>);
        impl serde::Serialize for Shows<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                // A field that is an output itself (`cachedResult = frame`) crosses as that output's key, once.
                let same = |v: &V| -> Option<&str> {
                    let outs = self.1?;
                    outs.iter()
                        .find(|(_, o)| match (v, o) {
                            (V::List(a), V::List(b)) => Rc::ptr_eq(a, b),
                            (V::Frame(a), V::Frame(b)) => Rc::ptr_eq(a, b),
                            (V::Cube(a), V::Cube(b)) => Rc::ptr_eq(a, b),
                            (V::Json(a), V::Json(b)) => Rc::ptr_eq(a, b),
                            (V::Lambda(a), V::Lambda(b)) => Rc::ptr_eq(a, b),
                            _ => false,
                        })
                        .map(|(k, _)| k.as_str())
                };
                let mut m = s.serialize_map(Some(self.0.len()))?;
                for (k, v) in self.0 {
                    match v {
                        Shown::V(v) if same(v).is_some() => {
                            m.serialize_entry(k, &serde_json::json!({ "output": same(v) }))?
                        }
                        Shown::V(v) => m.serialize_entry(k, &Cell(v))?,
                        Shown::Undef => m.serialize_entry(k, &serde_json::json!({ "undef": true }))?,
                    }
                }
                m.end()
            }
        }
        let mut m = s.serialize_map(None)?;
        match &self.answer {
            None => m.serialize_entry("none", &true)?,
            Some(Ok(outs)) => m.serialize_entry("out", &Outs(outs, &self.inputs))?,
            Some(Err(e)) => m.serialize_entry("thrown", &Out(e))?,
        }
        let outs = match &self.answer {
            Some(Ok(outs)) => Some(outs.as_slice()),
            _ => None,
        };
        m.serialize_entry("display", &Shows(&self.display, outs))?;
        if !self.matrix_units.is_empty() {
            let units: serde_json::Map<String, Json> = self.matrix_units.iter().cloned().collect();
            m.serialize_entry("matrixUnits", &units)?;
        }
        m.end()
    }
}
