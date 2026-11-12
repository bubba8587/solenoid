// [[C130]] rustCore, [[engineering#Performance]] linearWork
//! Heap allocations each added row costs a formula, counted by a global allocator that wraps the system's. For
//! comparing a change, not a gate: `cargo test --test alloc_probe -- --ignored --nocapture`.
use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};

struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static BYTES: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        BYTES.fetch_add(l.size(), Relaxed);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Relaxed);
        BYTES.fetch_add(n, Relaxed);
        unsafe { System.realloc(p, l, n) }
    }
}
#[global_allocator]
static A: Counting = Counting;

#[test]
#[ignore]
fn allocations_per_row() {
    const N: usize = 20_000;
    for src in [
        "SUM(l)",
        "ROUND(l * 1.07 + 3, 2)",
        "IF(l > 0, l, 0)",
        "MAP(l, LAMBDA(x, ROUND(x * 1.07 + 3, 2)))",
        "MAP(l, LAMBDA(x, IF(x > 0, MAX(x, 1), MIN(x, -1))))",
        "BYROW(l, LAMBDA(r, SUM(r)))",
        "SCAN(0, l, LAMBDA(a, x, a + x))",
        "MAP(l, LAMBDA(x, LET(y, x * 2, y + 1)))",
        "MAP(t, LAMBDA(x, UPPER(LEFT(x, 3))))",
        "UPPER(t)",
    ] {
        let mut per = Vec::new();
        for n in [N, 2 * N] {
            let mut env = Env::default();
            env.insert("l".into(), V::List(Vec::from_fn(n, |i| V::Num(i as f64 - 7.5)).into()));
            env.insert("t".into(), V::List(Vec::from_fn(n, |i| V::str(&format!("item {i}"))).into()));
            let (a, b) = (ALLOCS.load(Relaxed), BYTES.load(Relaxed));
            std::hint::black_box(formula(src, env));
            per.push((ALLOCS.load(Relaxed) - a, BYTES.load(Relaxed) - b));
        }
        // The slope between two sizes, so what is paid once per formula cancels.
        let allocs = (per[1].0 as f64 - per[0].0 as f64) / N as f64;
        let bytes = (per[1].1 as f64 - per[0].1 as f64) / N as f64;
        println!("{allocs:6.2} allocs/row {bytes:8.1} bytes/row  ({} then {} allocs)  {src}", per[0].0, per[1].0);
    }
}
