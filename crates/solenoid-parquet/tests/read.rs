//! [[C130]] rustCore: a Parquet file reads as the frame Local File gives.
use std::sync::Arc;

use arrow_array::{
    ArrayRef, BooleanArray, Date32Array, Float64Array, Int64Array, RecordBatch, StringArray,
    TimestampMillisecondArray,
};
use parquet::arrow::ArrowWriter;
use serde_json::{json, Value as Json};

fn write(name: &str, columns: Vec<(&str, ArrayRef)>) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("solenoid_{name}_{}.parquet", std::process::id()));
    let batch = RecordBatch::try_from_iter(columns).unwrap();
    let mut w =
        ArrowWriter::try_new(std::fs::File::create(&path).unwrap(), batch.schema(), None).unwrap();
    w.write(&batch).unwrap();
    w.close().unwrap();
    path
}

fn read(path: &std::path::Path) -> Vec<Json> {
    let out = solenoid_parquet::read_wire(path);
    std::fs::remove_file(path).ok();
    out.unwrap()
}

#[test]
fn columns_keep_their_kind_and_dates_read_as_serials() {
    let path = write(
        "kinds",
        vec![
            (
                "n",
                Arc::new(Int64Array::from(vec![Some(1), None, Some(3)])) as ArrayRef,
            ),
            (
                "x",
                Arc::new(Float64Array::from(vec![0.5, f64::NAN, f64::INFINITY])) as ArrayRef,
            ),
            (
                "s",
                Arc::new(StringArray::from(vec![Some("a"), Some("b"), None])) as ArrayRef,
            ),
            (
                "b",
                Arc::new(BooleanArray::from(vec![true, false, true])) as ArrayRef,
            ),
            (
                "d",
                Arc::new(Date32Array::from(vec![19000, 19001, 19002])) as ArrayRef,
            ),
            (
                "t",
                Arc::new(TimestampMillisecondArray::from(vec![
                    0, 43_200_000, 86_400_000,
                ])) as ArrayRef,
            ),
        ],
    );
    assert_eq!(
        read(&path),
        vec![
            json!({ "name": "n", "type": "number", "values": [1, null, 3] }),
            json!({ "name": "x", "type": "number", "values": [0.5, { "__nf": "nan" }, { "__nf": "inf" }] }),
            json!({ "name": "s", "type": "string", "values": ["a", "b", null] }),
            json!({ "name": "b", "type": "logical", "values": [true, false, true] }),
            json!({ "name": "d", "type": "date", "values": [44569, 44570, 44571] }),
            json!({ "name": "t", "type": "date", "values": [25569, 25569.5, 25570] }),
        ]
    );
}

#[test]
fn a_missing_file_is_a_ref_error() {
    let err = solenoid_parquet::read(std::path::Path::new("__solenoid_does_not_exist__.parquet"))
        .unwrap_err();
    assert_eq!(err.code.as_str(), "#REF!");
}
