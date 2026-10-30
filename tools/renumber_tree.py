"""Renumber the decision tree so each ring's ids run 1, 2, 3... over the leaves that exist.

Dry run by default: prints the mapping and what would change. `--apply` writes it.

What it rewrites, in every git-tracked text file:
- `[[<ID>]]` wikilinks, including the quoted ones in frontmatter link fields;
- an id followed by its own name, as in "<ID> camelCaseName";
- each leaf's `id:` and its file name (via `git mv`).

What it leaves alone:
- `dte:<ID>` tokens, which name DTE's own tree, not Solenoid's;
- a bare id with no brackets and no name ("<ID>'s rule", or a cell reference): listed for review;
- History sections, which record what was true when they were written;
- the vendored DTE files (`dte-rules/`, `tools/dte.py`).

The RETIRED ledger's numbers are freed: the ledger is archived to docs/archive/ and reset, since its
ids would otherwise collide with the new numbers.

Usage: python tools/renumber_tree.py [--apply]
"""
import pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEC = ROOT / "tree" / "decisions"
TEXT = {".md", ".ts", ".tsx", ".rs", ".mjs", ".js", ".css", ".py", ".json", ".toml", ".yml", ".yaml", ".txt", ".cfg"}
SKIP = ("dte-rules/", "tools/dte.py", "tools/renumber_tree.py", "node_modules/", "dist/", "tree/decisions/RETIRED")
apply = "--apply" in sys.argv


def leaves():
    out = {}
    for f in sorted(DEC.glob("[A-E]/*.md")):
        t = f.read_text(encoding="utf-8")
        m = re.search(r"^id:\s*(\S+)", t, re.M)
        a = re.search(r"^aliases:\s*\n\s*-\s*(\S+)", t, re.M) or re.search(r"^aliases:\s*\[(\w+)\]", t, re.M)
        if m:
            out[m.group(1)] = (f, a.group(1) if a else None)
    return out


nodes = leaves()
mapping = {}
for ring in "ABCDE":
    ids = sorted((i for i in nodes if i[0] == ring), key=lambda i: int(i[1:]))
    for k, old in enumerate(ids, 1):
        if old != f"{ring}{k}":
            mapping[old] = f"{ring}{k}"
names = {i: n for i, (_, n) in nodes.items() if n}

print(f"{len(nodes)} leaves; {len(mapping)} change id")
for ring in "ABCDE":
    row = [f"{o}→{n}" for o, n in mapping.items() if o[0] == ring]
    if row:
        print(f"  {ring}: " + ", ".join(row))
if not mapping:
    sys.exit(0)

link_re = re.compile(r"\[\[([A-E]\d+)(\]\]|#|\|)")
named_re = re.compile(r"\b([A-E]\d+)(\s+)(" + "|".join(re.escape(n) for n in names.values()) + r")\b")
bare_re = re.compile(r"(?<![\w:\[/.-])([A-E]\d+)(?![\w\]])")


def rewrite(text, in_leaf):
    head, sep, hist = (text.partition("\n## History\n") if in_leaf else (text, "", ""))
    n = 0

    def link(m):
        nonlocal n
        new = mapping.get(m.group(1))
        if not new:
            return m.group(0)
        n += 1
        return f"[[{new}{m.group(2)}"

    def named(m):
        nonlocal n
        old, gap, name = m.groups()
        if names.get(old) != name or old not in mapping:
            return m.group(0)
        n += 1
        return f"{mapping[old]}{gap}{name}"

    head = link_re.sub(link, head)
    head = named_re.sub(named, head)
    head = re.sub(r"^id:\s*(\S+)", lambda m: f"id: {mapping.get(m.group(1), m.group(1))}", head, count=1, flags=re.M) if in_leaf else head
    return head + sep + hist, n


tracked = subprocess.run(["git", "-C", str(ROOT), "ls-files"], capture_output=True, text=True, encoding="utf-8").stdout.split()
total, files, bare = 0, 0, []
for rel in tracked:
    if rel.startswith(SKIP) or pathlib.Path(rel).suffix not in TEXT:
        continue
    p = ROOT / rel
    if not p.exists():
        continue
    try:
        t = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        continue
    in_leaf = rel.startswith("tree/decisions/") and re.match(r"tree/decisions/[A-E]/", rel) is not None
    new, n = rewrite(t, in_leaf)
    if in_leaf and re.search(r"^id:", t, re.M):
        old_id = re.search(r"^id:\s*(\S+)", t, re.M).group(1)
        if old_id in mapping:
            n += 1
    if rel.endswith(".md"):
        body = new.partition("\n## History\n")[0] if in_leaf else new
        for line in body.split("\n"):
            plain = re.sub(r"`[^`]*`|\[\[[^\]]*\]\]|dte:[A-E]\d+", "", line)
            for m in bare_re.finditer(plain):
                if m.group(1) in mapping:
                    bare.append(f"{rel}: …{plain[max(0, m.start() - 40):m.end() + 40].strip()}…")
    if n:
        total += n
        files += 1
        if apply:
            p.write_text(new, encoding="utf-8", newline="")

print(f"{total} rewrites in {files} files")
print(f"{len(bare)} bare mentions of a changing id left for review" + (":" if bare else ""))
for b in [x for x in bare if "docs/archive/" not in x][:60]:
    print("  " + b)
if len(bare) > 40:
    print(f"  … and {len(bare) - 40} more")

if apply:
    for old, new in sorted(mapping.items(), key=lambda kv: int(kv[1][1:])):
        src = nodes[old][0]
        tmp = src.with_name(f"__renum_{new}.md")
        subprocess.run(["git", "-C", str(ROOT), "mv", str(src), str(tmp)], check=True)
    for old, new in mapping.items():
        tmp = nodes[old][0].with_name(f"__renum_{new}.md")
        subprocess.run(["git", "-C", str(ROOT), "mv", str(tmp), str(tmp.with_name(f"{new}.md"))], check=True)
    ledger = DEC / "RETIRED"
    if ledger.exists():
        arch = ROOT / "docs" / "archive" / "retired-before-renumber.tsv"
        arch.write_text(ledger.read_text(encoding="utf-8"), encoding="utf-8", newline="")
        head = [l for l in ledger.read_text(encoding="utf-8").split("\n") if l.startswith("#")]
        ledger.write_text("\n".join(head) + "\n", encoding="utf-8", newline="")
        print("RETIRED archived to docs/archive/retired-before-renumber.tsv and reset")
    print("applied; run: python tools/dte.py validate")
else:
    print("dry run; add --apply to write")
