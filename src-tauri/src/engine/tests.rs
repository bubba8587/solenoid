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
fn join_inner_fans_out_and_drops_right_key() {
    let left = frame(vec![("id", SolType::Number, num(&[1.0, 2.0]))]);
    let right = frame(vec![
        ("fk", SolType::Number, num(&[1.0, 1.0])),
        ("v", SolType::Str, strs(&["x", "y"])),
    ]);
    let out = verb_join(
        &left,
        &right,
        &WireJoinOpts { left_key: "id".into(), right_key: "fk".into(), how: "inner".into(), ..Default::default() },
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
        &WireJoinOpts { left_key: "id".into(), right_key: "id".into(), how: "left".into(), ..Default::default() },
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

#[test]
fn group_by_extended_ops_match_oracle() {
    // product/median/mode/stdev/stdevp/var/varp were `_ => Cell::Null` — every
    // one the node UI offers must produce the oracle's numbers (audit P0-3).
    let f = frame(vec![
        ("k", SolType::Str, strs(&["a", "a", "a", "a"])),
        ("v", SolType::Number, num(&[2.0, 4.0, 4.0, 8.0])),
    ]);
    let ops = ["product", "median", "mode", "stdev", "stdevp", "var", "varp"];
    let aggs: Vec<WireAgg> = ops
        .iter()
        .map(|op| WireAgg { column: "v".into(), op: (*op).into(), as_name: (*op).into() })
        .collect();
    let out = verb_group_by(&f, &["k".into()], &aggs).unwrap();
    let d = dump(&out);
    let got = |i: usize| -> f64 {
        match &d[i + 1].2[0] {
            Json::Number(n) => n.as_f64().unwrap(),
            other => panic!("op {} returned {:?}, not a number", ops[i], other),
        }
    };
    let var_s: f64 = 19.0 / 3.0; // mean 4.5, ss 19
    assert_eq!(got(0), 256.0); // product
    assert_eq!(got(1), 4.0); // median, even count: (4+4)/2
    assert_eq!(got(2), 4.0); // mode
    assert!((got(3) - var_s.sqrt()).abs() < 1e-12); // stdev (sample)
    assert!((got(4) - 4.75f64.sqrt()).abs() < 1e-12); // stdevp
    assert!((got(5) - var_s).abs() < 1e-12); // var (sample)
    assert_eq!(got(6), 4.75); // varp
}

#[test]
fn group_by_extended_op_edges_match_oracle() {
    // Odd-count median; mode tie breaks to FIRST occurrence; a single-point
    // group: sample stdev/var undefined (null), population variants 0.
    let f = frame(vec![
        ("k", SolType::Str, strs(&["a", "a", "a", "b"])),
        ("v", SolType::Number, num(&[7.0, 3.0, 5.0, 9.0])),
    ]);
    let ops = ["median", "mode", "stdev", "var", "stdevp", "varp"];
    let aggs: Vec<WireAgg> = ops
        .iter()
        .map(|op| WireAgg { column: "v".into(), op: (*op).into(), as_name: (*op).into() })
        .collect();
    let out = verb_group_by(&f, &["k".into()], &aggs).unwrap();
    let d = dump(&out);
    assert_eq!(d[1].2[0], num_to_json(5.0)); // median of [7,3,5]
    assert_eq!(d[2].2[0], num_to_json(7.0)); // mode tie → first occurrence
    assert_eq!(d[3].2[1], Json::Null); // stdev of one point
    assert_eq!(d[4].2[1], Json::Null); // var of one point
    assert_eq!(d[5].2[1], num_to_json(0.0)); // stdevp of one point
    assert_eq!(d[6].2[1], num_to_json(0.0)); // varp of one point
}

#[test]
fn group_by_empty_group_product_is_one() {
    let f = frame(vec![
        ("k", SolType::Str, strs(&["a"])),
        ("v", SolType::Number, vec![Cell::Null]),
    ]);
    let aggs = vec![WireAgg { column: "v".into(), op: "product".into(), as_name: "p".into() }];
    let out = verb_group_by(&f, &["k".into()], &aggs).unwrap();
    assert_eq!(dump(&out)[1].2, vec![num_to_json(1.0)]);
}

#[test]
fn group_by_logical_column_aggregates_as_zero_one() {
    // Booleans coerce to 1/0 on both engines (audit finding 17): SUM over a
    // logical column = count of TRUEs, AVG = share of TRUEs.
    let f = frame(vec![
        ("k", SolType::Str, strs(&["a", "a", "a"])),
        (
            "flag",
            SolType::Logical,
            vec![Cell::Bool(true), Cell::Bool(false), Cell::Bool(true)],
        ),
    ]);
    let aggs = vec![
        WireAgg { column: "flag".into(), op: "sum".into(), as_name: "s".into() },
        WireAgg { column: "flag".into(), op: "avg".into(), as_name: "m".into() },
    ];
    let out = verb_group_by(&f, &["k".into()], &aggs).unwrap();
    let d = dump(&out);
    assert_eq!(d[1].2, vec![num_to_json(2.0)]);
    assert_eq!(d[2].2, vec![num_to_json(2.0 / 3.0)]);
}

#[test]
fn join_right_labels_columns_correctly() {
    // Audit finding 4 (pin before fixing): Polars with CoalesceColumns emits a
    // DIFFERENT column order for a right join (coalesced key after left non-key
    // columns), and the positional rename then puts values under wrong headers.
    let left = frame(vec![
        ("k", SolType::Number, num(&[1.0, 2.0])),
        ("qty", SolType::Number, num(&[10.0, 20.0])),
    ]);
    let right = frame(vec![
        ("ck", SolType::Number, num(&[2.0, 3.0])),
        ("name", SolType::Str, strs(&["b", "c"])),
    ]);
    let opts = WireJoinOpts {
        left_key: "k".into(),
        right_key: "ck".into(),
        how: "right".into(),
        ..Default::default()
    };
    let out = verb_join(&left, &right, &opts).unwrap();
    let d = dump(&out);
    assert_eq!(d[0].0, "k");
    assert_eq!(d[1].0, "qty");
    assert_eq!(d[2].0, "name");
    // Locate rows by key value (row order asserted separately) and check every
    // value sits under the right header.
    let key_at = |v: f64| d[0].2.iter().position(|c| *c == num_to_json(v)).unwrap_or_else(|| panic!("key {v} missing from {:?}", d[0].2));
    let r2 = key_at(2.0);
    let r3 = key_at(3.0);
    assert_eq!(d[1].2[r2], num_to_json(20.0)); // qty of key 2
    assert_eq!(d[2].2[r2], Json::String("b".into())); // name of key 2
    assert_eq!(d[1].2[r3], Json::Null); // key 3 unmatched on the left
    assert_eq!(d[2].2[r3], Json::String("c".into()));
    // types must follow the names, not the positions (key stayed Number, name Str)
    assert_eq!(d[2].1, "string");
}

#[test]
fn join_row_order_matches_oracle() {
    // Audit finding 15: the oracle guarantees strict driving-side row order with
    // grouped fan-out; Polars needs maintain_order set to promise the same.
    let left = frame(vec![
        ("k", SolType::Number, num(&[3.0, 1.0, 2.0, 1.0])),
        ("l", SolType::Number, num(&[30.0, 10.0, 20.0, 11.0])),
    ]);
    let right = frame(vec![
        ("k", SolType::Number, num(&[1.0, 2.0, 1.0])),
        ("r", SolType::Number, num(&[100.0, 200.0, 101.0])),
    ]);
    let opts = WireJoinOpts { left_key: "k".into(), right_key: "k".into(), how: "left".into(), ..Default::default() };
    let out = verb_join(&left, &right, &opts).unwrap();
    let d = dump(&out);
    // Oracle order: left rows in order, each fanning out over its right matches
    // in right-row order: 3→(null), 1→(100,101), 2→(200), 1→(100,101).
    assert_eq!(d[1].2, j(&[30.0, 10.0, 10.0, 20.0, 11.0, 11.0]));
    assert_eq!(
        d[2].2,
        vec![Json::Null, num_to_json(100.0), num_to_json(101.0), num_to_json(200.0), num_to_json(100.0), num_to_json(101.0)]
    );
}

// ─── as-of join (prices/trades: every left row kept, nearest right by time) ─────
fn asof_fixture() -> (SolFrame, SolFrame) {
    // trades at t = -1 (before any quote), 1, 5, 10, 20 (after every quote)
    let trades = frame(vec![("t", SolType::Number, num(&[-1.0, 1.0, 5.0, 10.0, 20.0]))]);
    // quotes at t = 0, 2, 4, 8, 12 with a distinguishing value
    let quotes = frame(vec![
        ("t", SolType::Number, num(&[0.0, 2.0, 4.0, 8.0, 12.0])),
        ("px", SolType::Number, num(&[100.0, 101.0, 102.0, 103.0, 104.0])),
    ]);
    (trades, quotes)
}

fn asof_opts(direction: &str) -> WireJoinOpts {
    WireJoinOpts {
        left_key: "t".into(),
        right_key: "t".into(),
        how: "asof".into(),
        asof_direction: Some(direction.to_string()),
        ..Default::default()
    }
}

#[test]
fn join_asof_backward_keeps_every_left_row_latest_leq() {
    let (trades, quotes) = asof_fixture();
    let out = verb_join(&trades, &quotes, &asof_opts("backward")).unwrap();
    let d = dump(&out);
    assert_eq!(d[0].0, "t");
    assert_eq!(d[0].2, j(&[-1.0, 1.0, 5.0, 10.0, 20.0])); // original LEFT order preserved
    assert_eq!(d[1].2, vec![Json::Null, num_to_json(100.0), num_to_json(102.0), num_to_json(103.0), num_to_json(104.0)]);
}

#[test]
fn join_asof_forward_earliest_geq() {
    let (trades, quotes) = asof_fixture();
    let out = verb_join(&trades, &quotes, &asof_opts("forward")).unwrap();
    let d = dump(&out);
    assert_eq!(d[1].2, vec![num_to_json(100.0), num_to_json(101.0), num_to_json(103.0), num_to_json(104.0), Json::Null]);
}

#[test]
fn join_asof_nearest_ties_favor_backward() {
    let (trades, quotes) = asof_fixture();
    let out = verb_join(&trades, &quotes, &asof_opts("nearest")).unwrap();
    let d = dump(&out);
    // t=-1: only forward (0) exists -> 100. t=1: |1-0|=|1-2|=1 tie -> backward (100).
    // t=5: |5-4|=1 < |5-8|=3 -> backward (102). t=10: |10-8|=|10-12|=2 tie -> backward (103).
    // t=20: only backward (12) exists -> 104.
    assert_eq!(d[1].2, vec![num_to_json(100.0), num_to_json(100.0), num_to_json(102.0), num_to_json(103.0), num_to_json(104.0)]);
}

#[test]
fn join_asof_tolerance_excludes_far_matches() {
    let (trades, quotes) = asof_fixture();
    let mut opts = asof_opts("backward");
    opts.asof_tolerance = Some(1.0);
    let out = verb_join(&trades, &quotes, &opts).unwrap();
    let d = dump(&out);
    // t=5's backward match (t=4) is within tolerance (diff 1); t=10's (t=8, diff 2) is not.
    assert_eq!(d[1].2, vec![Json::Null, num_to_json(100.0), num_to_json(102.0), Json::Null, Json::Null]);
}

#[test]
fn join_asof_rejects_non_orderable_key() {
    let left = frame(vec![("k", SolType::Str, strs(&["a"]))]);
    let right = frame(vec![("k", SolType::Str, strs(&["a"])), ("v", SolType::Number, num(&[1.0]))]);
    let opts = WireJoinOpts { left_key: "k".into(), right_key: "k".into(), how: "asof".into(), ..Default::default() };
    let err = verb_join(&left, &right, &opts).unwrap_err();
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "#VALUE!");
}

#[test]
fn filter_value_coercion_matches_oracle() {
    // Audit finding 16: "1,234" no longer comma-strips to 1234 (unparseable →
    // keeps NOTHING, even for neq); a logical column accepts "false"; numeric
    // values parse after a trim.
    let f = frame(vec![
        ("v", SolType::Number, num(&[1000.0, 1234.0])),
        (
            "flag",
            SolType::Logical,
            vec![Cell::Bool(true), Cell::Bool(false)],
        ),
    ]);
    let kept = |o: &SolFrame| o.df.height();
    assert_eq!(kept(&verb_filter(&f, "v", "eq", &Json::String("1,234".into())).unwrap()), 0);
    assert_eq!(kept(&verb_filter(&f, "v", "neq", &Json::String("garbage".into())).unwrap()), 0);
    assert_eq!(kept(&verb_filter(&f, "v", "gt", &Json::String(" 1100 ".into())).unwrap()), 1);
    assert_eq!(kept(&verb_filter(&f, "flag", "eq", &Json::String("false".into())).unwrap()), 1);
    assert_eq!(kept(&verb_filter(&f, "flag", "eq", &Json::String("TRUE".into())).unwrap()), 1);
}

#[test]
fn group_by_agg_name_collision_dedupes() {
    // "count of k grouped by k" — the agg output name collides with the key;
    // both engines now makeHeaders-dedupe instead of erroring/duplicating
    // (audit finding 32).
    let f = frame(vec![
        ("k", SolType::Str, strs(&["a", "b", "a"])),
        ("v", SolType::Number, num(&[1.0, 2.0, 3.0])),
    ]);
    let aggs = vec![WireAgg { column: "v".into(), op: "count".into(), as_name: "k".into() }];
    let out = verb_group_by(&f, &["k".into()], &aggs).unwrap();
    let d = dump(&out);
    assert_eq!(d[0].0, "k");
    assert_eq!(d[1].0, "k2");
    assert_eq!(d[1].2, j(&[2.0, 1.0]));
}

#[test]
fn select_duplicate_names_keeps_first() {
    let f = frame(vec![
        ("a", SolType::Number, num(&[1.0])),
        ("b", SolType::Number, num(&[2.0])),
    ]);
    let out = verb_select(&f, &["a".into(), "a".into(), "b".into()]).unwrap();
    assert_eq!(dump(&out).len(), 2);
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
        WireOp::Filter { column: "qty".into(), op: "gt".into(), value: serde_json::json!(15) },
        WireOp::Sort { by: "qty".into(), dir: "asc".into() },
    ];
    let fused = apply_ops(&f, &ops).unwrap();

    let step1 = verb_select(&f, &["qty".into(), "region".into()]).unwrap();
    let step2 = verb_filter(&step1, "qty", "gt", &serde_json::json!(15)).unwrap();
    let sequential = verb_sort(&step2, "qty", "asc").unwrap();

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
        WireOp::Filter { column: "s".into(), op: "startsWith".into(), value: serde_json::json!("ap") },
        WireOp::Sort { by: "n".into(), dir: "asc".into() },
    ];
    let fused = apply_ops(&f, &ops).unwrap();
    assert_eq!(
        dump(&fused)[0].2,
        vec![Json::String("apricot".into()), Json::String("apple".into())]
    );
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
        WireOp::Filter { column: "qty".into(), op: "gte".into(), value: serde_json::json!(20) },
        WireOp::Sort { by: "qty".into(), dir: "desc".into() },
    ];
    let h_out_many = engine_apply_many(h_many, ops).unwrap();

    let h_seq = register(f);
    let h_step1 = engine_apply(h_seq, WireOp::Filter { column: "qty".into(), op: "gte".into(), value: serde_json::json!(20) }).unwrap();
    let h_out_seq = engine_apply(h_step1, WireOp::Sort { by: "qty".into(), dir: "desc".into() }).unwrap();

    let p_many = with_frame(&h_out_many, |f| Ok(preview_of(f, 10))).unwrap();
    let p_seq = with_frame(&h_out_seq, |f| Ok(preview_of(f, 10))).unwrap();
    assert_eq!(p_many.rows, p_seq.rows);
    assert_eq!(p_many.rows, vec![vec![Json::String("N".into()), num_to_json(30.0)], vec![Json::String("S".into()), num_to_json(20.0)]]);
}
