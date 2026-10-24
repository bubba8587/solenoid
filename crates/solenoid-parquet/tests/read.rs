//! [[C130]] rustCore: a Parquet file reads as the frame Local File gives.
use std::sync::Arc;

use arrow_array::types::Int32Type;
use arrow_array::{
    ArrayRef, BinaryArray, BooleanArray, Date32Array, DictionaryArray, Float64Array, Int64Array,
    RecordBatch, StringArray, TimestampMillisecondArray,
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

#[test]
fn a_dictionary_column_reads_as_its_values() {
    let dict: DictionaryArray<Int32Type> = vec![Some("red"), None, Some("red"), Some("blue")]
        .into_iter()
        .collect();
    let path = write("dict", vec![("c", Arc::new(dict) as ArrayRef)]);
    assert_eq!(
        read(&path),
        vec![json!({ "name": "c", "type": "string", "values": ["red", null, "red", "blue"] })]
    );
}

#[test]
fn an_empty_file_keeps_its_column_kinds() {
    let path = write(
        "empty",
        vec![
            (
                "s",
                Arc::new(StringArray::from(Vec::<&str>::new())) as ArrayRef,
            ),
            (
                "b",
                Arc::new(BooleanArray::from(Vec::<bool>::new())) as ArrayRef,
            ),
        ],
    );
    assert_eq!(
        read(&path),
        vec![
            json!({ "name": "s", "type": "string", "values": [] }),
            json!({ "name": "b", "type": "logical", "values": [] }),
        ]
    );
}

#[test]
fn a_column_that_wont_cast_is_a_value_error_naming_it() {
    let path = write(
        "binary",
        vec![(
            "raw",
            Arc::new(BinaryArray::from(vec![&b"\xff\xfe"[..]])) as ArrayRef,
        )],
    );
    let err = solenoid_parquet::read(&path).unwrap_err();
    std::fs::remove_file(&path).ok();
    assert_eq!(err.code.as_str(), "#VALUE!");
    assert!(err.message.contains("\"raw\""), "{}", err.message);
}

#[test]
fn a_name_outside_the_folder_is_refused() {
    let root = std::env::temp_dir().join(format!("solenoid_inside_{}", std::process::id()));
    std::fs::create_dir_all(root.join("sub")).unwrap();
    for name in [
        "",
        "../x.parquet",
        "/etc/x.parquet",
        "sub/../../x.parquet",
        "./x.parquet",
    ] {
        let err = solenoid_parquet::inside(&root, name).unwrap_err();
        assert_eq!(err.code.as_str(), "#REF!", "{name}");
    }
    assert_eq!(
        solenoid_parquet::inside(&root, "a.parquet").unwrap(),
        root.join("a.parquet")
    );
    assert_eq!(
        solenoid_parquet::inside(&root, "sub/a.parquet").unwrap(),
        root.join("sub/a.parquet")
    );
    #[cfg(unix)]
    {
        let away =
            std::env::temp_dir().join(format!("solenoid_away_{}.parquet", std::process::id()));
        std::fs::write(&away, b"x").unwrap();
        std::os::unix::fs::symlink(&away, root.join("link.parquet")).unwrap();
        assert!(solenoid_parquet::inside(&root, "link.parquet").is_err());
        std::fs::remove_file(&away).ok();
    }
    std::fs::remove_dir_all(&root).ok();
}
