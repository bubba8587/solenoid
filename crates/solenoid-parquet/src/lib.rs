// [[C130]] rustCore
//! The desktop's Parquet reader (Local File): a file's columns as the core's frame, on Apache's `parquet` and
//! `arrow` crates. Desktop only; the web has no files to read.

use std::fs::File;
use std::path::{Component, Path, PathBuf};

use arrow_array::cast::AsArray;
use arrow_array::types::{
    Date32Type, Date64Type, Float64Type, TimestampMicrosecondType, TimestampMillisecondType,
    TimestampNanosecondType, TimestampSecondType,
};
use arrow_array::{Array, ArrayRef};
use arrow_schema::{DataType, TimeUnit};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use serde_json::Value as Json;
use solenoid_core::error_value::{sol_error, ErrorCode, SolError};
use solenoid_core::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};
use solenoid_core::wire::column_to_wire;

/// Serial 1 is 1900-01-01, so the Unix epoch is serial 25569.
const UNIX_EPOCH_SERIAL: f64 = 25569.0;

/// `folder/name` read whole: a Boolean column is logical, text is string, a `Date` or `Timestamp` is a date serial
/// (a timestamp's time of day as the fraction), a dictionary its values' kind, and any other column a number column
/// when every value casts to one. A column's kind comes from the schema, so an empty file keeps it.
pub fn read(path: &Path) -> Result<FrameValue, SolError> {
    let file = File::open(path).map_err(|e| {
        sol_error(
            ErrorCode::Ref,
            format!("couldn't open \"{}\": {e}", path.display()),
        )
    })?;
    let failed = |e: &dyn std::fmt::Display| {
        sol_error(
            ErrorCode::Error,
            format!("The Parquet file can't be read: {e}"),
        )
    };
    let builder = ParquetRecordBatchReaderBuilder::try_new(file).map_err(|e| failed(&e))?;
    let schema = builder.schema().clone();
    let mut cells: Vec<Vec<FrameCell>> = vec![Vec::new(); schema.fields().len()];
    let mut types = schema
        .fields()
        .iter()
        .map(|f| {
            append_cells(
                &mut Vec::new(),
                &arrow_array::new_empty_array(f.data_type()),
                f.name(),
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    for batch in builder.build().map_err(|e| failed(&e))? {
        let batch = batch.map_err(|e| failed(&e))?;
        for (k, field) in schema.fields().iter().enumerate() {
            types[k] = append_cells(&mut cells[k], batch.column(k), field.name())?;
        }
    }
    let columns = schema
        .fields()
        .iter()
        .zip(types)
        .zip(cells)
        .map(|((f, ty), values)| FrameColumn::new(f.name().as_str(), ty, values))
        .collect();
    Ok(FrameValue { columns })
}

/// The frame as the app reads it off IPC: wire columns (`wire.rs`).
pub fn read_wire(path: &Path) -> Result<Vec<Json>, SolError> {
    Ok(read(path)?.columns.iter().map(column_to_wire).collect())
}

/// `name` in `folder`, refused (`#REF!`) unless every part of it is a plain name and the file, symlinks resolved,
/// stays inside the folder: a document names the file, so it must not reach `..`, an absolute path or a network
/// share.
pub fn inside(folder: &Path, name: &str) -> Result<PathBuf, SolError> {
    let outside = || {
        sol_error(
            ErrorCode::Ref,
            format!("\"{name}\" isn't inside the data folder"),
        )
    };
    let parts = Path::new(name).components();
    if name.is_empty() || parts.clone().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(outside());
    }
    let path = folder.join(name);
    if let (Ok(real), Ok(root)) = (path.canonicalize(), folder.canonicalize()) {
        if !real.starts_with(root) {
            return Err(outside());
        }
    }
    Ok(path)
}

fn append_cells(
    out: &mut Vec<FrameCell>,
    a: &ArrayRef,
    name: &str,
) -> Result<FrameColType, SolError> {
    let each = |out: &mut Vec<FrameCell>, f: &dyn Fn(usize) -> FrameCell| {
        out.extend((0..a.len()).map(|i| if a.is_null(i) { FrameCell::Null } else { f(i) }))
    };
    let serial = |out: &mut Vec<FrameCell>, f: &dyn Fn(usize) -> f64| {
        each(out, &|i| FrameCell::Num(f(i) + UNIX_EPOCH_SERIAL))
    };
    match a.data_type() {
        DataType::Dictionary(_, value) => {
            let a = arrow_cast::cast(a, value).map_err(|e| unreadable(name, &e))?;
            append_cells(out, &a, name)
        }
        DataType::Boolean => {
            let b = a.as_boolean();
            each(out, &|i| FrameCell::Bool(b.value(i)));
            Ok(FrameColType::Logical)
        }
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => {
            let s = arrow_cast::cast(a, &DataType::Utf8).map_err(|e| unreadable(name, &e))?;
            let s = s.as_string::<i32>();
            each(out, &|i| FrameCell::str(s.value(i)));
            Ok(FrameColType::String)
        }
        DataType::Date32 => {
            let d = a.as_primitive::<Date32Type>();
            serial(out, &|i| d.value(i) as f64);
            Ok(FrameColType::Date)
        }
        DataType::Date64 => {
            let d = a.as_primitive::<Date64Type>();
            serial(out, &|i| d.value(i) as f64 / 86_400_000.0);
            Ok(FrameColType::Date)
        }
        DataType::Timestamp(unit, _) => {
            let days = |v: i64, per_day: f64| v as f64 / per_day;
            match unit {
                TimeUnit::Second => {
                    let t = a.as_primitive::<TimestampSecondType>();
                    serial(out, &|i| days(t.value(i), 86_400.0))
                }
                TimeUnit::Millisecond => {
                    let t = a.as_primitive::<TimestampMillisecondType>();
                    serial(out, &|i| days(t.value(i), 86_400_000.0))
                }
                TimeUnit::Microsecond => {
                    let t = a.as_primitive::<TimestampMicrosecondType>();
                    serial(out, &|i| days(t.value(i), 86_400_000_000.0))
                }
                TimeUnit::Nanosecond => {
                    let t = a.as_primitive::<TimestampNanosecondType>();
                    serial(out, &|i| days(t.value(i), 86_400_000_000_000.0))
                }
            }
            Ok(FrameColType::Date)
        }
        _ => {
            let strict = arrow_cast::CastOptions {
                safe: false,
                ..Default::default()
            };
            let n: ArrayRef = arrow_cast::cast_with_options(a, &DataType::Float64, &strict)
                .map_err(|e| unreadable(name, &e))?;
            let f = n.as_primitive::<Float64Type>();
            out.extend((0..n.len()).map(|i| {
                if n.is_null(i) {
                    FrameCell::Null
                } else {
                    FrameCell::Num(f.value(i))
                }
            }));
            Ok(FrameColType::Number)
        }
    }
}

fn unreadable(name: &str, e: &dyn std::fmt::Display) -> SolError {
    sol_error(
        ErrorCode::Value,
        format!("Column \"{name}\" holds values Solenoid can't read as a table column: {e}"),
    )
}
