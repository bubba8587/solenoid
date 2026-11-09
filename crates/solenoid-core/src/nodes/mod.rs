//! [[C130]] rustCore, [[D99]] rustIsSpec.
//! The cards' bodies, each class's `data()`, on the core: one `engine_node` call per body, answering its outputs or its
//! error beside the fields it sets for its component (`tree/specs/computation/node-bodies.md`).

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::V;
use serde_json::{Map, Value as Json};
use std::rc::Rc;

mod backend_verbs;
pub mod columnar;
mod columns;
mod complex;
mod control;
mod cube_source;
mod date;
mod docs;
pub(crate) mod elements;
pub mod fields;
mod finance;
mod formula;
pub mod frames;
pub(crate) mod geometry;
mod kit;
mod lambda;
mod list;
mod logic;
mod matrix;
pub(crate) mod packs;
pub mod qr;
pub mod refs;
mod scalar;
mod sched;
mod stats;
mod text;
pub(crate) mod units;
mod values;
mod verbs;
mod visual;
mod widgets;

pub use docs::{column_unit_parts, tag_fc_unit, TableUnit};
#[cfg(target_arch = "wasm32")]
pub(crate) use frames::core_cell;
#[cfg(target_arch = "wasm32")]
pub(crate) use list::infer_cells;
pub use list::keyed_value;
pub use values::{
    decode, decode_card, serialize_cube, serialize_frame, serialize_lambda, Column, Cube, CubeColumn, Cv, CvCell, Frame,
};
#[cfg(target_arch = "wasm32")]
pub(crate) use visual::region_keys;

/// A field the body leaves on the card for its component: a value (plain data as `Cv::Json`), or `undefined`.
pub enum Shown {
    V(Cv),
    Undef,
}

/// One body call: the card as a save holds it, its sockets, and the inputs it was handed.
/// What a save holds and the sockets are shared, so the graph's calls of a card share one copy (`Call::again`).
pub struct Call {
    /// The card's class (`kind`), which with each input's rung says which field its unwired value lives in.
    pub class: Rc<str>,
    pub init: Rc<Map<String, Json>>,
    /// The saved values of its inputs' fields, read only through those fields (`fields.rs`).
    saved: fields::Saved,
    /// The inputs, in the card's order.
    pub sockets: Rc<[Socket]>,
    /// The inputs as `data()` receives them: a key is there when a cable is, and holds each cable's value.
    pub inputs: Vec<(String, Vec<Cv>)>,
    /// The inputs as a body reading values sees them (`wired`): a table there is `#VALUE!`, since it reaches only a
    /// table or an any socket, whose body reads `inputs` (`wired_card`).
    values: Vec<(String, Vec<V>)>,
    pub display: Vec<(String, Shown)>,
    /// The type an adoptive input took up (`socket.dataType`), where it differs from the declared one, by key. A
    /// run-time fact no save keeps.
    pub adopted_in: Rc<[(String, String)]>,
    /// A table's unit (`matrixUnitOf`, a hidden field on the JS array) on an input's first value, by input key.
    pub matrix_units_in: Vec<(String, Json)>,
    /// The unit to put on an output table (`withMatrixUnit`), by output key.
    pub matrix_units_out: Vec<(String, Json)>,
    /// The draws the engine keeps for the card through one recalc generation (graph-core.md § Direct calls); `None`
    /// outside the engine, where every ask draws afresh.
    pub draws: Option<Draws>,
    /// The body's answer read the clock (TODAY or NOW): a kept answer stands for the recalculation only.
    pub volatile: bool,
}

/// A card's draws in one recalc generation: its uniform rolls, and the text it drew (UUID).
#[derive(Clone, Debug, Default)]
pub struct Draws {
    pub rolls: Vec<f64>,
    pub text: Option<String>,
}

impl Draws {
    pub fn is_empty(&self) -> bool {
        self.rolls.is_empty() && self.text.is_none()
    }
}

/// An input socket: its key, its declared type (`declaredTypeOf`) and its label.
pub struct Socket {
    pub key: String,
    pub ty: Option<String>,
    pub label: String,
}

/// The inputs' values: a table, which reaches only a table or an any socket, is `#VALUE!` here.
fn values_of(inputs: &[(String, Vec<Cv>)], sockets: &[Socket]) -> Vec<(String, Vec<V>)> {
    inputs
        .iter()
        .map(|(key, cvs)| {
            let vs = cvs
                .iter()
                .map(|c| match c {
                    Cv::V(v) => v.clone(),
                    _ => {
                        let label = sockets.iter().find(|s| &s.key == key).map_or(key.as_str(), |s| s.label.as_str());
                        err(ErrorCode::Value, format!("{label} takes a value or a list, not a table"))
                    }
                })
                .collect();
            (key.clone(), vs)
        })
        .collect()
}

/// What a body answers: its outputs in order, or the error it throws (the error guard makes it every output's).
pub type Answer = Result<Vec<(String, Cv)>, V>;

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
        let sockets: Rc<[Socket]> = rows("sockets")
            .iter()
            .map(|r| {
                let key = text(r, 0).unwrap_or_default();
                let label = text(r, 2).unwrap_or_else(|| key.clone());
                Socket { key, ty: text(r, 1), label }
            })
            .collect();
        let adopted_in: Vec<(String, String)> =
            rows("sockets").iter().filter_map(|r| Some((text(r, 0)?, text(r, 3)?))).collect();
        let mut matrix_units_in = Vec::new();
        let inputs: Vec<(String, Vec<Cv>)> = rows("inputs")
            .iter()
            .map(|r| {
                let key = text(r, 0).unwrap_or_default();
                let values: Vec<Cv> =
                    r.get(1).and_then(Json::as_array).map(|a| a.iter().map(decode_card).collect()).unwrap_or_default();
                if let Some(u) = r.get(1).and_then(|a| a.get(0)).and_then(|v| v.get("__munit")) {
                    matrix_units_in.push((key.clone(), u.clone()));
                }
                (key, values)
            })
            .collect();
        let values = values_of(&inputs, &sockets);
        Call {
            class: j.get("kind").and_then(Json::as_str).unwrap_or("").into(),
            init: Rc::new(obj("init")),
            saved: fields::Saved::new(obj("literals"), obj("stringLiterals")),
            sockets,
            inputs,
            values,
            display: Vec::new(),
            adopted_in: adopted_in.into(),
            matrix_units_in,
            matrix_units_out: Vec::new(),
            draws: None,
            volatile: false,
        }
    }

    /// The same card called again on `inputs`: what a save holds and the sockets shared, nothing shown yet.
    pub fn again(&self, inputs: Vec<(String, Vec<Cv>)>, matrix_units_in: Vec<(String, Json)>) -> Call {
        Call {
            class: self.class.clone(),
            init: self.init.clone(),
            saved: self.saved.clone(),
            sockets: self.sockets.clone(),
            values: values_of(&inputs, &self.sockets),
            inputs,
            display: Vec::new(),
            adopted_in: self.adopted_in.clone(),
            matrix_units_in,
            matrix_units_out: Vec::new(),
            draws: None,
            volatile: false,
        }
    }

    /// `n` uniform rolls in [0, 1): the ones the engine holds for this generation, extended where it holds fewer, or
    /// with `redraw` all of them anew where it holds a different count. The roll a call's `init` carries under `given`
    /// (a frozen call: a number, or a list of them) comes first, padded with fresh rolls to `n`.
    pub fn rolls(&mut self, given: &str, n: usize, redraw: bool) -> Vec<f64> {
        let fresh = |k: usize| (0..k).map(|_| crate::fns_random::random()).collect::<Vec<f64>>();
        if let Some(g) = self.init.get(given) {
            let mut held: Vec<f64> = match g {
                Json::Array(a) => a.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect(),
                x => vec![x.as_f64().unwrap_or(f64::NAN)],
            };
            if held.len() < n {
                held.extend(fresh(n - held.len()));
            }
            held.truncate(n);
            return held;
        }
        match &mut self.draws {
            None => fresh(n),
            Some(d) => {
                if redraw && d.rolls.len() != n {
                    d.rolls.clear();
                }
                if d.rolls.len() < n {
                    let more = fresh(n - d.rolls.len());
                    d.rolls.extend(more);
                }
                d.rolls[..n].to_vec()
            }
        }
    }

    /// Drawn text: the one the engine holds for this generation, else `draw`'s, which it then holds. The text a
    /// frozen call's `init` carries under `given` comes first.
    pub fn drawn_text(&mut self, given: &str, draw: impl FnOnce() -> String) -> String {
        if let Some(Json::String(s)) = self.init.get(given) {
            return s.clone();
        }
        match &mut self.draws {
            None => draw(),
            Some(d) => d.text.get_or_insert_with(draw).clone(),
        }
    }

    /// `inputs[key]`: the cables' values, or `None` with no cable.
    pub fn wired(&self, key: &str) -> Option<&[V]> {
        self.values.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_slice())
    }

    /// `inputs[key]` as a card reads it, a Frame, a Cube or plain data among the values.
    pub fn wired_card(&self, key: &str) -> Option<&[Cv]> {
        self.inputs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_slice())
    }

    /// Replaces the inputs a body reads as values (a body that rereads its own inputs, `finance`'s money codes).
    pub fn set_values(&mut self, values: Vec<(String, Vec<V>)>) {
        self.inputs = values.iter().map(|(k, vs)| (k.clone(), vs.iter().cloned().map(Cv::V).collect())).collect();
        self.values = values;
    }

    pub fn take_values(&mut self) -> Vec<(String, Vec<V>)> {
        std::mem::take(&mut self.values)
    }

    /// Unwired, the typed literal; wired, the first cable's value, a blank as null. A table reaches only a table or
    /// an any socket, which `read_card` reads; here it is `#VALUE!`.
    pub fn read_input(&self, key: &str, literal: V) -> V {
        match self.wired(key) {
            None | Some([]) => literal,
            Some([first, ..]) => match first {
                V::Undef => V::Null,
                v => v.clone(),
            },
        }
    }

    /// A card value where a body reads a value: itself, a table `#VALUE!` (a table reaches only a table or an any
    /// socket, whose body reads it with `read_card`).
    pub fn value_of(&self, key: &str, v: &Cv) -> V {
        match v {
            Cv::V(v) => v.clone(),
            _ => err(ErrorCode::Value, format!("{} takes a value or a list, not a table", self.label(key))),
        }
    }

    /// `inputs[key]?.[0]` as a card reads it: `undefined` with no cable or an empty one.
    pub fn raw_card(&self, key: &str) -> Cv {
        self.wired_card(key).and_then(|w| w.first()).cloned().unwrap_or(Cv::UNDEF)
    }

    /// The first cable's value as a card reads it, a Frame, a Cube or plain data among them; null with no cable, a
    /// blank as null.
    pub fn read_card(&self, key: &str) -> Cv {
        match self.wired_card(key) {
            Some([Cv::V(V::Undef), ..]) | None | Some([]) => Cv::NULL,
            Some([first, ..]) => first.clone(),
        }
    }

    /// The declared rung of input `key`, `""` where it has none.
    fn rung(&self, key: &str) -> &str {
        self.sockets.iter().find(|s| s.key == key).and_then(|s| s.ty.as_deref()).unwrap_or("")
    }

    /// The kind a wildcard slot's toggle shows (`literalKinds`): number, string, date or logical, Number when unset.
    pub fn keyed_kind(&self, key: &str) -> &str {
        self.init.get("literalKinds").and_then(|m| m.get(key)).and_then(Json::as_str).unwrap_or("number")
    }

    /// Unwired, its field's value; wired, the first cable's value, a blank as null (`read_input`).
    pub fn read(&self, key: &str) -> V {
        self.read_input(key, self.unwired(key))
    }

    /// A formula variable (Formula card, LAMBDA, a computed column's side variables): unwired and empty, 0. The
    /// variables are their own kind of nothing, not yet walked (`docs/p7-walk.md` § Notation).
    pub fn read_variable(&self, key: &str) -> V {
        let lit = match self.unwired(key) {
            V::Undef | V::Null => V::Num(0.0),
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

    pub fn matrix_unit(&self, key: &str) -> Option<&Json> {
        self.matrix_units_in.iter().find(|(k, _)| k == key).map(|(_, u)| u)
    }

    pub fn set_matrix_unit(&mut self, key: &str, unit: Json) {
        self.matrix_units_out.push((key.to_string(), unit));
    }

    /// Sets a field the card's component reads; showing a field again replaces it, as the card reads only the last.
    pub fn show(&mut self, field: &str, v: impl Into<Cv>) {
        let v = Shown::V(v.into());
        match self.display.iter_mut().find(|(f, _)| f == field) {
            Some(slot) => slot.1 = v,
            None => self.display.push((field.to_string(), v)),
        }
    }

    /// The kind these inputs' values bring beside a date, where combining them would put dates and another kind in
    /// one value: a step that does refuses rather than hand on a mix ([[C137]] datesNeverSerials). Read off the values,
    /// wired or typed in.
    pub fn mixes_dates(&self, keys: &[&str]) -> Option<&'static str> {
        keys.iter()
            .map(|k| {
                let v = match self.wired(k) {
                    Some([first, ..]) => first.clone(),
                    _ => self.unwired(k),
                };
                crate::date_values::census(&v)
            })
            .fold(crate::value_kinds::Census::default(), crate::value_kinds::Census::join)
            .beside_dates()
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
        .or_else(|| geometry::run(kind, c))
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
    "AddIndexNode",
    "AggregateNode",
    "AlertNode",
    "AllocatorNode",
    "AmortizationNode",
    "AngleDialNode",
    "AntoineNode",
    "AppendNode",
    "ArgMinMaxNode",
    "ArithmeticNode",
    "AwgNode",
    "BaseConvertNode",
    "BesselNode",
    "BetweenNode",
    "BinNode",
    "BindColumnsNode",
    "BinomDistRangeNode",
    "BitwiseNode",
    "BondPricingNode",
    "BooleanOpNode",
    "BoxplotNode",
    "BuildCubeNode",
    "BuildFrameNode",
    "ByAxisNode",
    "CableSwitchNode",
    "CalendarHeatmapNode",
    "CandlestickNode",
    "CardsNode",
    "CastNode",
    "CharCodeNode",
    "ChartBuilderNode",
    "ChartNode",
    "ChoiceLadderNode",
    "ChooseNode",
    "CircleSolverNode",
    "ClampNode",
    "ColebrookNode",
    "ColorBlendNode",
    "ColorPickerNode",
    "ColumnsNode",
    "CombinationsNode",
    "CombinatoricsNode",
    "ComparisonNode",
    "ComplexBinaryNode",
    "ComplexFromNode",
    "ComplexPowerNode",
    "ComplexUnaryNode",
    "ComplexUnpackNode",
    "ComputedColumnNode",
    "ConcatListsNode",
    "ConcatNode",
    "ConditionalRegionsNode",
    "ConfidenceNode",
    "ConnectedRegionsNode",
    "ConstantNode",
    "ContainsNode",
    "ConvertNode",
    "ConvolveNode",
    "CorrMatrixNode",
    "CorrelNode",
    "CouponNode",
    "CrossNode",
    "CubeColumnsNode",
    "CubeInputNode",
    "CubeRollupNode",
    "CurveNode",
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
    "DistinctNode",
    "DistributionsNode",
    "DollarNode",
    "DropBlankRowsNode",
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
    "ExpectNode",
    "ExpressionNode",
    "FillBlanksNode",
    "FillNode",
    "FilterFrameNode",
    "FilterNode",
    "FindPeaksNode",
    "FisherNode",
    "FitDistributionNode",
    "FixedNode",
    "ForecastNode",
    "FormatControllerNode",
    "FormatDollarNode",
    "FrameFromListsNode",
    "FrameInputNode",
    "FrequencyNode",
    "FuzzyMatchNode",
    "FvScheduleNode",
    "GCDNode",
    "GanttNode",
    "GaugeNode",
    "GetColumnNode",
    "GetRowNode",
    "GridPainterNode",
    "GroupByFrameNode",
    "GroupListsNode",
    "HashNode",
    "HeadNode",
    "HeadersNode",
    "HeatmapNode",
    "HistogramNode",
    "HrZonesNode",
    "HypothesisTestNode",
    "IFErrorNode",
    "IRRNode",
    "IfNode",
    "IfsNode",
    "InterleaveNode",
    "InterpolateNode",
    "IsCloseNode",
    "IsEvenOddNode",
    "IsInNode",
    "IsTestNode",
    "IsaAtmosphereNode",
    "IspmtNode",
    "JoinNode",
    "KMeansNode",
    "KpiNode",
    "LambdaNode",
    "LinestNode",
    "ListIndexNode",
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
    "MergeColumnsNode",
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
    "PivotNode",
    "PointPlotterNode",
    "PolyRootsNode",
    "PolyfitNode",
    "PolygonPointsNode",
    "ProbNode",
    "PromoNode",
    "ProportionNode",
    "QrCodeNode",
    "QuadraticRootsNode",
    "QuiverNode",
    "RandArrayNode",
    "RandBetweenNode",
    "RankPercentileNode",
    "ReconcileNode",
    "ReduceLambdaNode",
    "RegexNode",
    "RegularPolygonNode",
    "RenameNode",
    "ReplaceValuesNode",
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
    "SettleNode",
    "ShiftNode",
    "ShuffleNode",
    "SliceNode",
    "SlicerNode",
    "SliderInputNode",
    "SmoothNode",
    "SolarPositionNode",
    "SolidNode",
    "SortFrameNode",
    "SortNode",
    "SparklineNode",
    "SpectrumNode",
    "SpellNumberNode",
    "SplitColumnNode",
    "SplitFrameNode",
    "StackNode",
    "StandardizeNode",
    "SubstituteNode",
    "SumIfsNode",
    "SumProductNode",
    "SunriseSunsetNode",
    "SurfaceNode",
    "SwitchNode",
    "TableDiagNode",
    "TableInfoNode",
    "TableInputNode",
    "TableMultNode",
    "TableOuterNode",
    "TableReshapeNode",
    "TableSelectNode",
    "TableTransposeNode",
    "TableUnitNode",
    "TakeDropNode",
    "TallyNode",
    "TemplateNode",
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
    "TwoPointsNode",
    "UniqueNode",
    "UnitCircleNode",
    "UnnestNode",
    "UnpivotNode",
    "UrlEncodeNode",
    "UuidNode",
    "ValueInputNode",
    "WaterfallNode",
    "WeekInfoNode",
    "WeightedNode",
    "WindowNode",
    "WorkdaysNode",
    "WorldClockNode",
    "WrapTextNode",
    "XLookupNode",
    "XMatchNode",
    "XYPadNode",
];

pub fn is_direct(kind: &str) -> bool {
    DIRECT.binary_search(&kind).is_ok()
}

/// Direct classes whose answer, over the same call, the same inputs and the same sketch mode, is the one they gave
/// last, kept so it stays the same object: a frame they build would otherwise be a new one each full pass, read into
/// the frame verbs again (`refs::planned` keys a frame by identity), a ref would run its plan again, and a LAMBDA's
/// consumers memo on its identity. A body that reads the clock or draws keeps no answer, so this is a list; a class
/// naming `coreFields` keeps it only while they read the same (Computed Column's TODAY/NOW stamp).
/// One whose answer this call read the clock for (`Call::volatile`, a Frame or Cube Input text calling TODAY) keeps it
/// for the recalculation only.
pub const KEEPS_ANSWER: &[&str] = &[
    "AddIndexNode",
    "AppendNode",
    "BindColumnsNode",
    "BuildFrameNode",
    "ColumnsNode",
    "ComputedColumnNode",
    "CubeInputNode",
    "DistinctNode",
    "DropBlankRowsNode",
    "FillBlanksNode",
    "FilterFrameNode",
    "FrameFromListsNode",
    "FrameInputNode",
    "GetColumnNode",
    "GroupByFrameNode",
    "HeadNode",
    "JoinNode",
    "LambdaNode",
    "MergeColumnsNode",
    "PivotNode",
    "RenameNode",
    "ReplaceValuesNode",
    "SlicerNode",
    "SortFrameNode",
    "SplitColumnNode",
    "SumIfsNode",
    "TableInfoNode",
    "UnpivotNode",
    "WindowNode",
];

pub fn keeps_answer(kind: &str) -> bool {
    KEEPS_ANSWER.binary_search(&kind).is_ok()
}

/// Whether text on the input `key` of a `kind` card on `op` reaches its body, which answers it as its formula does
/// ([[C17]] shareImpl, [[D109]] aggregatesRefuseText, [[D110]] logicRefusesText). Elsewhere text on a number or
/// logical port is the port's `#TYPE!`; empty text here reads as a blank.
pub fn reads_text(kind: &str, op: &str, key: &str) -> bool {
    match kind {
        "AggregateNode" => key == "list" && list::aggregate_formula(if op.is_empty() { "sum" } else { op }).is_some(),
        "RankPercentileNode" => {
            key == "list"
                && matches!(
                    if op.is_empty() { "large" } else { op },
                    "large" | "small" | "percentile-inc" | "percentile-exc" | "quartile-inc" | "quartile-exc"
                )
        }
        "GroupListsNode" => key == "values",
        "BooleanOpNode" => key.starts_with('a'),
        _ => false,
    }
}

/// Direct classes that hand on in TypeScript a value the core can't hold (a LAMBDA, an object the card wire doesn't
/// carry): their `data()` runs instead of the body when this input holds one.
pub const OFF_CORE: &[(&str, &str)] = &[("DisplayNode", "in"), ("ExpectNode", "in"), ("FormatControllerNode", "in")];

pub fn off_core_input(kind: &str) -> Option<&'static str> {
    OFF_CORE.iter().find(|(k, _)| *k == kind).map(|(_, input)| *input)
}

/// A value as a card's reply carries it (`values::Cell`), the JSON `readNodeReply` reads.
pub fn reply_json(v: &Cv) -> String {
    serde_json::to_string(&CvCell(v)).expect("a value serializes")
}

/// `engine_node`'s reply: `{"out": {key: value}, "display": {...}}`, `{"thrown": value, "display": ...}`, or
/// `{"none": true}` for a class with no body on the core.
pub struct NodeReply {
    pub answer: Option<Answer>,
    /// The call's inputs, so an output that is one of them can say so.
    pub inputs: Vec<(String, Vec<Cv>)>,
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
            let Some((_, out @ Cv::V(V::List(_)))) = outs.iter().find(|(k, _)| k == key) else { continue };
            for (field, v) in &c.display {
                if matches!(v, Shown::V(l) if l.same(out)) {
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
        use values::CvCell;
        // An output that is one of the inputs as it came (a frame, a lazy one or a LAMBDA passed through) crosses as where
        // it came from, so the TS hands back that very object: a consumer keys a frame and a LAMBDA by identity.
        struct Outs<'a>(&'a [(String, Cv)], &'a [(String, Vec<Cv>)]);
        impl serde::Serialize for Outs<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut m = s.serialize_map(Some(self.0.len()))?;
                for (k, v) in self.0 {
                    let from = match v {
                        Cv::Json(_) | Cv::Ref(_) | Cv::Frame(_) | Cv::Cube(_) | Cv::V(V::Lambda(_)) => {
                            self.1.iter().find_map(|(key, vs)| vs.iter().position(|x| x.same(v)).map(|at| (key, at)))
                        }
                        _ => None,
                    };
                    match from {
                        Some((key, at)) => m.serialize_entry(k, &serde_json::json!({ "input": [key, at] }))?,
                        None => m.serialize_entry(k, &CvCell(v))?,
                    }
                }
                m.end()
            }
        }
        struct Shows<'a>(&'a [(String, Shown)], Option<&'a [(String, Cv)]>);
        impl serde::Serialize for Shows<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                // A field that is an output itself (`cachedResult = frame`) crosses as that output's key, once.
                let same = |v: &Cv| -> Option<&str> {
                    let outs = self.1?;
                    outs.iter().find(|(_, o)| v.same(o)).map(|(k, _)| k.as_str())
                };
                let mut m = s.serialize_map(Some(self.0.len()))?;
                for (k, v) in self.0 {
                    match v {
                        Shown::V(v) if same(v).is_some() => {
                            m.serialize_entry(k, &serde_json::json!({ "output": same(v) }))?
                        }
                        Shown::V(v) => m.serialize_entry(k, &CvCell(v))?,
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
