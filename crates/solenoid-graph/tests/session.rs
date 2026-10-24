// [[C23]] calcModes
use solenoid_graph::session::{Entry, Mode, Rerun, Session};

#[test]
fn manual_mode_gates_an_edit_until_forced_or_rebuilding() {
    let mut s = Session::default();
    assert!(s.set_mode(Mode::Manual));
    assert!(!s.set_mode(Mode::Manual));
    assert_eq!(s.enter(Some("a"), false), Entry::Gated);
    assert!(s.dirty);
    s.begin_rebuild();
    assert_eq!(s.enter(None, false), Entry::Run);
    assert_eq!(s.exit(true), None);
    assert!(!s.dirty);
    assert!(s.end_rebuild());
    assert_eq!(s.enter(None, true), Entry::Run);
    s.exit(true);
    assert_eq!(s.enter(None, false), Entry::Gated);
    assert!(s.set_mode(Mode::Sketch));
    assert!(!s.dirty, "switching to sketch clears the pending flag");
}

#[test]
fn a_pass_in_flight_coalesces_requests_into_one_rerun() {
    let mut s = Session::default();
    assert_eq!(s.enter(Some("a"), false), Entry::Run);
    assert_eq!(s.enter(Some("b"), false), Entry::Queued);
    s.begin_force_exact();
    assert_eq!(s.enter(Some("b"), true), Entry::Queued);
    s.end_force_exact();
    assert_eq!(
        s.exit(true),
        Some(Rerun {
            force: true,
            exact: true,
            changed: vec!["b".into()]
        })
    );
    assert!(!s.pass_active);
    assert_eq!(s.exit(true), None);
}

#[test]
fn a_failed_pass_leaves_its_rerun_to_the_next() {
    let mut s = Session::default();
    s.enter(None, false);
    s.enter(None, false);
    assert_eq!(s.exit(false), None);
    s.enter(None, false);
    assert!(s.exit(true).is_some());
}

#[test]
fn depths_never_go_below_zero() {
    let mut s = Session::default();
    s.end_force_exact();
    assert_eq!(s.force_exact, 0);
    assert!(s.end_rebuild());
    s.mode = Mode::Sketch;
    assert!(s.sketch_active());
    s.begin_force_exact();
    assert!(!s.sketch_active());
}

#[test]
fn a_rebuild_scope_reports_a_cable_changed_inside_it() {
    let mut s = Session::default();
    s.mark_topo_dirty();
    s.open_rebuild_scope();
    assert!(s.rebuilding());
    assert_eq!(s.close_rebuild_scope(), (true, false));
    s.open_rebuild_scope();
    s.mark_topo_dirty();
    assert_eq!(s.close_rebuild_scope(), (true, true));
    assert_eq!(s.next_generation(), 1);
    assert_eq!(Mode::read("sketch"), Mode::Sketch);
    assert_eq!(Mode::read("nonsense"), Mode::Auto);
}
