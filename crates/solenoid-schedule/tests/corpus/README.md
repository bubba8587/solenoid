# Schedule corpus

Read by `tests/files.rs`, and by Solenoid's plan-import tests.

- `*.mspdi.xml`: Project-shaped MSPDI files. `authored-*` were written by hand to the pj14
  schema with the stored dates worked out on paper (Project's Days semantics: FS lag 0 means
  the next working day; a finish is the last working day). A file exported from desktop Project
  goes here too, named `project-*`, with its stored dates left in: `read_mspdi` returns them as
  `golden` and the test diffs the engine against them.
- `divergences.json`: files and fields where the engine is known to disagree with Project,
  each with a reason, so a disagreement is triaged rather than hidden.

No file here is redistributed from another project's corpus.
