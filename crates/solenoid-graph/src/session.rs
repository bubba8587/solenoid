// [[C23]] calcModes, [[D46]] freezeVolatilePerCalc, [[D79]] effectsEdgeTriggered
//! The compute pass's state between passes (`tree/specs/computation/compute-pass.md` § Entry order, § Calc modes and
//! the dirty flag, § Volatile nodes and the recalc generation, § Rebuild scopes): the calc mode, the dirty flag, the
//! force-exact depth, the recalc generation, the rebuild depth and its topology flag, and the single-flight flags with
//! the rerun a pass in flight coalesces. The host calls the transitions and keeps the snapshot they answer.

/// The calculation mode, per browser.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Mode {
    #[default]
    Auto,
    Manual,
    Sketch,
}

impl Mode {
    /// `"manual"` and `"sketch"`; anything else is automatic.
    pub fn read(s: &str) -> Mode {
        match s {
            "manual" => Mode::Manual,
            "sketch" => Mode::Sketch,
            _ => Mode::Auto,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Mode::Auto => "auto",
            Mode::Manual => "manual",
            Mode::Sketch => "sketch",
        }
    }
}

/// What a request for a pass does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Entry {
    /// Manual mode dropped it: the graph is dirty, and the edit still saves.
    Gated,
    /// A pass is running: it reruns once it ends.
    Queued,
    /// It runs now.
    Run,
}

/// The one full pass a finished pass owes the requests it coalesced.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Rerun {
    /// Some coalesced request was forced (F9), so the manual gate must not swallow it.
    pub force: bool,
    /// Some coalesced request was made inside a force-exact bracket (F9 in sketch).
    pub exact: bool,
    /// The coalesced requests' changed nodes, each once, in order: one inside a composite marks its chain.
    pub changed: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Session {
    pub mode: Mode,
    pub dirty: bool,
    pub force_exact: u32,
    pub recalc_gen: u64,
    pub rebuilding: u32,
    pub topo_dirty: bool,
    pub pass_active: bool,
    pub rerun: Option<Rerun>,
}

impl Session {
    /// `false`, and nothing changes, when `m` is the mode already. Automatic and sketch clear the dirty flag; the
    /// caller owes the catch-up pass.
    pub fn set_mode(&mut self, m: Mode) -> bool {
        if self.mode == m {
            return false;
        }
        self.mode = m;
        if m != Mode::Manual {
            self.dirty = false;
        }
        true
    }

    /// Sets the dirty flag; `true` on a transition.
    pub fn mark_dirty(&mut self) -> bool {
        !std::mem::replace(&mut self.dirty, true)
    }

    /// Clears the dirty flag; `true` on a transition.
    pub fn clear_dirty(&mut self) -> bool {
        std::mem::replace(&mut self.dirty, false)
    }

    pub fn begin_force_exact(&mut self) {
        self.force_exact += 1;
    }

    /// Never below zero.
    pub fn end_force_exact(&mut self) {
        self.force_exact = self.force_exact.saturating_sub(1);
    }

    /// Sketch is selected and no pass is forced exact: the frame layer samples.
    pub fn sketch_active(&self) -> bool {
        self.mode == Mode::Sketch && self.force_exact == 0
    }

    /// F9 and every "roll everything" entry: a new generation for the volatile nodes.
    pub fn next_generation(&mut self) -> u64 {
        self.recalc_gen += 1;
        self.recalc_gen
    }

    pub fn begin_rebuild(&mut self) {
        self.rebuilding += 1;
    }

    /// Never below zero; `true` when no scope is open after it, so what a scope held back can be applied.
    pub fn end_rebuild(&mut self) -> bool {
        self.rebuilding = self.rebuilding.saturating_sub(1);
        self.rebuilding == 0
    }

    pub fn rebuilding(&self) -> bool {
        self.rebuilding > 0
    }

    /// `withGraphRebuild`'s scope opens with no cable changed yet.
    pub fn open_rebuild_scope(&mut self) {
        self.topo_dirty = false;
        self.begin_rebuild();
    }

    /// Closes the scope; `true` when a cable changed inside it, so one settle is owed.
    pub fn close_rebuild_scope(&mut self) -> (bool, bool) {
        let outermost = self.end_rebuild();
        (outermost, std::mem::replace(&mut self.topo_dirty, false))
    }

    pub fn mark_topo_dirty(&mut self) {
        self.topo_dirty = true;
    }

    /// The entry order's first two steps: the calc-mode gate, then single flight.
    pub fn enter(&mut self, changed: Option<&str>, force: bool) -> Entry {
        if self.mode == Mode::Manual && !force && !self.rebuilding() {
            self.mark_dirty();
            return Entry::Gated;
        }
        if self.pass_active {
            let exact = self.force_exact > 0;
            let rerun = self.rerun.get_or_insert_with(Rerun::default);
            rerun.force |= force;
            rerun.exact |= exact;
            if let Some(id) = changed {
                if !rerun.changed.iter().any(|c| c == id) {
                    rerun.changed.push(id.to_owned());
                }
            }
            return Entry::Queued;
        }
        self.pass_active = true;
        Entry::Run
    }

    /// The pass ended: a finished pass clears the dirty flag and hands back the rerun it owes; a failed one owes it
    /// to the next pass that finishes.
    pub fn exit(&mut self, finished: bool) -> Option<Rerun> {
        self.pass_active = false;
        if !finished {
            return None;
        }
        self.dirty = false;
        self.rerun.take()
    }
}
