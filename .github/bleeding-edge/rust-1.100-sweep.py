#!/usr/bin/env python3
"""The mechanical half of the Rust 1.100 findings (tree/specs/bleeding-edge/rust-1-100.md), run again on any tree:

    python3 .github/bleeding-edge/rust-1.100-sweep.py            rewrite, compile, put back what the compiler refuses
    python3 .github/bleeding-edge/rust-1.100-sweep.py --dry-run  count the sites and change nothing

It rewrites five spellings in every crate, each to the std call 1.100 stabilized for it:

    (0..n).map(f).collect()             Vec::from_fn(n, f)
    s.strip_prefix(p).unwrap_or(s)      s.trim_prefix(p)        (and strip_suffix)
    x = !x                              x.toggle()
    Box::new(f(*b))                     Box::map(b, f)
    Ok::<_, std::convert::Infallible>   Ok::<_, !>

A rewrite is only a spelling: each new call is defined as the old expression, so no answer moves. Where the old form
meant something the new one can't say (a u32 range, a Box<[T]> target, a closure that borrows what the length reads),
the compiler refuses it, and the site goes back as it was. The crates are then formatted. DropGuard is not here: its
sites are picked by hand. Needs a toolchain at 1.100 or newer and a clean tree."""
import os, re, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
os.chdir(ROOT)
DRY = "--dry-run" in sys.argv
CRATES = ["solenoid-schedule", "solenoid-parquet", "solenoid-core", "solenoid-graph"]
ENV = {**os.environ, "CARGO_TARGET_DIR": os.environ.get("SOLENOID_CHECK_TARGET", os.path.expanduser("~/.cache/solenoid-check")),
       "CARGO_INCREMENTAL": "0", "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0"}
CHAR = re.compile(r"'(\\.[^']*|[^'\\])'")


def balanced(s, i):
    """s[i] opens a bracket: the index after its match, with strings and chars skipped."""
    depth = 0
    while i < len(s):
        c = s[i]
        if c == '"':
            i += 1
            while s[i] != '"':
                i += 2 if s[i] == "\\" else 1
        elif c == "'" and CHAR.match(s, i):
            i = CHAR.match(s, i).end() - 1
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return None


MAP = re.compile(r"\s*\.map\(")
COLLECT = re.compile(r"\s*\.collect(?:::<Vec<((?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*)>>)?\(\)")


def from_fn(s):
    out, sites, pos = [], [], 0
    for m in re.finditer(r"\(0\.\.(?!=)", s):
        if m.start() < pos:
            continue
        end = balanced(s, m.start())
        mapped = end and MAP.match(s, end)
        n = s[m.end():end - 1].strip() if end else ""
        if not mapped or not n:
            continue
        fend = balanced(s, mapped.end() - 1)
        collected = fend and COLLECT.match(s, fend)
        if not collected:
            continue
        ty = collected.group(1)
        head = "Vec::from_fn" if ty in (None, "_") else f"Vec::<{ty}>::from_fn"
        new = f"{head}({n}, {s[mapped.end():fend - 1].strip()})"
        out += [s[pos:m.start()], new]
        sites.append({"old": s[m.start():collected.end()], "new": new})
        pos = collected.end()
    return "".join(out) + s[pos:], sites


SPELLINGS = [
    ("trim_prefix/trim_suffix",
     re.compile(r"(?P<recv>[A-Za-z_]\w*(?:\[[^\]\n]*\])?)\.strip_(?P<which>prefix|suffix)\((?P<arg>(?:[^()\n]|\([^()\n]*\))*)\)\s*\.unwrap_or\(&?(?P=recv)\)"),
     lambda m: f"{m['recv']}.trim_{m['which']}({m['arg']})"),
    ("bool::toggle", re.compile(r"(?<![\w.])(?P<x>[a-z_][\w.]*) = !(?P=x)(?=[;,])"), lambda m: f"{m['x']}.toggle()"),
    ("Box::map", re.compile(r"Box::new\((?P<f>\w+)\(\*(?P<b>\w+)\)\)"), lambda m: f"Box::map({m['b']}, {m['f']})"),
    ("the never type", re.compile(r"Ok::<_, (?:std::convert::)?Infallible>"), lambda m: "Ok::<_, !>"),
]

files = [f for f in subprocess.run(["git", "ls-files", "crates", "src-tauri"], capture_output=True, text=True, check=True).stdout.split()
         if f.endswith(".rs") and not f.startswith("crates/vendor/")]
counts, log = {}, {}
for f in files:
    s = text = open(f, encoding="utf8").read()
    for name, pat, to in SPELLINGS:
        s, k = pat.subn(to, s)
        counts[name] = counts.get(name, 0) + k
    s, sites = from_fn(s)
    if sites:
        log[f] = sites
    if s != text and not DRY:
        open(f, "w", encoding="utf8").write(s)
counts["Vec::from_fn"] = sum(len(v) for v in log.values())
for name, k in counts.items():
    print(f"{k:4} {name}")
if DRY:
    sys.exit(0)


def refused():
    """file:line of every compile error, native with every target and for wasm."""
    at = set()
    for c in CRATES:
        for extra in ([["--all-targets"], ["--target", "wasm32-unknown-unknown"]] if c != "solenoid-parquet" else [["--all-targets"]]):
            r = subprocess.run(["cargo", "check", "--manifest-path", f"crates/{c}/Cargo.toml", "--message-format=short", *extra],
                               capture_output=True, text=True, env=ENV)
            for m in re.finditer(r"^(\S+\.rs):(\d+):\d+: error", r.stderr, re.M):
                path = m[1][len(ROOT) + 1:] if m[1].startswith(ROOT + "/") else f"crates/{c}/{m[1]}"
                at.add((path, int(m[2])))
    return at


back = []
for _ in range(12):
    errors = refused()
    if not errors:
        break
    undone = 0
    for f, line in sorted(errors):
        s = open(f, encoding="utf8").read()
        for site in log.get(f, []):
            i = -1 if site.get("back") else s.find(site["new"])
            if i < 0:
                continue
            first = s.count("\n", 0, i) + 1
            if first <= line <= first + site["new"].count("\n"):
                open(f, "w", encoding="utf8").write(s[:i] + site["old"] + s[i + len(site["new"]):])
                site["back"] = True
                back.append(f"{f}:{first}  {' '.join(site['old'].split())[:90]}")
                undone += 1
                break
    if not undone:
        sys.exit("compile errors no Vec::from_fn site explains (a toggle on a number, a Box::map on a reference?):\n"
                 + "\n".join(f"  {f}:{line}" for f, line in sorted(errors)))
else:
    sys.exit("still refusing after 12 rounds")
for c in CRATES:
    subprocess.run(["cargo", "fmt", "--manifest-path", f"crates/{c}/Cargo.toml"], check=True)
print(f"{len(back)} Vec::from_fn sites put back as they were:")
print("\n".join(f"  {b}" for b in back))
