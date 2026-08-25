// Parity tests for the Polars engine against the JS oracle (`frameVerbs.ts`).
// Each test mirrors a verb's documented behavior on a small fixture. Verb fns are
// exercised directly on `SolFrame`; source/preview/column/drop go through the store.
use super::*;

fn num(v: &[f64]) -> Vec<Cell> {
    v.iter().map(|&n| Cell::Num(n)).collect()
}
fn strs(v: &[&str]) -> Vec<Cell> {
    v.iter().map(|s| Cell::Str(s.to_string())).collect()
}

fn frame(cols: Vec<(&str, SolType, Vec<Cell>)>) -> SolFrame {
    let names: Vec<String> = cols.iter().map(|(n, _, _)| n.to_string()).collect();
    let types: Vec<SolType> = cols.iter().map(|(_, t, _)| *t).collect();
    let data: Vec<Vec<Cell>> = cols.into_iter().map(|(_, _, c)| c).collect();
    let df = build_df(&names, &types, &data).unwrap();
    SolFrame { df, types }
}

/// Read a frame back as a column-major (name, type, json-cells) view for asserts.
fn dump(f: &SolFrame) -> Vec<(String, String, Vec<Json>)> {
    f.df
        .get_columns()
        .iter()
        .zip(f.types.iter())
        .map(|(c, t)| {
            (
                c.name().to_string(),
                t.tag().to_string(),
                cells_of(c).iter().map(cell_to_json).collect(),
            )
        })
        .collect()
}

fn j(v: &[f64]) -> Vec<Json> {
    v.iter().map(|&n| num_to_json(n)).collect()
}

#[test]
fn source_preview_column_drop_lifecycle() {
    let wf: WireFrame = serde_json::from_value(serde_json::json!({
        "columns": [
            { "name": "n", "type": "number", "values": [1, 2, 3, 4, 5] },
            { "name": "s", "type": "string", "values": ["a", "b", "c", "d", "e"] }
        ]
    }))
    .unwrap();
    let h = register(wire_to_solframe(wf).unwrap());

    let p = with_frame(&h, |f| Ok(preview_of(f, 2))).unwrap();
    assert_eq!(p.row_count, 5);
    assert!(p.truncated);
    assert_eq!(p.rows.len(), 2);
    assert_eq!(p.rows[0], vec![num_to_json(1.0), Json::String("a".into())]);

    let col = with_frame(&h, |f| Ok(column_of(f, "s"))).unwrap().unwrap();
    assert_eq!(col.ty, "string");
    assert_eq!(col.values.len(), 5);
    assert!(with_frame(&h, |f| Ok(column_of(f, "missing"))).unwrap().is_none());

    {
        let mut s = store().lock().unwrap();
        s.frames.remove(&h);
    }
    let after = with_frame(&h, |f| Ok(preview_of(f, 1)));
    assert!(after.is_err());
}

#[test]
fn collect_returns_all_rows_typed() {
    let f = frame(vec![
        ("n", SolType::Number, num(&[1.0, 2.0, 3.0])),
        ("d", SolType::Date, num(&[46000.0, 46001.0, 46002.0])),
        ("s", SolType::Str, strs(&["a", "b", "c"])),
    ]);
    let cols = collect_of(&f);
    assert_eq!(cols.len(), 3);
    assert_eq!(cols[0].values.len(), 3); // full, not head-N
    assert_eq!(cols[1].ty, "date"); // tag preserved
    assert_eq!(cols[2].values[2], Json::String("c".into()));
}

#[test]
fn integral_numbers_emit_as_integers() {
    assert_eq!(num_to_json(1.0), Json::Number(1i64.into()));
    assert_eq!(num_to_json(2.5), serde_json::json!(2.5));
}

#[test]
fn make_headers_matches_oracle() {
    let got = make_headers(&["".to_string(), "a".to_string(), "a".to_string()], 3);
    assert_eq!(got, vec!["Col1".to_string(), "a".to_string(), "a2".to_string()]);
}

// ─── sample (sketch mode, #24) ──────────────────────────────────────────────────

#[test]
fn sample_under_n_is_unchanged_factor_one() {
    let f = frame(vec![("a", SolType::Number, num(&[1.0, 2.0, 3.0]))]);
    let (sampled, factor) = verb_sample(&f, 10).unwrap();
    assert_eq!(factor, 1.0);
    assert_eq!(dump(&sampled)[0].2, j(&[1.0, 2.0, 3.0]));
}

#[test]
fn sample_strides_evenly_and_reports_factor() {
    // 10 rows sampled to 5 — every other row, in order; factor = 10/5 = 2.
    let f = frame(vec![(
        "a",
        SolType::Number,
        num(&[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]),
    )]);
    let (sampled, factor) = verb_sample(&f, 5).unwrap();
    assert_eq!(factor, 2.0);
    assert_eq!(dump(&sampled)[0].2, j(&[0.0, 2.0, 4.0, 6.0, 8.0]));
}

#[test]
fn sample_zero_n_is_unchanged() {
    let f = frame(vec![("a", SolType::Number, num(&[1.0, 2.0]))]);
    let (sampled, factor) = verb_sample(&f, 0).unwrap();
    assert_eq!(factor, 1.0);
    assert_eq!(dump(&sampled)[0].2, j(&[1.0, 2.0]));
}

#[test]
fn engine_sample_command_registers_a_new_handle_and_leaves_the_source_intact() {
    let f = frame(vec![(
        "a",
        SolType::Number,
        num(&[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]),
    )]);
    let h = register(f);
    let out = engine_sample(h.clone(), 5).unwrap();
    assert_eq!(out.factor, 2.0);
    assert_ne!(out.handle, h); // a NEW handle, not a mutation of the source
    let sampled = with_frame(&out.handle, |f| Ok(dump(f))).unwrap();
    assert_eq!(sampled[0].2, j(&[0.0, 2.0, 4.0, 6.0, 8.0]));
    // the original handle still resolves to the full, unsampled frame
    let original = with_frame(&h, |f| Ok(dump(f))).unwrap();
    assert_eq!(original[0].2.len(), 10);
}

// ─── native CSV read (#24 WS-E) ─────────────────────────────────────────────────

#[test]
fn read_csv_infers_number_string_and_boolean_columns() {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("solenoid_engine_test_{}.csv", std::process::id()));
    std::fs::write(&path, "n,s,flag\n1,apple,true\n2,banana,false\n").unwrap();

    let df = CsvReadOptions::default()
        .with_has_header(true)
        .try_into_reader_with_file_path(Some(path.clone()))
        .unwrap()
        .finish()
        .unwrap();
    let frame = df_to_solframe(df);
    let d = dump(&frame);

    std::fs::remove_file(&path).ok();

    assert_eq!(d[0].1, "number");
    assert_eq!(d[0].2, j(&[1.0, 2.0]));
    assert_eq!(d[1].1, "string");
    assert_eq!(
        d[1].2,
        vec![Json::String("apple".into()), Json::String("banana".into())]
    );
    assert_eq!(d[2].1, "logical");
    assert_eq!(d[2].2, vec![Json::Bool(true), Json::Bool(false)]);
}

// ─── Parquet source (bundle 34) ─────────────────────────────────────────────────

#[test]
fn parquet_round_trip_preserves_types_and_dates() {
    let n: PlSmallStr = "n".into();
    let s: PlSmallStr = "s".into();
    let b: PlSmallStr = "b".into();
    let d: PlSmallStr = "d".into();
    let date_col = Series::new(d, vec![19000i32, 19001, 19002])
        .cast(&DataType::Date)
        .unwrap();
    let mut df = DataFrame::new(vec![
        Series::new(n, vec![1i64, 2, 3]).into_column(),
        Series::new(s, vec!["a", "b", "c"]).into_column(),
        Series::new(b, vec![true, false, true]).into_column(),
        date_col.into_column(),
    ])
    .unwrap();

    let path = std::env::temp_dir().join(format!("solenoid_test_{}.parquet", std::process::id()));
    let file = std::fs::File::create(&path).unwrap();
    ParquetWriter::new(file).finish(&mut df).unwrap();
    let out = read_parquet_solframe(&path);
    std::fs::remove_file(&path).ok();
    let out = out.unwrap();

    let d = dump(&out);
    assert_eq!(d[0].1, "number");
    assert_eq!(d[0].2, j(&[1.0, 2.0, 3.0]));
    assert_eq!(d[1].1, "string");
    assert_eq!(
        d[1].2,
        vec![Json::String("a".into()), Json::String("b".into()), Json::String("c".into())]
    );
    assert_eq!(d[2].1, "logical");
    assert_eq!(d[2].2, vec![Json::Bool(true), Json::Bool(false), Json::Bool(true)]);
    // A Date column arrives as an Excel serial, not Polars' own Unix-epoch day count:
    // 19000 Unix days + 25569 (Excel↔Unix epoch offset, mirrors jsDateToSerial).
    assert_eq!(d[3].1, "date");
    assert_eq!(d[3].2, j(&[44569.0, 44570.0, 44571.0]));
}

#[test]
fn parquet_missing_file_is_a_ref_error() {
    let path = std::path::Path::new("__solenoid_does_not_exist__.parquet");
    let err = read_parquet_solframe(path).unwrap_err();
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "#REF!");
}

// ─── Fusion (apply_ops / engine_apply_many): a chain matches applying each verb
// one at a time — the ONE thing that must never change is the RESULT, only how
// many times Polars collects to get there.
#[test]
fn apply_ops_pure_lazy_chain_matches_sequential_single_ops() {
    // select → filter(comparison) → sort — every step here is a pure Polars expr
    // (no mid-chain collect), the exact fusion target.
    let f = frame(vec![
        ("region", SolType::Str, strs(&["N", "S", "N", "S"])),
        ("qty", SolType::Number, num(&[30.0, 10.0, 20.0, 40.0])),
    ]);
    let ops = vec![
        WireOp::Select { columns: vec!["qty".into(), "region".into()] },
        WireOp::Filter { column: "qty".into(), op: "gt".into(), value: serde_json::json!(15), match_case: false },
        WireOp::Sort { by: "qty".into(), dir: "asc".into() },
    ];
    let fused = apply_ops(&f, &ops).unwrap();

    // Sequential reference: the same ops applied ONE at a time (each single-op
    // call collects), so the comparison isolates the fusion itself.
    let mut sequential = f;
    for op in ops {
        sequential = apply_ops(&sequential, &[op]).unwrap();
    }

    assert_eq!(dump(&fused), dump(&sequential));
    assert_eq!(dump(&fused)[0].2, j(&[20.0, 30.0, 40.0]));
}

#[test]
fn apply_ops_crosses_eager_steps_and_still_fuses_around_them() {
    // select → distinct (forces a mid-chain collect) → sort (resumes lazily) —
    // verifies the plan correctly hands off through an eager op both ways.
    let f = frame(vec![
        ("a", SolType::Number, num(&[3.0, 1.0, 3.0, 2.0])),
        ("b", SolType::Number, num(&[9.0, 9.0, 9.0, 9.0])),
    ]);
    let ops = vec![
        WireOp::Select { columns: vec!["a".into()] },
        WireOp::Distinct { columns: None },
        WireOp::Sort { by: "a".into(), dir: "asc".into() },
    ];
    let fused = apply_ops(&f, &ops).unwrap();
    assert_eq!(dump(&fused)[0].2, j(&[1.0, 2.0, 3.0]));
}

#[test]
fn apply_ops_text_predicate_filter_mid_chain() {
    // A text-predicate filter (contains/startsWith/endsWith) is hand-rolled —
    // must collect just that step and resume the chain lazily afterward.
    let f = frame(vec![
        ("s", SolType::Str, strs(&["apple", "apricot", "berry", "cherry"])),
        ("n", SolType::Number, num(&[4.0, 3.0, 1.0, 2.0])),
    ]);
    let ops = vec![
        WireOp::Filter { column: "s".into(), op: "startsWith".into(), value: serde_json::json!("ap"), match_case: false },
        WireOp::Sort { by: "n".into(), dir: "asc".into() },
    ];
    let fused = apply_ops(&f, &ops).unwrap();
    assert_eq!(
        dump(&fused)[0].2,
        vec![Json::String("apricot".into()), Json::String("apple".into())]
    );
}

#[test]
fn apply_ops_case_insensitive_string_eq_mid_chain() {
    // A case-insensitive string eq (the default) is hand-rolled like the text
    // predicates — the fused path must collect that step and resume lazily; a
    // match_case eq stays a pure Polars expr and matches exact.
    let f = frame(vec![
        ("city", SolType::Str, strs(&["Oslo", "OSLO", "Bergen"])),
        ("n", SolType::Number, num(&[2.0, 1.0, 3.0])),
    ]);
    let ops = vec![
        WireOp::Filter { column: "city".into(), op: "eq".into(), value: serde_json::json!("oslo"), match_case: false },
        WireOp::Sort { by: "n".into(), dir: "asc".into() },
    ];
    let fused = apply_ops(&f, &ops).unwrap();
    assert_eq!(
        dump(&fused)[0].2,
        vec![Json::String("OSLO".into()), Json::String("Oslo".into())]
    );

    let exact = apply_ops(&f, &[WireOp::Filter { column: "city".into(), op: "eq".into(), value: serde_json::json!("OSLO"), match_case: true }]).unwrap();
    assert_eq!(dump(&exact)[0].2, vec![Json::String("OSLO".into())]);
}

#[test]
fn apply_ops_group_by_mid_chain() {
    let f = frame(vec![
        ("k", SolType::Str, strs(&["b", "a", "b", "a"])),
        ("v", SolType::Number, num(&[10.0, 1.0, 20.0, 2.0])),
    ]);
    let ops = vec![
        WireOp::GroupBy {
            keys: vec!["k".into()],
            aggs: vec![WireAgg { column: "v".into(), op: "sum".into(), as_name: "total".into() }],
        },
        WireOp::Sort { by: "total".into(), dir: "desc".into() },
    ];
    let fused = apply_ops(&f, &ops).unwrap();
    let d = dump(&fused);
    assert_eq!(d[1].2, j(&[30.0, 3.0])); // b=10+20=30 sorts before a=1+2=3
}

#[test]
fn engine_apply_many_ipc_matches_chained_engine_apply_calls() {
    let f = frame(vec![
        ("region", SolType::Str, strs(&["N", "S", "N"])),
        ("qty", SolType::Number, num(&[10.0, 20.0, 30.0])),
    ]);
    let h_many = register(f.clone());
    let ops = vec![
        WireOp::Filter { column: "qty".into(), op: "gte".into(), value: serde_json::json!(20), match_case: false },
        WireOp::Sort { by: "qty".into(), dir: "desc".into() },
    ];
    let h_out_many = engine_apply_many(h_many, ops).unwrap();

    let h_seq = register(f);
    let h_step1 = engine_apply(h_seq, WireOp::Filter { column: "qty".into(), op: "gte".into(), value: serde_json::json!(20), match_case: false }).unwrap();
    let h_out_seq = engine_apply(h_step1, WireOp::Sort { by: "qty".into(), dir: "desc".into() }).unwrap();

    let p_many = with_frame(&h_out_many, |f| Ok(preview_of(f, 10))).unwrap();
    let p_seq = with_frame(&h_out_seq, |f| Ok(preview_of(f, 10))).unwrap();
    assert_eq!(p_many.rows, p_seq.rows);
    assert_eq!(p_many.rows, vec![vec![Json::String("N".into()), num_to_json(30.0)], vec![Json::String("S".into()), num_to_json(20.0)]]);
}


// ─── Oracle-key parity (B-1a): serde_json tagged tuples, byte-identical to JS ───

#[test]
fn row_key_is_byte_identical_to_js_json_stringify() {
    // The exact literal produced by node:
    //   JSON.stringify([["s","a<U+0001>b"],["#",1],["#",-0],["b",true],["n"]])
    // (a \u{1}-bearing string, integral float as integer, -0 keyed as 0).
    let cells: Vec<Vec<Cell>> = vec![
        vec![Cell::Str("a\u{1}b".into())],
        vec![Cell::Num(1.0)],
        vec![Cell::Num(-0.0)],
        vec![Cell::Bool(true)],
        vec![Cell::Null],
    ];
    assert_eq!(
        row_key_json(&cells, 0),
        "[[\"s\",\"a\\u0001b\"],[\"#\",1],[\"#\",0],[\"b\",true],[\"n\"]]"
    );
}

#[test]
fn row_key_keys_each_non_finite_apart() {
    // JSON.stringify writes every non-finite as `null`, so the oracle's
    // encodeCell names them instead — mirror it byte for byte or +∞, −∞ and
    // NaN silently share a distinct/group bucket on one engine only.
    let cells: Vec<Vec<Cell>> = vec![
        vec![Cell::Num(f64::INFINITY)],
        vec![Cell::Num(f64::NEG_INFINITY)],
        vec![Cell::Num(f64::NAN)],
        vec![Cell::Null],
    ];
    assert_eq!(
        row_key_json(&cells, 0),
        "[[\"#\",\"inf\"],[\"#\",\"-inf\"],[\"#\",\"nan\"],[\"n\"]]"
    );
    // The tokens live under the "#" tag, so a string cell spelling "inf"
    // keys as ["s","inf"] and cannot collide.
    let strs: Vec<Vec<Cell>> = vec![vec![Cell::Str("inf".into())]];
    assert_eq!(row_key_json(&strs, 0), "[[\"s\",\"inf\"]]");
}

#[test]
fn row_key_float_formatting_matches_js() {
    // Non-integral floats via shortest-round-trip; integral via the i64 branch.
    let cells: Vec<Vec<Cell>> = vec![vec![Cell::Num(1.5)], vec![Cell::Num(0.1)], vec![Cell::Num(-2.0)]];
    assert_eq!(row_key_json(&cells, 0), "[[\"#\",1.5],[\"#\",0.1],[\"#\",-2]]");
}

// ─── Non-finite wire sentinel (B-1b): {"__nf":...} both directions ─────────────

#[test]
fn non_finite_crosses_the_wire_as_the_nf_sentinel() {
    // Download direction: a cell holding Infinity/NaN serializes as the tagged
    // sentinel, never a silent null (decided 2026-07-02 — Infinity is first-class).
    assert_eq!(num_to_json(f64::INFINITY), serde_json::json!({"__nf": "inf"}));
    assert_eq!(num_to_json(f64::NEG_INFINITY), serde_json::json!({"__nf": "-inf"}));
    assert_eq!(num_to_json(f64::NAN), serde_json::json!({"__nf": "nan"}));
    // Finite formatting unchanged: integral → integer, else shortest float.
    assert_eq!(num_to_json(1.0), serde_json::json!(1));
    assert_eq!(num_to_json(1.5), serde_json::json!(1.5));
}

#[test]
fn nf_sentinel_uploads_into_real_infinity_cells() {
    // Upload direction: {"__nf":"inf"} → a real ±Inf f64 cell; {"__err":..} →
    // Null (Polars-typed columns can't hold a per-cell error — deliberate).
    let inf = json_to_cell(&serde_json::json!({"__nf": "inf"}), SolType::Number);
    let ninf = json_to_cell(&serde_json::json!({"__nf": "-inf"}), SolType::Number);
    let nan = json_to_cell(&serde_json::json!({"__nf": "nan"}), SolType::Number);
    let err = json_to_cell(&serde_json::json!({"__err": "#DIV/0!"}), SolType::Number);
    assert!(matches!(inf, Cell::Num(n) if n == f64::INFINITY));
    assert!(matches!(ninf, Cell::Num(n) if n == f64::NEG_INFINITY));
    assert!(matches!(nan, Cell::Num(n) if n.is_nan()));
    assert!(matches!(err, Cell::Null));
}

#[test]
fn infinity_round_trips_through_a_frame() {
    let f = frame(vec![("v", SolType::Number, vec![
        Cell::Num(1.0), Cell::Num(f64::INFINITY), Cell::Num(f64::NEG_INFINITY),
    ])]);
    let d = dump(&f);
    assert_eq!(d[0].2, vec![
        serde_json::json!(1),
        serde_json::json!({"__nf": "inf"}),
        serde_json::json!({"__nf": "-inf"}),
    ]);
}

// ─── Native CSV date inference (B-3; JS twin: frame.ts inferColumn/isDateCell) ──

#[test]
fn iso_date_serial_pins_match_the_js_epoch() {
    // DATE(2026,3,15) = 46096 (the audit-29 pin in excelFunctions.ts).
    assert_eq!(parse_iso_date_serial("2026-03-15"), Some(46096.0));
    assert_eq!(parse_iso_date_serial("2026-03-15 12:00"), Some(46096.5));
    assert_eq!(parse_iso_date_serial("2026-03-15T06:00:00"), Some(46096.25));
    // An explicit zone is an absolute instant: 02:00+02:00 = midnight UTC.
    assert_eq!(parse_iso_date_serial("2026-03-15T02:00+02:00"), Some(46096.0));
    assert_eq!(parse_iso_date_serial("2026-03-15T00:00Z"), Some(46096.0));
    let frac = parse_iso_date_serial("2026-03-15T00:00:30.5").unwrap();
    assert!((frac - (46096.0 + 30.5 / 86400.0)).abs() < 1e-9);
    assert_eq!(parse_iso_date_serial("2024-02-29"), Some(46081.0 - 730.0)); // leap day parses
}

#[test]
fn iso_date_gate_rejects_what_js_rejects() {
    for bad in [
        "2026-02-31",     // not a real day
        "2026-13-01",     // not a real month
        "46096",          // a bare number is never a date
        "1/2/26",         // locale-ambiguous
        "15-Mar-2026",    // named month is the TYPED-input path, not import inference
        "2026-03-15X",    // trailing garbage
        "2026-03-15T25:00", // no such hour
    ] {
        assert_eq!(parse_iso_date_serial(bad), None, "should reject {bad:?}");
    }
}

#[test]
fn date_inference_flips_an_all_iso_text_column_only() {
    let f = frame(vec![
        ("when", SolType::Str, vec![
            Cell::Str("2026-03-15".into()), Cell::Null, Cell::Str("2026-03-16".into()),
        ]),
        ("notes", SolType::Str, strs(&["2026-03-15", "not a date", "2026-03-16"])),
        ("qty", SolType::Number, num(&[1.0, 2.0, 3.0])),
    ]);
    let out = infer_iso_date_columns(f).unwrap();
    assert_eq!(out.types, vec![SolType::Date, SolType::Str, SolType::Number]);
    let d = dump(&out);
    assert_eq!(d[0].2, vec![num_to_json(46096.0), Json::Null, num_to_json(46097.0)]);
    assert_eq!(d[1].2[1], Json::String("not a date".into())); // mixed column untouched
}

#[test]
fn date_inference_leaves_an_all_blank_column_text() {
    let f = frame(vec![("empty", SolType::Str, vec![Cell::Null, Cell::Null])]);
    let out = infer_iso_date_columns(f).unwrap();
    assert_eq!(out.types, vec![SolType::Str]);
}

#[test]
fn engine_read_csv_infers_dates_end_to_end() {
    let dir = std::env::temp_dir();
    let name = "solenoid_b3_date_inference_test.csv";
    std::fs::write(
        dir.join(name),
        "When,Label,Amount\n2026-03-15,alpha,10\n2026-03-16,2026-03-16,20\n,beta,30\n",
    )
    .unwrap();
    let cols = engine_read_csv(dir.to_string_lossy().to_string(), name.to_string()).unwrap();
    std::fs::remove_file(dir.join(name)).ok();
    assert_eq!(cols[0].ty, "date"); // all-ISO (with a blank hole) → date serials
    assert_eq!(cols[0].values, vec![num_to_json(46096.0), num_to_json(46097.0), Json::Null]);
    assert_eq!(cols[1].ty, "string"); // mixed text stays text
    assert_eq!(cols[2].ty, "number"); // Polars-native numeric untouched
}

// ─── The parity corpus ────────────────────────────────────────────────────────
// One fixture set, both engines: every case in fixtures/frame-verbs also runs
// through the JS oracle (frameVerbCorpus.test.ts). The fixtures ARE wire
// payloads, so this runner deserializes them with the PRODUCTION types
// (WireFrame / WireOp) — a fixture that parses on one side and not the other is
// itself the parity failure, surfacing at load. Case inventory + shape sanity
// (expect XOR expectError, unique names, whitelist ratchet) live on the JS
// side; here every case must simply compute the same frame or refuse with the
// same SolError code.

#[derive(serde::Deserialize)]
struct CorpusCase {
    name: String,
    frames: std::collections::HashMap<String, WireFrame>,
    // Raw here, WireOp-parsed per case: an ORACLE_ONLY verb's op must REFUSE to
    // parse (that refusal is asserted), everything else must parse.
    op: Json,
    expect: Option<WireFrame>,
    #[serde(rename = "expectError")]
    expect_error: Option<String>,
}

/// Verbs with corpus fixtures but NO engine op: they run eagerly in the JS
/// oracle on BOTH platforms (pivot — the full PIVOTBY spec is a deliberate
/// materialization boundary; the stale engine variant was deleted, audit
/// finding 34). The runner still asserts the engine indeed does NOT speak the
/// op, so the list can't go stale: if `WireOp` ever gains the kind, the
/// assertion fails and the verb joins the corpus proper.
const ORACLE_ONLY_VERBS: &[&str] = &["pivot"];

#[derive(serde::Deserialize)]
struct CorpusFile {
    verb: String,
    cases: Vec<CorpusCase>,
}

#[test]
fn corpus_cases() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/frame-verbs");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .expect("fixtures/frame-verbs must exist")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no corpus fixtures found in {}", dir.display());

    let mut failures: Vec<String> = Vec::new();
    for path in files {
        let text = std::fs::read_to_string(&path).unwrap();
        let file: CorpusFile = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("{}: fixture does not parse as wire payloads: {e}", path.display()));
        for case in file.cases {
            let label = format!("{} › {}", file.verb, case.name);
            if ORACLE_ONLY_VERBS.contains(&file.verb.as_str()) {
                if serde_json::from_value::<WireOp>(case.op).is_ok() {
                    failures.push(format!(
                        "{label}: the engine now speaks this op — remove \"{}\" from ORACLE_ONLY_VERBS and run its cases",
                        file.verb
                    ));
                }
                continue;
            }
            // Decode every named input with the production deserializer.
            let mut frames: std::collections::HashMap<String, SolFrame> = std::collections::HashMap::new();
            let mut refused = false;
            for (k, wf) in case.frames {
                match wire_to_solframe(wf) {
                    Ok(f) => { frames.insert(k, f); }
                    Err(e) => { failures.push(format!("{label}: input frame \"{k}\" refused: {}", err_code(&e))); refused = true; }
                }
            }
            if refused { continue; }
            let take = |frames: &mut std::collections::HashMap<String, SolFrame>, name: &str| -> Option<SolFrame> {
                frames.remove(name)
            };
            // Binary verbs are separate backend commands, not WireOps — dispatch
            // by the file's verb name (the JS runner does the same).
            let result: Result<SolFrame, IpcError> = match file.verb.as_str() {
                "join" => {
                    // The op is `{ kind: "join" } & WireJoinOpts` — serde ignores
                    // the extra `kind` field, so the PRODUCTION opts type parses it.
                    match serde_json::from_value::<WireJoinOpts>(case.op) {
                        Err(e) => { failures.push(format!("{label}: op does not parse as WireJoinOpts: {e}")); continue; }
                        Ok(opts) => {
                            let (Some(l), Some(r)) = (take(&mut frames, "left"), take(&mut frames, "right")) else {
                                failures.push(format!("{label}: join needs \"left\" + \"right\" frames"));
                                continue;
                            };
                            verb_join(&l, &r, &opts)
                        }
                    }
                }
                "append" => {
                    #[derive(serde::Deserialize)]
                    struct AppendOp { frames: Vec<String> }
                    match serde_json::from_value::<AppendOp>(case.op) {
                        Err(e) => { failures.push(format!("{label}: op does not parse as an append op: {e}")); continue; }
                        Ok(op) => {
                            // append_frames runs over store handles (the IPC shape).
                            let mut handles: Vec<String> = Vec::new();
                            let mut missing = false;
                            for n in &op.frames {
                                match take(&mut frames, n) {
                                    Some(f) => handles.push(register(f)),
                                    None => { failures.push(format!("{label}: append names an absent frame \"{n}\"")); missing = true; }
                                }
                            }
                            let r = if missing { continue } else { append_frames(&handles) };
                            let mut s = store().lock().unwrap();
                            for h in handles { s.frames.remove(&h); }
                            drop(s);
                            r
                        }
                    }
                }
                "bindColumns" => {
                    #[derive(serde::Deserialize)]
                    struct BindOp { frames: Vec<String> }
                    match serde_json::from_value::<BindOp>(case.op) {
                        Err(e) => { failures.push(format!("{label}: op does not parse as a bindColumns op: {e}")); continue; }
                        Ok(op) => {
                            let mut handles: Vec<String> = Vec::new();
                            let mut missing = false;
                            for n in &op.frames {
                                match take(&mut frames, n) {
                                    Some(f) => handles.push(register(f)),
                                    None => { failures.push(format!("{label}: bindColumns names an absent frame \"{n}\"")); missing = true; }
                                }
                            }
                            let r = if missing { continue } else { bind_columns(&handles) };
                            let mut s = store().lock().unwrap();
                            for h in handles { s.frames.remove(&h); }
                            drop(s);
                            r
                        }
                    }
                }
                "pipeline" => {
                    // The fusion cases: the oracle ran these ops SEQUENTIALLY;
                    // here the whole list goes to apply_ops in one call, so
                    // Polars fuses them into a single lazy plan (the
                    // engine_apply_many path). Sequential-vs-fused parity is
                    // exactly what these cases pin.
                    #[derive(serde::Deserialize)]
                    struct PipelineOp { ops: Vec<WireOp> }
                    match serde_json::from_value::<PipelineOp>(case.op) {
                        Err(e) => { failures.push(format!("{label}: op does not parse as a pipeline of WireOps: {e}")); continue; }
                        Ok(p) => {
                            let Some(input) = take(&mut frames, "in") else {
                                failures.push(format!("{label}: no \"in\" frame"));
                                continue;
                            };
                            apply_ops(&input, &p.ops)
                        }
                    }
                }
                _ => {
                    let op = match serde_json::from_value::<WireOp>(case.op) {
                        Ok(op) => op,
                        Err(e) => { failures.push(format!("{label}: op does not parse as WireOp: {e}")); continue; }
                    };
                    let Some(input) = take(&mut frames, "in") else {
                        failures.push(format!("{label}: no \"in\" frame"));
                        continue;
                    };
                    apply_ops(&input, &[op])
                }
            };
            match (result, case.expect, case.expect_error) {
                (Ok(out), Some(expect), _) => {
                    let got = dump(&out);
                    let want: Vec<(String, String, Vec<Json>)> = expect
                        .columns
                        .into_iter()
                        .map(|c| (c.name, c.ty, c.values))
                        .collect();
                    if !frames_equal(&got, &want) {
                        failures.push(format!("{label}: got {got:?}, want {want:?}"));
                    }
                }
                (Ok(out), None, Some(code)) => {
                    failures.push(format!("{label}: expected {code}, computed {:?}", dump(&out)));
                }
                (Err(e), _, Some(code)) => {
                    if err_code(&e) != code {
                        failures.push(format!("{label}: expected {code}, got {}", err_code(&e)));
                    }
                }
                (Err(e), Some(_), None) => {
                    failures.push(format!("{label}: expected a frame, got error {}", err_code(&e)));
                }
                (Ok(_), None, None) | (Err(_), None, None) => {
                    failures.push(format!("{label}: case has neither expect nor expectError"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "corpus parity failures:\n  {}", failures.join("\n  "));
}

/// The IpcError code, via its serde form (the fields are ipc.rs-private; the
/// serialized shape is the stable contract — `{ __solError, code, message }`).
fn err_code(e: &IpcError) -> String {
    serde_json::to_value(e).ok()
        .and_then(|v| v.get("code").and_then(|c| c.as_str()).map(String::from))
        .unwrap_or_default()
}

/// Structural frame equality with NUMERIC-aware cells: serde parses a fixture's
/// `1` as u64 and `dump` renders Cell::Num(1.0) via num_to_json (i64 branch), so
/// plain Value equality would work for integers — but compare through as_f64 for
/// every number pair so a fixture may write 1.0 or 1 interchangeably, exactly as
/// JSON.parse does on the JS side.
fn frames_equal(a: &[(String, String, Vec<Json>)], b: &[(String, String, Vec<Json>)]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(x, y)| {
            x.0 == y.0
                && x.1 == y.1
                && x.2.len() == y.2.len()
                && x.2.iter().zip(&y.2).all(|(p, q)| match (p.as_f64(), q.as_f64()) {
                    (Some(m), Some(n)) => m == n,
                    _ => p == q,
                })
        })
}

/// Replace Values shares ONE match rule with the JS oracle (`replaceValues`, the "shared
/// match rule" test): a number matches by numeric equality against the parsed find (a
/// non-numeric find hits no number cell), a boolean matches the words TRUE/FALSE
/// case-insensitively (never 1/0), a string matches exact text. Dates are serials → number arm.
#[test]
fn replace_values_match_rule_parity() {
    let f = frame(vec![
        ("n", SolType::Number, vec![Cell::Num(5.0), Cell::Num(20.0), Cell::Null]),
        ("flag", SolType::Logical, vec![Cell::Bool(true), Cell::Bool(false), Cell::Bool(true)]),
        ("s", SolType::Str, strs(&["a", "b", "c"])),
    ]);
    let replace = |col: &str, find: &str, rep: &str| {
        apply_ops(&f, &[WireOp::ReplaceValues {
            column: col.into(), find: find.into(), replace_with: rep.into(), mode: "cell".into(),
        }]).unwrap()
    };
    // Number: "5.0" and "5" both hit 5 numerically; a non-numeric find hits no number cell.
    assert_eq!(dump(&replace("n", "5.0", "99"))[0].2, vec![num_to_json(99.0), num_to_json(20.0), Json::Null]);
    assert_eq!(dump(&replace("n", "5", "99"))[0].2, vec![num_to_json(99.0), num_to_json(20.0), Json::Null]);
    assert_eq!(dump(&replace("n", "five", "99"))[0].2, vec![num_to_json(5.0), num_to_json(20.0), Json::Null]);
    // Boolean: TRUE/FALSE case-insensitive; "1"/"0" never match a boolean.
    assert_eq!(dump(&replace("flag", "true", "false"))[1].2, vec![Json::Bool(false), Json::Bool(false), Json::Bool(false)]);
    assert_eq!(dump(&replace("flag", "TRUE", "false"))[1].2, vec![Json::Bool(false), Json::Bool(false), Json::Bool(false)]);
    assert_eq!(dump(&replace("flag", "1", "false"))[1].2, vec![Json::Bool(true), Json::Bool(false), Json::Bool(true)]);
    // String: exact text, case-sensitive.
    assert_eq!(dump(&replace("s", "b", "99"))[2].2, vec![Json::String("a".into()), Json::String("99".into()), Json::String("c".into())]);
    assert_eq!(dump(&replace("s", "B", "99"))[2].2, vec![Json::String("a".into()), Json::String("b".into()), Json::String("c".into())]);
}
