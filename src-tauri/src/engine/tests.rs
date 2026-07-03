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
fn select_keeps_order_and_errors_on_missing() {
    let f = frame(vec![
        ("a", SolType::Number, num(&[1.0, 2.0])),
        ("b", SolType::Str, strs(&["x", "y"])),
    ]);
    let out = verb_select(&f, &["b".into(), "a".into()]).unwrap();
    let d = dump(&out);
    assert_eq!(d[0].0, "b");
    assert_eq!(d[1].0, "a");
    assert!(verb_select(&f, &["nope".into()]).is_err());
}

#[test]
fn drop_ignores_unknown() {
    let f = frame(vec![
        ("a", SolType::Number, num(&[1.0])),
        ("b", SolType::Number, num(&[2.0])),
    ]);
    let out = verb_drop(&f, &["b".into(), "ghost".into()]).unwrap();
    assert_eq!(dump(&out).len(), 1);
    assert_eq!(dump(&out)[0].0, "a");
}

#[test]
fn rename_dedupes_collisions() {
    let f = frame(vec![
        ("Date", SolType::Number, num(&[1.0])),
        ("Name", SolType::Str, strs(&["a"])),
    ]);
    let mut map = HashMap::new();
    map.insert("Name".to_string(), "Date".to_string());
    let out = verb_rename(&f, &map).unwrap();
    let names: Vec<String> = dump(&out).into_iter().map(|c| c.0).collect();
    assert_eq!(names, vec!["Date".to_string(), "Date2".to_string()]);
}

#[test]
fn sort_puts_blanks_last_both_directions() {
    let f = frame(vec![("a", SolType::Number, vec![Cell::Num(3.0), Cell::Null, Cell::Num(1.0)])]);
    let asc = verb_sort(&f, "a", "asc").unwrap();
    assert_eq!(dump(&asc)[0].2, vec![num_to_json(1.0), num_to_json(3.0), Json::Null]);
    let desc = verb_sort(&f, "a", "desc").unwrap();
    assert_eq!(dump(&desc)[0].2, vec![num_to_json(3.0), num_to_json(1.0), Json::Null]);
}

#[test]
fn distinct_keeps_first_occurrence() {
    let f = frame(vec![("a", SolType::Number, num(&[1.0, 1.0, 2.0, 1.0]))]);
    let out = verb_distinct(&f, &None).unwrap();
    assert_eq!(dump(&out)[0].2, j(&[1.0, 2.0]));
}

#[test]
fn head_takes_prefix() {
    let f = frame(vec![("a", SolType::Number, num(&[1.0, 2.0, 3.0]))]);
    let out = verb_head(&f, 2.0).unwrap();
    assert_eq!(dump(&out)[0].2, j(&[1.0, 2.0]));
    assert_eq!(verb_head(&f, 0.0).unwrap().df.height(), 0);
}

#[test]
fn filter_numeric_and_text() {
    let f = frame(vec![
        ("n", SolType::Number, vec![Cell::Num(1.0), Cell::Num(5.0), Cell::Null, Cell::Num(9.0)]),
        ("s", SolType::Str, vec![Cell::Str("apple".into()), Cell::Str("apricot".into()), Cell::Str("berry".into()), Cell::Str("cherry".into())]),
    ]);
    let gt = verb_filter(&f, "n", "gt", &serde_json::json!(4)).unwrap();
    assert_eq!(dump(&gt)[0].2, j(&[5.0, 9.0])); // null excluded
    let starts = verb_filter(&f, "s", "startsWith", &serde_json::json!("ap")).unwrap();
    assert_eq!(dump(&starts)[1].2, vec![Json::String("apple".into()), Json::String("apricot".into())]);
}

#[test]
fn group_by_first_seen_with_aggregates() {
    let f = frame(vec![
        ("k", SolType::Str, strs(&["b", "a", "b", "a"])),
        ("v", SolType::Number, num(&[10.0, 1.0, 20.0, 2.0])),
    ]);
    let aggs = vec![
        WireAgg { column: "v".into(), op: "sum".into(), as_name: "total".into() },
        WireAgg { column: "v".into(), op: "count".into(), as_name: "cnt".into() },
    ];
    let out = verb_group_by(&f, &["k".into()], &aggs).unwrap();
    let d = dump(&out);
    assert_eq!(d[0].2, vec![Json::String("b".into()), Json::String("a".into())]); // first-seen
    assert_eq!(d[1].2, j(&[30.0, 3.0]));
    assert_eq!(d[2].2, j(&[2.0, 2.0]));
}

#[test]
fn group_by_empty_group_sum_is_zero_avg_is_null() {
    let f = frame(vec![
        ("k", SolType::Str, strs(&["a"])),
        ("v", SolType::Number, vec![Cell::Null]),
    ]);
    let aggs = vec![
        WireAgg { column: "v".into(), op: "sum".into(), as_name: "s".into() },
        WireAgg { column: "v".into(), op: "avg".into(), as_name: "m".into() },
    ];
    let out = verb_group_by(&f, &["k".into()], &aggs).unwrap();
    let d = dump(&out);
    assert_eq!(d[1].2, vec![num_to_json(0.0)]);
    assert_eq!(d[2].2, vec![Json::Null]);
}

#[test]
fn unpivot_is_row_major() {
    let f = frame(vec![
        ("id", SolType::Number, num(&[1.0, 2.0])),
        ("x", SolType::Number, num(&[10.0, 30.0])),
        ("y", SolType::Number, num(&[20.0, 40.0])),
    ]);
    let out = verb_unpivot(&f, &["id".into()], &["x".into(), "y".into()], &None, &None).unwrap();
    let d = dump(&out);
    assert_eq!(d[0].0, "id");
    assert_eq!(d[1].0, "variable");
    assert_eq!(d[2].0, "value");
    // row-major: id1/x, id1/y, id2/x, id2/y
    assert_eq!(d[0].2, j(&[1.0, 1.0, 2.0, 2.0]));
    assert_eq!(
        d[1].2,
        vec![
            Json::String("x".into()),
            Json::String("y".into()),
            Json::String("x".into()),
            Json::String("y".into())
        ]
    );
    assert_eq!(d[2].2, j(&[10.0, 20.0, 30.0, 40.0]));
}

#[test]
fn pivot_first_seen_with_missing_cells_null() {
    let f = frame(vec![
        ("row", SolType::Str, strs(&["a", "a", "b"])),
        ("col", SolType::Str, strs(&["x", "y", "x"])),
        ("val", SolType::Number, num(&[1.0, 2.0, 3.0])),
    ]);
    let out = verb_pivot(&f, "row", "col", "val", "sum").unwrap();
    let d = dump(&out);
    assert_eq!(d.iter().map(|c| c.0.clone()).collect::<Vec<_>>(), vec!["row", "x", "y"]);
    assert_eq!(d[0].2, vec![Json::String("a".into()), Json::String("b".into())]);
    assert_eq!(d[1].2, j(&[1.0, 3.0])); // x
    assert_eq!(d[2].2, vec![num_to_json(2.0), Json::Null]); // y missing for b
}

#[test]
fn join_inner_fans_out_and_drops_right_key() {
    let left = frame(vec![("id", SolType::Number, num(&[1.0, 2.0]))]);
    let right = frame(vec![
        ("fk", SolType::Number, num(&[1.0, 1.0])),
        ("v", SolType::Str, strs(&["x", "y"])),
    ]);
    let out = verb_join(
        &left,
        &right,
        &WireJoinOpts { left_key: "id".into(), right_key: "fk".into(), how: "inner".into() },
    )
    .unwrap();
    let d = dump(&out);
    assert_eq!(d.iter().map(|c| c.0.clone()).collect::<Vec<_>>(), vec!["id", "v"]);
    assert_eq!(d[0].2, j(&[1.0, 1.0]));
    assert_eq!(d[1].2, vec![Json::String("x".into()), Json::String("y".into())]);
}

#[test]
fn join_left_keeps_unmatched_with_null() {
    let left = frame(vec![("id", SolType::Number, num(&[1.0, 2.0]))]);
    let right = frame(vec![
        ("id", SolType::Number, num(&[1.0])),
        ("v", SolType::Str, strs(&["x"])),
    ]);
    let out = verb_join(
        &left,
        &right,
        &WireJoinOpts { left_key: "id".into(), right_key: "id".into(), how: "left".into() },
    )
    .unwrap();
    let d = dump(&out);
    assert_eq!(d.iter().map(|c| c.0.clone()).collect::<Vec<_>>(), vec!["id", "v"]);
    assert_eq!(d[0].2, j(&[1.0, 2.0]));
    assert_eq!(d[1].2, vec![Json::String("x".into()), Json::Null]);
}

#[test]
fn append_union_by_name_fills_missing() {
    let a = frame(vec![
        ("x", SolType::Number, num(&[1.0])),
        ("y", SolType::Number, num(&[2.0])),
    ]);
    let b = frame(vec![("y", SolType::Number, num(&[3.0]))]);
    let ha = register(a);
    let hb = register(b);
    let out = append_frames(&[ha, hb]).unwrap();
    let d = dump(&out);
    assert_eq!(d.iter().map(|c| c.0.clone()).collect::<Vec<_>>(), vec!["x", "y"]);
    assert_eq!(d[0].2, vec![num_to_json(1.0), Json::Null]);
    assert_eq!(d[1].2, j(&[2.0, 3.0]));
}

#[test]
fn append_rejects_type_conflict() {
    let a = frame(vec![("x", SolType::Number, num(&[1.0]))]);
    let b = frame(vec![("x", SolType::Str, strs(&["a"]))]);
    let ha = register(a);
    let hb = register(b);
    let err = append_frames(&[ha, hb]).unwrap_err();
    // IpcError serializes with a code; check via JSON
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "#TYPE!");
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
