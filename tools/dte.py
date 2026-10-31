#!/usr/bin/env python3
"""dte: Decision Tree Engineering reference tool, version 0.2.  dte:B6,B30

One file, standard library only, Python 3.8+. Copy it into any project. Every decision
is a leaf: one markdown file under decisions/<ring>/.

  ask the tree
    python dte.py show <ID>              one leaf: lineage, children, citing lines, body
    python dte.py find <text>            search ids, names, titles, bodies, ledger, inbox
    python dte.py tree [--files] [--under ID]   the whole tree, or one subtree
    python dte.py blast <ID>             what would changing this touch?
    python dte.py trace <path>           why does this artifact exist?
    python dte.py conflicts              declared contradictions and who wins
    python dte.py coverage [--excluded] [--check]   three gauges: artifacts, specs, MUSTs
    python dte.py scope [--comments]     advisory: no reach, too broad, skipped rings
    python dte.py unratified             every unratified leaf, shallowest and widest first
    python dte.py retired                the ledger
    python dte.py authority [ring]       who holds each ring (whom to ask)
    python dte.py next <ring>            next free id in a ring
  change the tree (frontmatter is never hand-edited)
    python dte.py new <ring> --name N --title T --by NAME --parents A1 [--decision .. --why ..]
    python dte.py ratify <ID>... --by HUMAN
    python dte.py cite <file> <ID,ID>    insert a citation in the file's comment syntax
    python dte.py conflict <A> <B>       declare a contradiction on both sides
    python dte.py reparent <ID> --parents A1,B2 --by NAME [--authorized-by HUMAN]
    python dte.py set <ID> title|name VALUE --by NAME [--authorized-by HUMAN]
    python dte.py contest <ID> [--record --chosen X --by NAME --note ...]
    python dte.py move <ID> <ring> --by NAME [--parents A1] [--authorized-by HUMAN]
    python dte.py retire <ID> --by NAME [--superseded-by NEW] [--authorized-by HUMAN]
    python dte.py fold <ID> [--into PARENT] --by NAME      an aspect of its parent goes back into it
    python dte.py to-spec <ID> <spec.md> --by NAME          a leaf that was mechanics becomes spec text
    python dte.py renumber <ID> --by NAME [--to NEW]        give a leaf a fresh id, references with it
    python dte.py merge-ids <ref> --by NAME                 renumber leaves whose id <ref> gave another leaf
    python dte.py editorial --by NAME --note TEXT           one log line for a wording-only sweep
    python dte.py inbox / place <slug> <ring> --by NAME [--parents A1,B2]
    python dte.py outbox [--done ID|slug]
  specs and agents
    python dte.py brief <ring> [--under ID]   the block to hand a subagent at that ring
    python dte.py spec <ID> [--out FILE]      a spec skeleton from a leaf
    python dte.py brief --builder <spec>      the block to hand a builder (no ring, no tree)
    python dte.py gap <spec> --title T --by NAME   the spec is silent: file a gap
  check and integrate
    python dte.py validate [--as RING] [--full]   consistency; exit 1 on errors ($DTE_RING is the default ring)
    python dte.py export [--out FILE]    JSON of leaves, citations, ledger, inbox
    python dte.py init                   scaffold decisions/, dte.cfg, .dteignore, .dtecoverage
    python dte.py upgrade                bring a 0.1 tree to the 0.2 format (lean frontmatter, uuids)
    python dte.py vendor --from DIR [--dir DIR]   copy DTE's rules in; prints what changed upstream
    python dte.py hook                   install a pre-commit hook that runs validate

Options: --root DIR (default: cwd)  --decisions DIR (default: ROOT/<decisions in dte.cfg>)
Config:  ROOT/dte.cfg, key = value lines (see dte init for every key with its default)
"""
import argparse
import datetime
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict

ID_RE = re.compile(r"^([A-Z])(\d+)$")   # dte:B32
# Two citation forms, read everywhere: the dte: token and the [[ID]] wikilink
# (optionally [[ID|alias]]) that Obsidian follows. `links` in dte.cfg picks the written one.
CITE_RE = re.compile(r"\bdte:([A-Z]\d+(?:\s*,\s*[A-Z]\d+)*)")
LINK_RE = re.compile(r"\[\[([A-Z]\d+)(?:\|[^\]]*)?\]\]")


# A spec's scope: `covers: <globs>` in a comment line near its top (a markdown heading starts with #, so a
# heading that says "covers:" is not one).  dte:B44
COVERS_RE = re.compile(r"^\s*(?:<!--|//|/\*|#\s).*?\bcovers:\s*([^>\n]+?)\s*(?:-->|\*/)?\s*$")
MUST_RE = re.compile(r"\bMUST\b")
UNENFORCED_RE = re.compile(r"\*Unenforced:\*")


def cited_ids(line):
    """Every id cited on a line, in order, from both forms."""
    found = []
    for m in CITE_RE.finditer(line):
        found.extend(re.split(r"\s*,\s*", m.group(1)))
    found.extend(m.group(1) for m in LINK_RE.finditer(line))
    return found


def summary_of(name, title):
    """How a leaf is printed: `name: title` when it has a handle, else the title (dte:B32)."""
    return "%s: %s" % (name, title) if name else title


def wikilinks():
    return CONFIG.get("links") == "wikilink"


def fm_id(i):
    """One id as written in a frontmatter link field."""
    return '"[[%s]]"' % i if wikilinks() else i


def fm_ids(ids):
    return "[%s]" % ", ".join(fm_id(i) for i in ids)


def cite_text(ids):
    """The citation as written into an artifact."""
    if wikilinks():
        return ", ".join("[[%s]]" % i for i in ids)
    return "dte:" + ",".join(ids)


def sub_citations(text, old_id, new_id):
    """old_id -> new_id in every citation of either form."""
    def swap(m):
        ids = []
        for x in re.split(r"\s*,\s*", m.group(1)):
            x = new_id if x == old_id else x
            if x not in ids:   # a line citing both keeps one
                ids.append(x)
        return "dte:" + ",".join(ids)
    text = CITE_RE.sub(swap, text)
    return LINK_RE.sub(lambda m: m.group(0).replace("[[" + old_id, "[[" + new_id, 1)
                       if m.group(1) == old_id else m.group(0), text)


def rename_citations(text, old_id, new_id, old_name="", new_name=""):
    """Rewrite every citation of old_id to new_id, carry the winner's name where the old name
    followed the id, and collapse a citation the line already had.  dte:B32"""
    out = []
    for line in text.split("\n"):
        if old_id not in line:
            out.append(line)
            continue
        new = sub_citations(line, old_id, new_id)
        if old_name and new_name and old_name != new_name:
            new = re.sub(r"(\[\[%s(?:\|[^\]]*)?\]\]|\b%s)(\s+)%s\b" % (re.escape(new_id), re.escape(new_id), re.escape(old_name)),
                         lambda m: m.group(1) + m.group(2) + new_name, new)
        if new != line:
            new = _collapse_repeat(new, new_id, new_name)
        out.append(new)
    return "\n".join(out)


def _collapse_repeat(line, i, name):
    """A line that now cites i twice keeps the first; separators and emptied brackets go with the repeat."""
    pat = re.compile(r"\[\[%s(?:\|[^\]]*)?\]\]%s" % (re.escape(i), (r"(?:\s+%s\b)?" % re.escape(name)) if name else ""))
    hits = list(pat.finditer(line))
    if len(hits) < 2:
        return line
    for m in reversed(hits[1:]):
        a, b = m.start(), m.end()
        pre = line[:a]
        sep = re.search(r"(?:\s*[,;]|\s+(?:and|or))?\s*$", pre)
        if sep and sep.group(0).strip():
            a = sep.start()
        line = line[:a] + line[b:]
    line = re.sub(r"\s*(?:,|;|\band\b|\bor\b)\s*(?:\(\s*\)|\[\s*\])", "", line)
    line = re.sub(r"\s*\(\s*\)", "", line)
    line = re.sub(r"\s*\[\s*\]", "", line)
    return line


STATUSES = {"proposed", "active", "superseded", "reverted"}


def _first_alias(data):
    a = data.get("aliases")
    a = a if isinstance(a, list) else ([a] if a else [])
    return str(a[0]) if a else ""
MADE_BY = {"human", "ai", "joint"}
LIST_FIELDS = {"parents", "supersedes", "conflicts_with"}
# No depends_on or structural fields: that axis belongs to the graph.  dte:B9
OBSIDIAN_FIELDS = {"aliases", "tags", "cssclasses"}   # Obsidian's own keys. The first alias is the leaf's name (dte:B32)
KNOWN_FIELDS = LIST_FIELDS | OBSIDIAN_FIELDS | {
    "id", "uuid", "title", "status", "superseded_by", "made_by", "by", "date",
    "ratified_by", "authorized_by", "contested_by", "branch",
}
# 0.1 fields 0.2 dropped, with what replaced each; validate names `dte upgrade`, which removes them.  dte:B43
DROPPED_FIELDS = {"name": "the first alias is the name", "confidence": "say how sure in the Why"}
INBOX_FIELDS = {"name", "title", "proposed_ring", "ask", "made_by", "by", "date", "parents", "kind", "spec"} | OBSIDIAN_FIELDS
# The outbox: what a human changes in the vault and an agent must process. A note dropped in
# decisions/outbox, an action tag on a leaf (a tags property or an inline #ratify, #retire, #contest, #ask),
# or a ratified_by typed into the properties pane. Never a bare diff: an anonymous edit cannot
# be told from an agent's own unfinished work, and validate already lists changed leaves (B17).
OUTBOX_DIR = "outbox"
NAME_RE = re.compile(r"^[a-z][A-Za-z0-9]*$")   # the readable handle: camelCase, unique across the tree (dte:B32)
ACTION_TAG_RE = re.compile(r"(?<![\w/#])#(ratify|retire|contest|ask)\b")
ACTIONS = {
    "ratify": "the human ratifies it: dte ratify <ID> --by <human>",
    "retire": "the human reverts it: dte blast <ID>, then dte retire <ID> --by <human> --authorized-by <human>, fix the orphans",
    "contest": "the human disputes it: dte contest <ID> --again, build the alternatives, record the verdict, report",
    "ask": "the human left a question or comment in the body: answer it in chat; if it changes the leaf, make the change and add a History line",
}
IN_EFFECT = {"proposed", "active"}
TITLE_MAX = 100          # dte:B16
INBOX_DIR = "inbox"      # dte:B14
LEDGER = "RETIRED"       # dte:B24
EDITORIAL = "EDITORIAL"  # dte:B61 one line per wording-only sweep

DEFAULTS = {"summaries": True, "protect_human": True, "authority": (),
            "docs": ("*.md", "docs/*"), "broad_fraction": 0.3, "broad_min": 5,   # dte:B21
            # Layers below the tree, told apart by glob so a leaf never stores what is below it.  dte:B37
            "specs": ("specs/*", "spec/*", "*.spec.md"),
            "tests": ("tests/*", "test/*", "test_*", "*_test.*", "*.test.*", "*.spec.ts", "*.spec.js"),
            "agents": ("CLAUDE.md", "AGENTS.md", ".claude/*", ".cursorrules", ".github/copilot-instructions.md"),
            "retire": "delete",   # dte:B24
            "links": "token",     # token writes dte:ID; wikilink writes [[ID]] (Obsidian-browsable)
            "scan_self": False,   # the tool's own file is skipped unless the tree is DTE's own (dte:B3)
            "decisions": "decisions",   # the decisions dir, relative to the root; --decisions overrides
            "must_test": True}          # validate warns on a MUST no test cites and no *Unenforced:* line labels (B46)
CONFIG = dict(DEFAULTS)


# ---------------------------------------------------------------- config  dte:B12

def load_config(root):
    cfg = dict(DEFAULTS)
    cfg["authority"] = []
    path = os.path.join(root, "dte.cfg")
    if not os.path.exists(path):
        return cfg
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#", 1)[0].strip()
            if not line or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip()
            if key in ("summaries", "protect_human", "scan_self", "must_test"):
                cfg[key] = val.lower() in ("on", "true", "yes", "1")
            elif key in ("docs", "specs", "tests", "agents"):
                cfg[key] = tuple(x.strip() for x in val.split(",") if x.strip())
            elif key == "decisions":
                cfg["decisions"] = val
            elif key == "broad_fraction":
                cfg["broad_fraction"] = float(val)
            elif key == "broad_min":
                cfg["broad_min"] = int(val)
            elif key == "retire":
                cfg["retire"] = "keep" if val.lower() == "keep" else "delete"
            elif key == "links":
                cfg["links"] = "wikilink" if val.lower() in ("wikilink", "wiki", "obsidian") else "token"
            elif key == "authority":
                for item in val.split(","):
                    if ":" in item:
                        ring, _, holder = item.partition(":")
                        cfg["authority"].append((ring.strip().upper(), holder.strip()))
    return cfg


def holder_of(ring, cfg):
    """Who holds a ring per the advisory map.  dte:B13"""
    best = None
    for key, holder in cfg["authority"]:
        if key == ring:
            return holder
        if key.endswith("+") and ord(key[0]) <= ord(ring):
            if best is None or ord(key[0]) > ord(best[0]):
                best = (key[0], holder)
    return best[1] if best else "the human (ring %s is unmapped)" % ring


# ---------------------------------------------------------------- parsing

def parse_frontmatter(text):
    """Restricted YAML subset: scalars, [inline, lists], block lists.  dte:C1"""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing frontmatter (file must start with ---)")
    data, key, i = {}, None, 1
    while i < len(lines):
        line = lines[i]
        if line.strip() == "---":
            return data, "\n".join(lines[i + 1:])
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            i += 1
            continue
        if stripped.startswith("- "):
            if key is None or not isinstance(data.get(key), list):
                raise ValueError("list item without a list key at line %d" % (i + 1))
            data[key].append(_scalar(stripped[2:]))
            i += 1
            continue
        if ":" not in line:
            raise ValueError("cannot parse line %d: %r" % (i + 1, line))
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = _strip_comment(raw.strip())
        if raw == "":
            data[key] = []
            data.setdefault("_empty", set()).add(key)
        elif raw.startswith("[") and raw.endswith("]"):
            inner = raw[1:-1].strip()
            data[key] = [_scalar(x) for x in inner.split(",")] if inner else []
        else:
            data[key] = _scalar(raw)
        i += 1
    raise ValueError("frontmatter never closed")


def _strip_comment(raw):
    if raw.startswith(("'", '"')):
        return raw
    return re.sub(r"\s+#.*$", "", raw)


def _scalar(raw):
    raw = _strip_comment(raw.strip())
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"":
        q, raw = raw[0], raw[1:-1]
        raw = raw.replace("''", "'") if q == "'" else raw.replace('\\"', '"').replace("\\\\", "\\")
    elif raw in ("null", "~", "Null", "NULL"):   # Obsidian writes an emptied property as null
        return ""
    m = LINK_RE.fullmatch(raw)   # a quoted wikilink in a link field reads as the bare id
    return m.group(1) if m else raw


def fm_str(s):
    """A free-text field, double-quoted so a colon or hash inside it stays valid YAML."""
    return '"%s"' % s.replace("\\", "\\\\").replace('"', '\\"')


def _normalise(data):
    empties = data.pop("_empty", set())
    for k in empties:
        if k not in LIST_FIELDS and data.get(k) == []:
            data[k] = None
    return data


class Leaf:
    """One decision: a markdown file under decisions/<ring>/.  dte:B1,B50"""

    def __init__(self, path, data, body):
        self.path = path
        self.body = body
        self.raw = _normalise(data)
        data = self.raw
        self.id = str(data.get("id") or "")
        self.title = str(data.get("title") or "")
        self.name = _first_alias(data) or str(data.get("name") or "")   # dte:B32 the first alias is the name
        self.summary = summary_of(self.name, self.title)
        self.status = str(data.get("status") or "active")   # dte:B43 written only when it is not active
        self.made_by = str(data.get("made_by") or "ai")     # dte:B43 written only when it is not ai
        self.by = str(data.get("by") or "")
        self.uuid = str(data.get("uuid") or "")             # dte:B58
        self.branch = str(data.get("branch") or "")         # dte:B54
        self.superseded_by = data.get("superseded_by") or None
        self.ratified_by = data.get("ratified_by") or None
        self.authorized_by = data.get("authorized_by") or None
        self.contested_by = data.get("contested_by") or None   # dte:B60
        tags = data.get("tags") or []
        tags = [str(t).lstrip("#") for t in (tags if isinstance(tags, list) else [tags]) if str(t)]
        self.actions = sorted({t for t in tags if t in ACTIONS}
                              | {m.group(1) for m in ACTION_TAG_RE.finditer(body)})
        for f in LIST_FIELDS:
            v = data.get(f)
            if v is None:
                v = []
            if not isinstance(v, list):
                v = [v]
            setattr(self, f, [str(x) for x in v if str(x)])

    @property
    def ring(self):
        m = ID_RE.match(self.id)
        return m.group(1) if m else None

    @property
    def number(self):
        m = ID_RE.match(self.id)
        return int(m.group(2)) if m else 0

    @property
    def in_effect(self):
        return self.status in IN_EFFECT

    @property
    def imported(self):
        """Re-homed existing content: the import wrote a History line saying so.  dte:B33"""
        return bool(re.search(r"^- \S+ imported from ", _section(self.body, "## History"), re.M))

    def has_must(self):
        """A MUST outside the sections that record other options or other times.  dte:B46"""
        skip = False
        for line in self.body.replace("\r\n", "\n").split("\n"):
            if line.startswith("## "):
                skip = line.strip() in ("## History", "## Contest", "## Alternatives considered")
                continue
            if not skip and MUST_RE.search(line.replace("`MUST`", "")):
                return True
        return False

    @property
    def human_held(self):
        """dte:B11"""
        return self.made_by == "human" or bool(self.ratified_by)

    def label(self):
        if not CONFIG["summaries"]:
            return self.id
        tag = ""
        if self.status != "active":
            tag += " [%s]" % self.status
        if self.made_by != "human":
            state = "" if self.ratified_by else ", unratified"
            if not self.ratified_by and self.contested_by:
                state += ", contested"   # dte:B60
            tag += " (%s%s)" % (self.made_by, state)
        return "%s %s%s" % (self.id, self.summary, tag)


class InboxItem:
    """A decision with no ID yet.  dte:B14"""

    def __init__(self, path, data, body):
        self.path = path
        self.body = body
        self.raw = _normalise(data)
        self.slug = os.path.splitext(os.path.basename(path))[0]
        self.title = str(self.raw.get("title") or "")
        self.name = str(self.raw.get("name") or _first_alias(self.raw))
        self.proposed_ring = str(self.raw.get("proposed_ring") or "").upper()
        self.ask = str(self.raw.get("ask") or "")
        self.made_by = str(self.raw.get("made_by") or "ai")
        self.by = str(self.raw.get("by") or "")
        self.kind = str(self.raw.get("kind") or "decision")   # decision | gap  dte:B42
        self.spec = str(self.raw.get("spec") or "")
        p = self.raw.get("parents") or []
        self.parents = [str(x) for x in (p if isinstance(p, list) else [p]) if str(x)]


def ring_depth(ring):
    return ord(ring) - ord("A")


def id_key(i):
    m = ID_RE.match(i)
    return (m.group(1), int(m.group(2))) if m else ("~", 0)


# ---------------------------------------------------------------- tree

class Tree:
    def __init__(self, root, decisions_dir):
        self.root = os.path.abspath(root)
        self.decisions_dir = os.path.abspath(decisions_dir)
        self.inbox_dir = os.path.join(self.decisions_dir, INBOX_DIR)
        self.outbox_dir = os.path.join(self.decisions_dir, OUTBOX_DIR)
        self.leaves = {}
        self.inbox = []
        self.outbox = []           # (slug, title, path) notes the human dropped for an agent
        self.retired = {}          # id -> ledger row  dte:B24
        self.errors = []
        self.warnings = []
        self.children = defaultdict(list)
        self.citations = []
        self.scanned_files = []
        self.spec_covers = {}   # spec rel -> covers: globs (a spec is the scope of the files built to it)
        self._leaf_ids = set()
        self._validated = False
        self._load()

    # -- loading
    def _load(self):
        if not os.path.isdir(self.decisions_dir):
            self.errors.append("decisions dir not found: %s" % self.decisions_dir)
            return
        for dirpath, dirs, files in os.walk(self.decisions_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]   # .obsidian and friends
            if os.path.abspath(dirpath) == os.path.abspath(self.inbox_dir):
                for fn in sorted(files):
                    if fn.endswith(".md"):
                        self._load_inbox(os.path.join(dirpath, fn))
                dirs[:] = []
                continue
            if os.path.abspath(dirpath) == os.path.abspath(self.outbox_dir):
                for fn in sorted(files):
                    if fn.endswith(".md"):
                        self._load_outbox(os.path.join(dirpath, fn))
                dirs[:] = []
                continue
            for fn in sorted(files):
                if not fn.endswith(".md") or fn.upper() == "README.MD":
                    continue
                self._load_node(os.path.join(dirpath, fn))
        self._load_ledger()
        self._load_editorial()
        for node in self.leaves.values():
            for p in node.parents:
                r = self.resolve(p)
                if r:
                    self.children[r].append(node.id)
        # what a leaf superseded is the ledger's fact, not a field on the leaf  dte:B43
        for i, row in self.retired.items():
            succ = row["successor"]
            if succ in self.leaves and row["action"] in ("superseded", "moved", "folded") and i not in self.leaves[succ].supersedes:
                self.leaves[succ].supersedes.append(i)

    def branch_of(self, i):
        """The branch a leaf belongs to: its own `branch:` or the nearest ancestor's; "" for the whole project.  dte:B54"""
        memo = self.__dict__.setdefault("_branch", {})
        if i in memo:
            return memo[i]
        memo[i] = ""
        node = self.leaves.get(i)
        if node is None:
            return ""
        b = node.branch
        if not b:
            for p in node.parents:
                if p in self.leaves:
                    b = self.branch_of(p)
                    if b:
                        break
        memo[i] = b
        return b

    def current_branch(self):
        try:
            out = subprocess.run(["git", "-C", self.root, "rev-parse", "--abbrev-ref", "HEAD"],
                                 capture_output=True, text=True)
            return out.stdout.strip() if out.returncode == 0 else ""
        except OSError:
            return ""

    # -- editorial log  dte:B61
    def editorial_path(self):
        return os.path.join(self.decisions_dir, EDITORIAL)

    def _load_editorial(self):
        """{id: set(body hashes)} a wording-only sweep vouched for."""
        self.editorial = defaultdict(set)
        p = self.editorial_path()
        if not os.path.exists(p):
            return
        with open(p, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                line = line.rstrip("\n")
                if not line.strip() or line.startswith("#"):
                    continue
                parts = line.split("\t")
                if len(parts) < 4:
                    self.errors.append("%s:%d: bad editorial line" % (self.rel(p), n))
                    continue
                for tok in parts[3].split():
                    i, _, h = tok.partition("@")
                    self.editorial[i].add(h)

    def _load_outbox(self, path):
        """A human's note: frontmatter optional, title from it, the first heading, or the file name."""
        text = read_text(path).replace("\r\n", "\n")
        slug = os.path.splitext(os.path.basename(path))[0]
        title = None
        if text.startswith("---"):
            try:
                data, body = parse_frontmatter(text)
                title = str(data.get("title") or "") or None
            except ValueError:
                body = text
        else:
            body = text
        if not title:
            m = re.search(r"^#+\s+(.+)$", body, re.M)
            title = m.group(1).strip() if m else slug
        self.outbox.append((slug, title, path))

    def outbox_items(self):
        """[(kind, ref, label, todo)] everything a human designated in the vault for an agent to process."""
        items = []
        for slug, title, path in self.outbox:
            items.append(("note", slug, '"%s"  (%s)' % (title, self.rel(path)),
                          "read it and act: a decision becomes dte new or an inbox item, a correction becomes an edit, "
                          "a question gets an answer in chat; then dte outbox --done %s" % slug))
        for node in self.ordered_leaves():
            for act in node.actions:
                items.append(("tag", node.id, "%s  #%s" % (node.label(), act),
                              ACTIONS[act]
                              + "; then dte outbox --done %s" % node.id))
            if node.ratified_by and not re.search(r"ratified by", node.body):
                items.append(("ratified", node.id, "%s  ratified_by: %s typed in, no History line" % (node.label(), node.ratified_by),
                              "run dte ratify %s --by \"%s\" so History records it"
                              % (node.id, node.ratified_by)))
        return items

    # -- ledger  dte:B24
    def ledger_path(self):
        return os.path.join(self.decisions_dir, LEDGER)

    def _load_ledger(self):
        p = self.ledger_path()
        if not os.path.exists(p):
            return
        with open(p, encoding="utf-8") as fh:
            for n, line in enumerate(fh, 1):
                line = line.rstrip("\n")
                if not line.strip() or line.startswith("#"):
                    continue
                parts = line.split("\t")
                if len(parts) < 7 or not ID_RE.match(parts[0]):
                    self.errors.append("%s:%d: bad ledger line" % (self.rel(p), n))
                    continue
                row = dict(zip(("id", "date", "action", "successor", "by", "authorized_by", "title"), parts))
                for k in ("successor", "authorized_by"):
                    if row[k] == "-":
                        row[k] = ""
                if row["id"] in self.retired:
                    self.errors.append("%s:%d: %s retired twice" % (self.rel(p), n, row["id"]))
                self.retired[row["id"]] = row

    def append_ledger(self, id_, action, successor, by, authorized_by, title):
        p = self.ledger_path()
        new = not os.path.exists(p)
        with open(p, "a", encoding="utf-8", newline="") as fh:
            if new:
                fh.write("# Retired decision ids. Never reissued. Text lives in git history.  dte:B24\n")
                fh.write("# id\tdate\taction\tsuccessor\tby\tauthorized_by\ttitle\n")
            fh.write("\t".join([id_, datetime.date.today().isoformat(), action, successor or "-",
                                by, authorized_by or "-", title.replace("\t", " ")]) + "\n")

    def retired_hint(self, i):
        row = self.retired.get(i)
        if not row:
            return "does not exist"
        joint = {"moved": " to ", "folded": " into ", "to-spec": ", now spec text in "}.get(row["action"], " by ")
        s = "was retired on %s (%s%s)" % (row["date"], row["action"],
                                         joint + row["successor"] if row["successor"] else "")
        return s + "; text: git log --all -- decisions/%s/%s.md" % (i[0], i)

    def _read(self, path):
        with open(path, encoding="utf-8") as fh:
            return parse_frontmatter(fh.read())

    def _load_node(self, path):
        rel = self.rel(path)
        try:
            data, body = self._read(path)
        except (ValueError, UnicodeDecodeError) as e:
            self.errors.append("%s: %s" % (rel, e))
            return
        node = Leaf(path, data, body)
        if not ID_RE.match(node.id):
            self.errors.append("%s: bad or missing id %r" % (rel, node.id))
            return
        if node.id in self.leaves:
            self.errors.append("%s: duplicate id %s (also %s)"
                               % (rel, node.id, self.rel(self.leaves[node.id].path)))
            return
        self.leaves[node.id] = node

    def _load_inbox(self, path):
        rel = self.rel(path)
        try:
            data, body = self._read(path)
        except (ValueError, UnicodeDecodeError) as e:
            self.errors.append("%s: %s" % (rel, e))
            return
        item = InboxItem(path, data, body)
        for f in item.raw:
            if f not in INBOX_FIELDS:
                self.errors.append("%s: unknown inbox field %r (inbox items have no id or status)" % (rel, f))
        if not item.title:
            self.errors.append("%s: inbox item needs a title" % rel)
        if item.made_by not in MADE_BY:
            self.errors.append("%s: made_by must be one of %s" % (rel, sorted(MADE_BY)))
        if item.kind not in ("decision", "gap"):
            self.errors.append("%s: kind must be decision or gap" % rel)
        if item.kind == "gap" and not os.path.isfile(os.path.join(self.root, item.spec)):
            self.errors.append("%s: gap names a spec that does not exist: %s" % (rel, item.spec or "(none)"))
        self.inbox.append(item)

    def rel(self, path):
        return os.path.relpath(path, self.root).replace(os.sep, "/")

    def resolve(self, i):
        """No aliases: an id resolves to itself or to nothing.  dte:B32"""
        return i if i in self.leaves else None

    def ordered(self, ids=None):
        return sorted(ids if ids is not None else self.leaves, key=id_key)

    def ordered_leaves(self):
        return [self.leaves[i] for i in self.ordered()]

    # -- validation (rules R1..R9 in SPEC)
    def validate(self, as_ring=None):
        if self._validated:
            return not self.errors
        self._validated = True
        E, W = self.errors, self.warnings
        names = {}   # handle -> id
        uuids = {}   # uuid -> id  dte:B58
        here = None
        for node in self.ordered_leaves():
            i = node.id
            u = node.uuid
            if not u:
                E.append("%s: no uuid; dte upgrade gives it one" % i)
            elif u in uuids:
                E.append("%s: uuid %s is already %s's" % (i, u, uuids[u]))
            else:
                uuids[u] = i
            expected = os.path.join(self.decisions_dir, node.ring, i + ".md")
            if os.path.abspath(node.path) != os.path.abspath(expected):
                E.append("%s: file should be at %s" % (i, self.rel(expected)))
            for f in node.raw:
                if f in DROPPED_FIELDS:
                    E.append("%s: %r is a 0.1 field (%s); dte upgrade removes it" % (i, f, DROPPED_FIELDS[f]))
                elif f not in KNOWN_FIELDS:
                    E.append("%s: unknown frontmatter field %r" % (i, f))
            if node.name and not NAME_RE.match(node.name):
                E.append("%s: name %r is not a camelCase identifier; fix it with dte set %s name <camelCase> --by <you>"
                         % (i, node.name, i))
            elif not node.name:
                W.append("%s: no name; give it one with dte set %s name <camelCase> --by <you> (B32)" % (i, i))
            if node.name and node.in_effect and names.get(node.name, i) != i:
                E.append("%s: name %r is already %s's" % (i, node.name, names[node.name]))
            if node.in_effect:
                names.setdefault(node.name, i)
            aliases = node.raw.get("aliases")
            if isinstance(aliases, list) and len([a for a in aliases if str(a)]) > 1:
                E.append("%s: aliases holds one name, not %d (no second identity, B32); dte set %s name <one>"
                         % (i, len(aliases), i))
            if "name" in node.raw and node.raw.get("name") and str(node.raw["name"]) != node.name:
                E.append("%s: name and aliases disagree; dte upgrade keeps the alias" % i)
            if node.status not in STATUSES:
                E.append("%s: status must be one of %s" % (i, sorted(STATUSES)))
            if node.made_by not in MADE_BY:
                E.append("%s: made_by must be one of %s" % (i, sorted(MADE_BY)))
            if not node.title:
                E.append("%s: title is required" % i)
            elif len(node.title) > TITLE_MAX:   # dte:B16
                W.append("%s: title is %d chars; keep the summary under %d" % (i, len(node.title), TITLE_MAX))
            if "## Decision" not in node.body or "## Why" not in node.body:
                E.append("%s: body needs '## Decision' and '## Why' sections" % i)
            if re.search(r"^TODO$", node.body, re.M):
                W.append("%s: body still has a TODO placeholder; finish it" % i)
            for heading in _empty_sections(node.body):   # a half-done edit leaves a heading with nothing under it
                W.append("%s: section '%s' is empty; fill it or delete the heading" % (i, heading))
            if node.ratified_by and "## Contest" in node.body.split("\n"):   # dte:B62
                W.append("%s: ratified but still carries '## Contest'; a ratified leaf is present governance, drop it" % i)
            # R1 parents  dte:B10
            if node.ring == "A" and node.parents:
                E.append("%s: core (A) leaves cannot have parents" % i)
            if node.ring != "A" and not node.parents:
                E.append("%s: non-core leaf has no parents" % i)
            for p in node.parents:
                pid = self.resolve(p)
                if pid is None:
                    E.append("%s: ORPHAN, parent %s %s; re-parent, supersede, or revert %s"
                             % (i, p, self.retired_hint(p), i))
                    continue
                parent = self.leaves[pid]
                if ring_depth(parent.ring) >= ring_depth(node.ring):
                    E.append("%s: parent %s is not in a shallower ring" % (i, pid))
                # R4 orphans  dte:B24
                if node.in_effect and not parent.in_effect:
                    E.append("%s: ORPHAN, parent %s is %s (re-parent, supersede, or revert %s)"
                             % (i, pid, parent.status, i))
                if node.in_effect and parent.status == "proposed":   # dte:C5
                    W.append("%s: parent %s is still proposed (needs ratification)" % (i, pid))
            # supersession  dte:B24
            if node.status == "superseded":
                sb = self.resolve(str(node.superseded_by or ""))
                if not sb:
                    E.append("%s: superseded but superseded_by is missing or unknown" % i)
                elif i not in self.leaves[sb].supersedes:
                    W.append("%s: superseded_by %s, but %s does not list it in supersedes" % (i, sb, sb))
            elif node.superseded_by:
                E.append("%s: superseded_by set but status is %s" % (i, node.status))
            for s in node.supersedes:
                sid = self.resolve(s)
                if sid is None:
                    if s not in self.retired:
                        E.append("%s: supersedes unknown %s" % (i, s))
                    elif self.retired[s]["successor"] and self.retired[s]["successor"] != i:
                        W.append("%s: supersedes %s but the ledger says %s went to %s"
                                 % (i, s, s, self.retired[s]["successor"]))
                elif self.leaves[sid].status != "superseded":
                    E.append("%s: supersedes %s but %s has status %s"
                             % (i, sid, sid, self.leaves[sid].status))
            # R2 conflicts  dte:B4
            for c in node.conflicts_with:
                cid = self.resolve(c)
                if cid is None:
                    E.append("%s: conflicts_with %s %s" % (i, c, self.retired_hint(c)))
                elif self.leaves[cid].in_effect and node.in_effect \
                        and self.leaves[cid].ring == node.ring:
            # a same-ring contradiction is a refinement filed as a sibling: dte:B35
                    E.append("%s: same-ring contradiction with %s; supersede or move one" % (i, cid))
            # R7 human-held protection  dte:B11
            if CONFIG["protect_human"] and node.human_held and not node.authorized_by:
                if node.status in ("superseded", "reverted"):
                    E.append("%s: human-held leaf is %s without authorized_by naming a human"
                             % (i, node.status))
            if node.in_effect and not self.children.get(i):
                self._leaf_ids.add(i)
        # citations  dte:B3
        self.scan()
        for rel, ln, cid, resolved in self.citations:
            if resolved is None:
                if cid in self.retired:
                    E.append("%s:%d: cites %s, which %s" % (rel, ln, cid, self.retired_hint(cid)))
                else:
                    E.append("%s:%d: citation to unknown id %s" % (rel, ln, cid))
            elif not self.leaves[resolved].in_effect:
                W.append("%s:%d: cites %s which is %s" % (rel, ln, cid, self.leaves[resolved].status))
        enforced = self.enforced_ids()
        for node in self.ordered_leaves():
            if not node.in_effect:
                continue
            # a leaf cites only up its lineage: one that leans on a deeper decision can't be weighed alone  dte:B49
            for cid in sorted(set(self.body_citations(node)), key=id_key):
                if ID_RE.match(cid) and ring_depth(cid[0]) > ring_depth(node.ring):
                    E.append("%s: cites %s, a deeper ring, in its body; a leaf cites only up its lineage (say it in"
                             " the child, or move the text to a spec)" % (node.id, cid))
            # a MUST is enforced by a citing test or labels its debt  dte:B46
            if CONFIG.get("must_test") and node.has_must() and node.id not in enforced \
                    and not UNENFORCED_RE.search(node.body):
                W.append("%s: states a MUST that no test cites; cite it from the test that enforces it, or add an"
                         " *Unenforced:* line to Consequences saying why it can't be checked" % node.id)
        here = self.current_branch()
        for node in self.ordered_leaves():   # dte:B54
            b = self.branch_of(node.id)
            if b and here and here != "HEAD" and b != here and node.branch:
                W.append("%s: belongs to branch %s but is on %s; a branch-local subtree never merges out (port the"
                         " finding, not the leaf)" % (node.id, b, here))
        for node, logged in self.body_changes():   # dte:B61
            if not logged:
                W.append("%s: body changed in this working tree with no new History line; add one, or log a"
                         " wording-only sweep with dte editorial" % node.id)
        foreign = self.departing_branch_local(here) | self.renumbered_paths()
        for code, rel in self.retired_paths():   # dte:B24
            gone_id = os.path.splitext(os.path.basename(rel))[0]
            if rel in foreign:
                continue   # a branch-local leaf leaving a branch it never belonged to (B54), or a renumber (B58)
            if code == "R":
                E.append("%s: leaf file renamed; use dte move (a move is a new id plus retirement)" % rel)
            elif gone_id not in self.retired:
                E.append("%s: leaf file deleted with no ledger line; use dte retire" % rel)
            elif CONFIG["retire"] == "keep":
                E.append("%s: leaf file deleted but retire = keep; restore it with a status instead" % rel)
            elif gone_id in self.leaves:
                E.append("%s: deleted and retired, yet %s still exists as a leaf" % (rel, gone_id))
        if as_ring:
            self._check_authority(as_ring)
        else:   # dte:B52 a tree change with no ring declared can't be checked against one
            changed, exact = self.changed_files()
            dec = self.rel(self.decisions_dir) + "/"
            if exact and any(c.startswith(dec) and not c.startswith(dec + OUTBOX_DIR + "/") for c in changed) \
                    and not os.environ.get("DTE_OWNER"):
                W.append("leaves changed with no ring declared; an agent runs validate --as <its ring> (or sets"
                         " DTE_RING); the owner sets DTE_OWNER=1 to silence this")
        return not E

    def _check_authority(self, as_ring):
        """dte:B15"""
        E, W = self.errors, self.warnings
        as_ring = as_ring.upper()
        changed, exact = self.changed_files()
        if not exact:
            W.append("git unavailable or not a repository; treating every leaf as changed (--as check is coarse)")
        by_path = {self.rel(n.path): n for n in self.leaves.values()}
        for rel in sorted(changed):
            node = by_path.get(rel)
            if node is None:
                continue
            if ring_depth(node.ring) < ring_depth(as_ring) and not node.authorized_by:
                E.append("%s: changed by an agent at ring %s but lives at ring %s; escalate to %s"
                         % (node.id, as_ring, node.ring, holder_of(node.ring, CONFIG)))
            if CONFIG["protect_human"] and node.human_held and not node.authorized_by:
                old = self.node_at_head(rel)
                if old is not None and not old.human_held:
                    continue   # this change IS the ratification; the report lists it for the human
                E.append("%s: human-held leaf changed without authorized_by (agent at ring %s)"
                         % (node.id, as_ring))
        renumbered = self.renumbered_paths()
        for code, rel in self.retired_paths():   # deleted this working tree  dte:B24
            if code != "D" or rel in renumbered:
                continue
            gone_id = os.path.splitext(os.path.basename(rel))[0]
            row = self.retired.get(gone_id)
            auth = row["authorized_by"] if row else ""
            if ring_depth(gone_id[0]) < ring_depth(as_ring) and not auth:
                E.append("%s: retired by an agent at ring %s but lived at ring %s; escalate to %s"
                         % (gone_id, as_ring, gone_id[0], holder_of(gone_id[0], CONFIG)))
            old = self.node_at_head(rel)
            if old is not None and CONFIG["protect_human"] and old.human_held and not auth:
                E.append("%s: human-held leaf deleted without authorized_by in the ledger (agent at ring %s)"
                         % (gone_id, as_ring))

    def node_at_head(self, rel):
        """The leaf as committed at HEAD, or None."""
        try:
            out = subprocess.run(["git", "-C", self.root, "show", "HEAD:" + rel],
                                 capture_output=True, text=True, check=True).stdout
            data, body = parse_frontmatter(out)
            return Leaf(os.path.join(self.root, rel), data, body)
        except (OSError, subprocess.CalledProcessError, ValueError):
            return None

    def git_status(self):
        """[(code, path, old_path)] from git, or None without git.  dte:B15"""
        try:
            out = subprocess.run(
                ["git", "-C", self.root, "status", "--porcelain", "--untracked-files=all"],
                capture_output=True, text=True, check=True).stdout
        except (OSError, subprocess.CalledProcessError):
            return None
        rows = []
        for line in out.splitlines():
            if len(line) < 4:
                continue
            xy, path, old = line[:2], line[3:], None
            if " -> " in path:
                old, path = path.split(" -> ", 1)
                old = old.strip('"').replace("\\", "/")
            path = path.strip('"').replace("\\", "/")
            code = "R" if "R" in xy else ("D" if "D" in xy else xy.strip() or "M")
            rows.append((code, path, old))
        return rows

    def changed_files(self):
        """(set of changed relpaths, exact?)"""
        rows = self.git_status()
        if rows is None:
            return {self.rel(n.path) for n in self.leaves.values()}, False
        return {p for _, p, _ in rows}, True

    def retired_paths(self):
        """Leaf files git says were deleted or renamed, excluding the inbox.  dte:B24"""
        rows = self.git_status()
        if rows is None:
            return []
        dec = self.rel(self.decisions_dir) + "/"
        inbox = dec + INBOX_DIR + "/"
        out = []
        for code, path, old in rows:
            gone = old if code == "R" else (path if code == "D" else None)
            if gone and gone.startswith(dec) and not gone.startswith(inbox) and gone.endswith(".md"):
                out.append((code, gone))
        return out

    def scope_findings(self):
        """Advisory scope checks.  dte:B21"""
        self.validate()
        frac, minimum = CONFIG["broad_fraction"], CONFIG["broad_min"]
        impl = defaultdict(set)
        core_lines = []
        for rel, ln, cid, r in self.citations:
            if not r or self.layer_of(rel) == "docs":   # dte:B37 docs describe; specs, tests, agents, code reach
                continue
            impl[r].add(rel)
            if self.leaves[r].ring == "A":
                core_lines.append((rel, ln, r))
        n_noncore = sum(1 for n in self.leaves.values() if n.ring != "A" and n.in_effect)
        n_art = len(self.scanned_files)
        F = []
        for n in self.ordered_leaves():
            if not n.in_effect:
                continue
            for p in n.parents:
                pid = self.resolve(p)
                # a skip the owner made or accepted is deliberate: under a human-held parent, or on a human-held leaf
                if pid and (n.human_held or self.leaves[pid].human_held):
                    continue
                if pid and ring_depth(n.ring) - ring_depth(self.leaves[pid].ring) > 1:
                    between = chr(ord(n.ring) - 1)
                    F.append(("skipped ring", n.id,
                              "parent %s is at ring %s; a ring %s decision is missing, or %s belongs at ring %s"
                              % (pid, self.leaves[pid].ring, between, n.id, between)))
            if n.ring == "A":
                continue
            desc = self.descendants(n.id)
            files = set()
            for d in [n.id] + list(desc):
                files |= impl.get(d, set())
            if not desc and not files:
                F.append(("no reach", n.id,
                          "nothing exists because of it: no descendants, no citing spec, code, test or agent instruction; retire it, or cite it from what it governs"))
                continue
            d_share = len(desc) / n_noncore if n_noncore else 0.0
            f_share = len(files) / n_art if n_art else 0.0
            if (len(desc) >= minimum and d_share >= frac) or (len(files) >= minimum and f_share >= frac):
                F.append(("broad", n.id,
                          "%d descendants (%d%% of non-core) and %d implementing files (%d%% of artifacts); promote it, or split it into several decisions"
                          % (len(desc), 100 * d_share, len(files), 100 * f_share)))
        for rel, ln, r in core_lines:
            F.append(("core-only code", "%s:%d" % (rel, ln),
                      "cites core leaf %s directly; no rule-level decision explains this line, add one or cite something more specific" % r))
        return F

    def unratified(self):
        """Shallowest ring first, then widest: an unsettled rule high up unsettles everything under it.  dte:C23"""
        un = [n for n in self.ordered_leaves()
              if n.made_by in ("ai", "joint") and not n.ratified_by and n.in_effect]
        return sorted(un, key=lambda n: (ring_depth(n.ring), -len(self.descendants(n.id)), n.number))

    LAYERS = ("tests", "specs", "agents", "docs")
    LAYER_LABEL = {"tests": "enforced by", "specs": "specified by", "agents": "instructs",
                   "docs": "described by", "code": "implemented by"}

    def covered_by(self, rel):
        """The spec files whose `covers:` globs match this artifact.  dte:B22"""
        return [spec for spec, globs in self.spec_covers.items() if self._ignored(rel, globs)]

    def covered_files(self, spec):
        """Every scanned artifact a spec's `covers:` globs match, the spec itself excepted."""
        globs = self.spec_covers.get(spec, [])
        return [f for f in self.scanned_files if f != spec and self._ignored(f, globs)] if globs else []

    def layer_of(self, rel):
        """Which layer below the tree a citing artifact belongs to, by the dte.cfg globs.  dte:B37"""
        for layer in self.LAYERS:
            if self._ignored(rel, list(CONFIG[layer])):
                return layer
        return "code"

    def cited_by(self, i):
        """{layer: {rel: [lines]}} every artifact citing i, grouped by layer. A file a citing spec
        `covers:` counts as implementing i through that spec (its "line" names the spec)."""
        out = defaultdict(lambda: defaultdict(list))
        for rel, ln, cid, r in self.citations:
            if r == i:
                out[self.layer_of(rel)][rel].append(ln)
        for spec in list(out.get("specs", {})):
            for f in self.covered_files(spec):
                if f not in out.get(self.layer_of(f), {}):
                    out[self.layer_of(f)][f].append("via " + spec)
        return out

    def renumbered_paths(self):
        """Deleted or renamed leaf files whose HEAD uuid lives on under another id: a renumber, not a deletion.  dte:B58"""
        live = {n.uuid: n.id for n in self.leaves.values() if n.uuid}
        out = set()
        for code, rel in self.retired_paths():
            old = self.node_at_head(rel)
            if old is not None and old.uuid and live.get(old.uuid) not in (None, old.id):
                out.add(rel)
        return out

    def departing_branch_local(self, here):
        """Deleted leaf files that HEAD marks as another branch's (own `branch:` or an ancestor's)."""
        gone = {}
        for code, rel in self.retired_paths():
            old = self.node_at_head(rel)
            if old is not None:
                gone[old.id] = (rel, old)
        memo = {}

        def owner(i):
            if i in memo:
                return memo[i]
            memo[i] = ""
            if i in gone:
                n = gone[i][1]
            else:
                return self.branch_of(i)
            b = n.branch or next((owner(p) for p in n.parents if owner(p)), "")
            memo[i] = b
            return b
        return {rel for i, (rel, _) in gone.items() if owner(i) and owner(i) != here}

    def body_citations(self, node):
        """Ids cited in a leaf's body outside History and Contest, which record other times."""
        out = []
        skip = False
        for line in node.body.replace("\r\n", "\n").split("\n"):
            if line.startswith("## "):
                skip = line.strip() in ("## History", "## Contest")
                continue
            if not skip:
                out.extend(cited_ids(line))
        return out

    def enforced_ids(self):
        """Ids some test-layer file cites."""
        self.scan()
        return {r for rel, _, _, r in self.citations if r and self.layer_of(rel) == "tests"}

    def body_changes(self):
        """[(leaf, logged)] leaves whose body differs from HEAD; logged when a History line HEAD lacks
        is present, or a wording-only sweep vouched for this exact body.  dte:B61,B17"""
        changed, exact = self.changed_files()
        if not exact:
            return []
        by_path = {self.rel(n.path): n for n in self.leaves.values()}
        out = []
        for rel in sorted(changed):
            node = by_path.get(rel)
            if node is None:
                continue
            old = self.node_at_head(rel)
            if old is None:
                continue
            # whitespace-insensitive: a reflow for the reading surface is not a body edit (B61)
            strip = lambda b: re.sub(r"\s+", " ", re.sub(r"\n## History\n.*", "", b.replace("\r\n", "\n"), flags=re.S)).strip()
            if strip(old.body) != strip(node.body):
                hist = lambda b: [l for l in b.replace("\r\n", "\n").split("\n") if l.startswith("- ")]
                old_h = set(hist(_section(old.body, "## History")))
                new_h = hist(_section(node.body, "## History"))
                logged = any(l not in old_h for l in new_h) or body_hash(node.body) in self.editorial.get(node.id, ())
                out.append((node, logged))
        return out

    # -- scanning  dte:B3
    def _ignores(self):
        pats = []
        p = os.path.join(self.root, ".dteignore")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        pats.append(line)
        return pats

    def _ignored(self, rel, pats):
        parts = rel.split("/")
        for pat in pats:
            pat = pat.rstrip("/")
            if fnmatch.fnmatch(rel, pat) or any(fnmatch.fnmatch(p, pat) for p in parts):
                return True
            if fnmatch.fnmatch(rel, pat + "/*") or rel.startswith(pat + "/"):
                return True
        return False

    def coverage_exclusions(self):
        """[(why, [globs])] from ROOT/.dtecoverage; a glob before any why: line is an error.  dte:B22"""
        p = os.path.join(self.root, COVERAGE_FILE)
        groups = []
        if not os.path.exists(p):
            return groups
        cur = None
        with open(p, encoding="utf-8") as fh:
            for ln, line in enumerate(fh, 1):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("why:"):
                    why = line[4:].strip()
                    if not why:
                        raise ValueError("%s:%d: empty why:" % (COVERAGE_FILE, ln))
                    cur = (why, [])
                    groups.append(cur)
                    continue
                if cur is None:
                    raise ValueError("%s:%d: a glob before any 'why:' line" % (COVERAGE_FILE, ln))
                cur[1].append(line)
        return groups

    def excluded_from_coverage(self):
        """({rel: why} for every UNCITED scanned file an exclusion matches, [stale globs]).
        A citing file is never excluded: the store says which files need no citation, and
        one that cites anyway simply counts. A glob matching no scanned file at all is stale.  dte:B22"""
        self.scan()
        cited = {r for r, _, _, _ in self.citations}
        for spec in self.spec_covers:
            if spec in cited:
                cited |= set(self.covered_files(spec))
        out, stale = {}, []
        for why, globs in self.coverage_exclusions():
            for g in globs:
                hit = False
                for rel in self.scanned_files:
                    if self._ignored(rel, [g]):
                        hit = True
                        if rel not in cited:
                            out.setdefault(rel, why)
                if not hit:
                    stale.append(g)
        return out, stale

    def scan(self):
        if self.scanned_files:
            return
        pats = self._ignores()
        dec_rel = self.rel(self.decisions_dir)
        me = os.path.abspath(__file__)   # the tool's own citations belong to DTE's tree, not the adopter's
        for dirpath, dirs, files in os.walk(self.root):
            dirs[:] = sorted(d for d in dirs if d != ".git"
                             and not self._ignored(self.rel(os.path.join(dirpath, d)), pats))
            for fn in sorted(files):
                path = os.path.join(dirpath, fn)
                rel = self.rel(path)
                if rel == dec_rel or rel.startswith(dec_rel + "/") or self._ignored(rel, pats):
                    continue
                if rel == COVERAGE_FILE:   # the coverage store is metadata about artifacts, not one
                    continue
                if os.path.abspath(path) == me and not CONFIG.get("scan_self"):
                    continue
                try:
                    with open(path, "rb") as fh:
                        head = fh.read(8192)
                    if b"\x00" in head:
                        continue
                    with open(path, encoding="utf-8", errors="replace") as fh:
                        lines = fh.read().splitlines()
                except OSError:
                    continue
                self.scanned_files.append(rel)
                for ln, line in enumerate(lines, 1):
                    for cid in cited_ids(line):
                        self.citations.append((rel, ln, cid, self.resolve(cid)))
                if self.layer_of(rel) == "specs":
                    for line in lines[:30]:
                        m = COVERS_RE.search(line)
                        if m:
                            self.spec_covers[rel] = [g.strip(" -") for g in m.group(1).split(",") if g.strip(" -")]
                            break

    # -- queries
    def descendants(self, i):
        """Transitive children, as {id: depth}.  dte:C2"""
        out, stack = {}, [(c, 1) for c in self.children.get(i, [])]
        while stack:
            c, d = stack.pop()
            if c in out:
                continue
            out[c] = d
            stack.extend((g, d + 1) for g in self.children.get(c, []))
        return out

    MAX_CHAINS = 64

    def ancestors(self, i):
        """Parent chains from i to the core, memoised and capped: a leaf with several
        parents in each of several rings has combinatorially many chains."""
        memo = self.__dict__.setdefault("_anc", {})
        if i in memo:
            return memo[i]
        node = self.leaves[i]
        if not node.parents:
            memo[i] = [[i]]
            return memo[i]
        chains = []
        for p in node.parents:
            pid = self.resolve(p)
            if pid is None:
                chains.append([i, p + "?"])
                continue
            for chain in self.ancestors(pid):
                chains.append([i] + chain)
                if len(chains) >= self.MAX_CHAINS:
                    break
            if len(chains) >= self.MAX_CHAINS:
                break
        memo[i] = chains
        return chains


# ---------------------------------------------------------------- commands

def report(tree, show_unratified=True, full=False):
    for e in tree.errors:
        print("ERROR   " + e)
    for w in tree.warnings:
        print("WARNING " + w)
    if tree.inbox:
        print_inbox(tree)
    if show_unratified:
        un = tree.unratified()
        if un and full:
            print_unratified(tree, un)
        elif un:
            contested = sum(1 for n in un if n.contested_by)
            imported = sum(1 for n in un if n.imported)
            print("\nUnratified AI/joint decisions: %d (%d contested, %d imported); list: dte unratified  dte:B59, dte:B60"
                  % (len(un), contested, imported))
            top = [n for n in un if ring_depth(n.ring) <= 1]
            if top:   # dte:C23 everything under these inherits an unsettled rule, so they are named
                print("  in rings A and B (%d), everything under them inherits an unsettled rule:" % len(top))
                for n in top:
                    print("    %s  [%d below]" % (n.label(), len(tree.descendants(n.id))))


def print_unratified(tree, un=None):
    """dte:C23 the full list lives behind its own command so validate stays short"""
    un = tree.unratified() if un is None else un
    if not un:
        print("No unratified AI/joint decisions.")
        return
    contested = sum(1 for n in un if n.contested_by)
    print("Unratified AI/joint decisions (%d, %d contested):  dte:B59, dte:B60" % (len(un), contested))
    for n in un:
        who = ("  contested by %s" % n.contested_by) if n.contested_by else ""
        imp = "  imported" if n.imported else ""
        print("  %s  [%d below]%s%s" % (n.label(), len(tree.descendants(n.id)), who, imp))


def cmd_unratified(tree, args):
    tree.validate()
    print_unratified(tree)
    return 0


def print_inbox(tree):
    """dte:B14, dte:B42"""
    gaps = [it for it in tree.inbox if it.kind == "gap"]
    decisions = [it for it in tree.inbox if it.kind != "gap"]
    if gaps:
        print("\nSPEC GAPS (%d), the spec is silent; whoever holds the spec answers in the spec, then removes the file:" % len(gaps))
        for it in gaps:
            print('  %s  "%s"  in %s  (%s by %s)' % (it.slug, it.title, it.spec, it.made_by, it.by))
    if not decisions:
        return
    print("\nPENDING PLACEMENT (%d), no ID until placed:" % len(decisions))
    for it in decisions:
        who = it.ask or (holder_of(it.proposed_ring, CONFIG) if it.proposed_ring else "the human")
        ring = ("proposed ring %s" % it.proposed_ring) if it.proposed_ring else "ring unknown"
        print('  %s  "%s"  (%s, %s by %s)' % (it.slug, it.title, ring, it.made_by, it.by))
        print("    ASK %s: where does this belong?  then: dte place %s <ring> --by <name>" % (who, it.slug))


def print_changed_leaves(tree):
    """dte:B17"""
    changed, exact = tree.changed_files()
    if not exact:
        return
    by_path = {tree.rel(n.path): n for n in tree.leaves.values()}
    hits = [by_path[r] for r in sorted(changed) if r in by_path]
    if not hits:
        return
    bodies = {n.id: logged for n, logged in tree.body_changes()}
    print("\nLeaves changed in this working tree (report these, ID plus name):  dte:B17")
    for n in sorted(hits, key=lambda n: id_key(n.id)):
        note = ""
        if n.id in bodies:
            note = "  [body changed%s]" % ("" if bodies[n.id] else ", no History line")
        print("  %s%s" % (n.label(), note))


def comment_census(tree):
    """Per code-layer file: (comment lines, citation lines).  A heuristic for B38: files
    heavy in prose comments and light in citations are where WHY still lives in the code."""
    tree.scan()
    cited = defaultdict(int)
    for rel, _, _, _ in tree.citations:
        cited[rel] += 1
    out = []
    for rel in tree.scanned_files:
        if tree.layer_of(rel) != "code":
            continue
        ext = os.path.splitext(rel)[1].lower()
        if ext in NO_COMMENTS:
            continue
        marker = next((m for m, exts in COMMENT_STYLES if ext in exts), "#")
        n = 0
        try:
            with open(os.path.join(tree.root, rel), encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    s = line.strip()
                    if s.startswith(marker) or (marker == "/*" and s.startswith("*")):
                        n += 1
        except OSError:
            continue
        out.append((rel, n, cited[rel]))
    return out


COMMENT_HEAVY = 5


def cmd_scope(tree, args):
    """dte:B21, dte:B38"""
    if getattr(args, "comments", False):
        try:
            excluded, _ = tree.excluded_from_coverage()
        except ValueError as e:
            print(e)
            return 2
        rows = [(rel, n, c) for rel, n, c in comment_census(tree)
                if n >= COMMENT_HEAVY and c == 0 and rel not in excluded]
        rows.sort(key=lambda r: -r[1])
        if not rows:
            print("No migration candidates: every file with %d+ comment lines carries a citation." % COMMENT_HEAVY)
            return 0
        print("MIGRATION CANDIDATES (%d): comment-heavy files with no citation (B38)" % len(rows))
        for rel, n, _ in rows:
            print("  %-50s %4d comment lines" % (rel, n))
        print("\nWHY comments move into a leaf's Why; HOW into a spec; WHAT stays. A heuristic, not a finding.")
        return 0
    F = tree.scope_findings()
    if not F:
        print("No scope findings.")
        return 0
    by_kind = defaultdict(list)
    for kind, subject, msg in F:
        by_kind[kind].append((subject, msg))
    for kind in ("no reach", "broad", "skipped ring", "core-only code"):
        if kind not in by_kind:
            continue
        print("%s (%d):" % (kind.upper(), len(by_kind[kind])))
        for subject, msg in by_kind[kind]:
            label = tree.leaves[subject].label() if subject in tree.leaves else subject
            print("  %s\n    %s" % (label, msg))
        print()
    print("%d findings. Advisory: thresholds and docs globs are in dte.cfg." % len(F))
    return 0


def cmd_validate(tree, args):
    ok = tree.validate(as_ring=args.as_ring)
    report(tree, full=args.full)
    print_changed_leaves(tree)
    n_out = len(tree.outbox_items())
    if n_out:
        print("\nOUTBOX (%d): the human designated things in the vault for an agent; run dte outbox" % n_out)
    F = tree.scope_findings()
    if F:
        print("\n%d scope findings (advisory): run dte scope" % len(F))
    n_cited = len({r for r, _, _, _ in tree.citations})
    print("\n%d leaves, %d pending, %d citations in %d/%d artifacts, %d errors, %d warnings"
          % (len(tree.leaves), len(tree.inbox), len(tree.citations), n_cited,
             len(tree.scanned_files), len(tree.errors), len(tree.warnings)))
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


def cmd_tree(tree, args):
    tree.validate()
    if tree.errors:
        report(tree, show_unratified=False)
        print()
    cited_by = defaultdict(set)
    for rel, _, _, r in tree.citations:
        if r:
            cited_by[r].add(rel)
    seen = set()

    def walk(i, depth):
        node = tree.leaves[i]
        marker = " (again)" if i in seen else ""
        print("  " * depth + node.label() + marker)
        if i in seen:
            return
        seen.add(i)
        if args.files and cited_by.get(i):
            for f in sorted(cited_by[i]):
                print("  " * (depth + 1) + "- " + f)
        for c in tree.ordered(tree.children.get(i, [])):
            walk(c, depth + 1)

    if args.under:
        if args.under not in tree.leaves:
            print("unknown id: %s (%s)" % (args.under, tree.retired_hint(args.under)))
            return 2
        walk(args.under, 0)
        return 0
    for i in tree.ordered():
        if tree.leaves[i].ring == "A":
            walk(i, 0)
    stray = [i for i in tree.ordered() if tree.leaves[i].ring != "A" and i not in seen]
    if stray:
        print("\nNot reachable from the core:")
        for i in stray:
            print("  " + tree.leaves[i].label())
    if tree.inbox:
        print_inbox(tree)
    return 0


def cmd_blast(tree, args):
    """dte:C2"""
    tree.validate()
    target = tree.resolve(args.id)
    if target is None:
        print("unknown id: %s" % args.id)
        return 2
    node = tree.leaves[target]
    print("BLAST RADIUS of %s\n" % node.label())
    if node.human_held:
        print("  This leaf is human-held. Changing it needs authorized_by from a human.  dte:B11\n")
    desc = tree.descendants(target)
    by_ring = defaultdict(list)
    for d in desc:
        by_ring[tree.leaves[d].ring].append(d)
    print("Descendant decisions (%d):" % len(desc))
    if not desc:
        print("  none")
    for ring in sorted(by_ring):
        print("  ring %s:" % ring)
        for d in tree.ordered(by_ring[ring]):
            n = tree.leaves[d]
            print("    %s  via %s" % (n.label(), ", ".join(
                p for p in n.parents if tree.resolve(p) in desc or tree.resolve(p) == target)))
    affected = {target} | set(desc)
    hits = defaultdict(list)
    for rel, ln, cid, r in tree.citations:
        if r in affected:
            hits[rel].append((ln, cid))
    print("\nCiting artifacts (%d files):" % len(hits))
    if not hits:
        print("  none")
    for rel in sorted(hits):
        print("  %s  %s" % (rel, ", ".join("%s@%d" % (c, ln) for ln, c in sorted(hits[rel]))))
    for spec in sorted(hits):
        covered = tree.covered_files(spec) if spec in tree.spec_covers else []
        if covered:
            print("\nBuilt to %s (covers: %s), %d files:" % (spec, ", ".join(tree.spec_covers[spec]), len(covered)))
            for f in covered:
                print("  " + f)
    if node.supersedes:
        print("\nCurrently superseded by %s (candidates to return if %s is reverted):" % (target, target))
        for s in node.supersedes:
            sid = tree.resolve(s)
            if sid:
                print("  " + tree.leaves[sid].label())
            elif s in tree.retired:
                print('  %s "%s"  %s' % (s, tree.retired[s]["title"], tree.retired_hint(s)))
            else:
                print("  %s (unknown)" % s)
    rings = sorted(set(by_ring) | {node.ring})
    print("\nLayers touched: %s.  %d decisions, %d artifacts."
          % (", ".join(rings), len(affected), len(hits)))
    return 0


def cmd_trace(tree, args):
    tree.validate()
    rel = tree.rel(os.path.abspath(args.path)) if os.path.exists(args.path) else args.path
    cites = [(ln, cid, r) for f, ln, cid, r in tree.citations if f == rel]
    if not cites:
        print("%s: no citations. Nobody has said why this exists.  (dte:B22)" % rel)
        return 1
    print("WHY %s EXISTS\n" % rel)
    seen = set()
    for ln, cid, r in cites:
        if r is None:
            print("  line %d cites unknown %s" % (ln, cid))
            continue
        if r in seen:
            continue
        seen.add(r)
        print("  line %d cites %s" % (ln, r))
        for chain in tree.ancestors(r):
            print("    " + "  <-  ".join(chain))
    order = []
    for r in seen:
        for chain in tree.ancestors(r):
            for i in chain:
                if i in tree.leaves and i not in order:
                    order.append(i)
    order.sort(key=lambda i: (-ring_depth(tree.leaves[i].ring), id_key(i)))
    print("\nDecisions, most specific first:")
    for i in order:
        print("  " + tree.leaves[i].label())
    return 0


def cmd_conflicts(tree, args):
    """dte:B4"""
    tree.validate()
    pairs = set()
    for n in tree.leaves.values():
        for c in n.conflicts_with:
            cid = tree.resolve(c)
            if cid:
                pairs.add(tuple(sorted((n.id, cid), key=id_key)))
    if not pairs:
        print("No declared contradictions.")
        return 0
    for a, b in sorted(pairs, key=lambda p: (id_key(p[0]), id_key(p[1]))):
        na, nb = tree.leaves[a], tree.leaves[b]
        if not (na.in_effect and nb.in_effect):
            verdict = "moot (%s is %s, %s is %s)" % (a, na.status, b, nb.status)
        elif ring_depth(na.ring) < ring_depth(nb.ring):
            verdict = "%s wins (ring %s over %s)" % (a, na.ring, nb.ring)
        elif ring_depth(na.ring) > ring_depth(nb.ring):
            verdict = "%s wins (ring %s over %s)" % (b, nb.ring, na.ring)
        else:
            verdict = "UNRESOLVED: same ring; supersede or move one"
        print("%s  vs  %s  ->  %s" % (na.label(), nb.label(), verdict))
    return 0


def coverage_gauges(tree):
    """The three hops, each a gauge: artifact -> spec or leaf, spec -> leaf, MUST -> test.  dte:B45,B44,B46"""
    tree.validate()
    cited = {r for r, _, _, _ in tree.citations}
    direct = set(cited)
    via = set()
    for spec in tree.spec_covers:
        if spec in direct:
            via |= set(tree.covered_files(spec))
    cited |= via
    excluded, stale = tree.excluded_from_coverage()
    stale += ["%s covers: %s" % (spec, g) for spec, globs in tree.spec_covers.items()
              for g in globs if not any(tree._ignored(f, [g]) for f in tree.scanned_files if f != spec)]
    scoped = [f for f in tree.scanned_files if f not in excluded]
    missing = [f for f in scoped if f not in cited]
    specs = [f for f in scoped if tree.layer_of(f) == "specs"]
    spec_missing = [f for f in specs if f not in direct]
    enforced = tree.enforced_ids()
    musts = [n for n in tree.ordered_leaves() if n.in_effect and n.has_must()]
    m_tested = [n for n in musts if n.id in enforced]
    m_labeled = [n for n in musts if n.id not in enforced and UNENFORCED_RE.search(n.body)]
    m_bare = [n for n in musts if n.id not in enforced and not UNENFORCED_RE.search(n.body)]
    heavy = [(rel, k) for rel, k, c in comment_census(tree)
             if rel in via and rel not in direct and k >= COMMENT_HEAVY]
    heavy.sort(key=lambda r: -r[1])
    return dict(scoped=scoped, missing=missing, excluded=excluded, stale=stale, via=via, specs=specs,
                spec_missing=spec_missing, musts=musts, m_tested=m_tested, m_labeled=m_labeled, m_bare=m_bare,
                heavy=heavy)


def _pct(n, total):
    return 100.0 * n / total if total else 100.0


def cmd_coverage(tree, args):
    """dte:B22, dte:B45"""
    try:
        g = coverage_gauges(tree)
    except ValueError as e:
        print(e)
        return 2
    total, miss = len(g["scoped"]), len(g["missing"])
    print("Coverage, one gauge per hop (100% is the target; B45):\n")
    print("  artifacts  %4d/%-4d %5.1f%%  cite a leaf, or are built to a spec that does%s"
          % (total - miss, total, _pct(total - miss, total),
             ("  (%d through a spec's covers:)" % len(g["via"])) if g["via"] else ""))
    ns, sm = len(g["specs"]), len(g["spec_missing"])
    print("  specs      %4d/%-4d %5.1f%%  cite the leaf they serve" % (ns - sm, ns, _pct(ns - sm, ns)))
    nm = len(g["musts"])
    print("  MUSTs      %4d/%-4d %5.1f%%  enforced by a citing test (%d more labeled *Unenforced:*)"
          % (len(g["m_tested"]), nm, _pct(len(g["m_tested"]), nm), len(g["m_labeled"])))
    excluded = g["excluded"]
    if excluded:
        by_why = defaultdict(list)
        for rel, why in excluded.items():
            by_why[why].append(rel)
        print("\nExcluded from the artifacts gauge (%s, %d files under %d reason%s):"
              % (COVERAGE_FILE, len(excluded), len(by_why), "" if len(by_why) == 1 else "s"))
        for why, rels in by_why.items():
            print("  %4d  %s" % (len(rels), why))
            if getattr(args, "excluded", False):
                for rel in sorted(rels):
                    print("          " + rel)
        if not getattr(args, "excluded", False):
            print("  (--excluded lists the files)")
    if g["stale"]:
        print("\nStale exclusions or covers: globs (match nothing; delete them):")
        for x in g["stale"]:
            print("  " + x)
    if g["missing"]:
        print("\nNo citation and no spec (%d):" % miss)
        for f in g["missing"]:
            print("  " + f)
    if g["spec_missing"]:
        print("\nSpecs that cite no leaf (%d):" % sm)
        for f in g["spec_missing"]:
            print("  " + f)
    if g["m_bare"]:
        print("\nMUSTs neither tested nor labeled (%d); cite each from its test, or add *Unenforced:* (B46):" % len(g["m_bare"]))
        for n in g["m_bare"]:
            print("  " + n.label())
    if g["heavy"]:
        print("\nNext worklist: covered only through a spec's covers:, yet %d+ comment lines (WHY may still live there, B38):"
              % COMMENT_HEAVY)
        for rel, k in g["heavy"][:25]:
            print("  %-56s %4d comment lines" % (rel, k))
        if len(g["heavy"]) > 25:
            print("  ... %d more" % (len(g["heavy"]) - 25))
    bad = miss + len(g["stale"]) + sm + (len(g["m_bare"]) if CONFIG.get("must_test") else 0)
    if getattr(args, "check", False) and bad:
        print("\ncoverage --check: %d uncited, %d stale, %d specs uncited, %d MUSTs unlabeled"
              % (miss, len(g["stale"]), sm, len(g["m_bare"]) if CONFIG.get("must_test") else 0))
        return 1
    return 0


def branch_ids(tree):
    """Ids present on every branch git knows about, so parallel branches never mint the same number.  dte:C15"""
    cache = tree.__dict__.get("_branch_ids")
    if cache is not None:
        return cache
    found = set()
    try:
        refs = subprocess.run(
            ["git", "-C", tree.root, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
            capture_output=True, text=True, check=True).stdout.split()
        dec = tree.rel(tree.decisions_dir)
        for ref in refs:
            ls = subprocess.run(["git", "-C", tree.root, "ls-tree", "-r", "--name-only", ref, "--", dec],
                                capture_output=True, text=True).stdout
            for path in ls.splitlines():
                base = os.path.splitext(os.path.basename(path))[0]
                if path.endswith(".md") and ID_RE.match(base):
                    found.add(base)
            led = subprocess.run(["git", "-C", tree.root, "show", "%s:%s/%s" % (ref, dec, LEDGER)],
                                 capture_output=True, text=True).stdout
            for line in led.splitlines():
                first = line.split("\t", 1)[0]
                if ID_RE.match(first):
                    found.add(first)
    except (OSError, subprocess.CalledProcessError):
        pass
    tree._branch_ids = found
    return found


def next_id(tree, ring):
    """Numbers are never reused: not from the tree, the ledger, or any branch.  dte:B32,C15"""
    used = [n.number for n in tree.leaves.values() if n.ring == ring]
    used += [int(ID_RE.match(i).group(2)) for i in tree.retired if i.startswith(ring)]
    used += [int(ID_RE.match(i).group(2)) for i in branch_ids(tree) if i.startswith(ring)]
    return "%s%d" % (ring, (max(used) + 1) if used else 1)


def cmd_next(tree, args):
    ring = args.ring.upper()
    if not re.match(r"^[A-Z]$", ring):
        print("ring must be a single letter A-Z")
        return 2
    print(next_id(tree, ring))
    return 0


def cmd_outbox(tree, args):
    """The human's edits in the vault, as a work list; --done clears one item once processed."""
    if args.done:
        return outbox_done(tree, args.done)
    items = tree.outbox_items()
    if not items:
        print("Outbox empty. The human has designated nothing for an agent.")
        return 0
    print("OUTBOX (%d): process each, then clear it. The author's word is the authorization." % len(items))
    for kind, ref, label, todo in items:
        print("  [%s] %s" % (kind, label))
        print("      %s" % todo)
    return 0


def outbox_done(tree, ref):
    for slug, title, path in tree.outbox:
        if slug == ref:
            os.remove(path)
            print('removed outbox note "%s" (%s)' % (title, tree.rel(path)))
            return 0
    node = tree.leaves.get(ref)
    if node is None:
        print("no outbox note or leaf called %s" % ref)
        return 2
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    text = drop_list_items(text, "tags", lambda t: t.lstrip("#") in ACTIONS)
    # a paragraph that opens with the tag is a message to the agent and goes whole;
    # a tag inside a sentence marks the author's own text, so only the tag goes
    text = re.sub(r"(?m)^[ \t]*#(?:ratify|retire|contest|ask)\b[^\n]*\n?(?:(?![ \t]*(?:[-#|>*]|\d+\.|$))[^\n]+\n?)*", "", text)
    text = ACTION_TAG_RE.sub("", text)
    text = re.sub(r"[ \t]+$", "", text, flags=re.M).rstrip("\n") + "\n"
    write_text(node.path, text.replace("\n", nl))
    print("cleared the action tags on %s" % node.label())
    return 0


def drop_list_items(text, key, pred):
    """Remove items matching pred from a frontmatter list, inline or block form; drop the key when empty."""
    lines = text.split("\n")
    end = lines.index("---", 1)
    for k in range(1, end):
        name, _, raw = lines[k].partition(":")
        if name.strip() != key:
            continue
        raw = raw.strip()
        if raw.startswith("["):
            items = [x for x in (_scalar(i) for i in raw[1:-1].split(",")) if x]
            span = (k, k + 1)
        else:
            j = k + 1
            while j < end and lines[j].strip().startswith("- "):
                j += 1
            items = [_scalar(lines[x].strip()[2:]) for x in range(k + 1, j)]
            span = (k, j)
        keep = [x for x in items if not pred(x)]
        new = ["%s: [%s]" % (key, ", ".join(keep))] if keep else []
        return "\n".join(lines[:span[0]] + new + lines[span[1]:])
    return text


def cmd_inbox(tree, args):
    """dte:B14"""
    if not tree.inbox:
        print("Inbox empty. Nothing waiting to be placed.")
        return 0
    print_inbox(tree)
    return 0


def cmd_place(tree, args):
    """dte:B14"""
    ring = args.ring.upper()
    if not re.match(r"^[A-Z]$", ring):
        print("ring must be a single letter A-Z")
        return 2
    item = next((it for it in tree.inbox if it.slug == args.slug), None)
    if item is None:
        print("no inbox item named %r; run: dte inbox" % args.slug)
        return 2
    if item.kind == "gap":
        print("%s is a spec gap, not a decision: answer it in %s, then remove the file (B42)" % (args.slug, item.spec))
        return 2
    parents = [p.strip() for p in (args.parents or "").split(",") if p.strip()] or item.parents
    if ring == "A" and parents:
        print("ring A leaves cannot have parents")
        return 2
    if ring != "A" and not parents:
        print("a ring %s leaf needs parents; pass --parents A1,B2" % ring)
        return 2
    for p in parents:
        pid = tree.resolve(p)
        if pid is None:
            print("parent %s does not exist" % p)
            return 2
        if ring_depth(tree.leaves[pid].ring) >= ring_depth(ring):
            print("parent %s is not shallower than ring %s" % (pid, ring))
            return 2
    new_id = next_id(tree, ring)
    today = datetime.date.today().isoformat()
    fm = build_frontmatter(lean_fields(new_id, item.title, parents, item.name, made_by=item.made_by,
                                       date=str(item.raw.get("date") or today))).rstrip("\n").split("\n")
    body = item.body.rstrip("\n")
    history = "\n\n## History\n\n" if "## History" not in body else "\n"
    body += history + "- %s placed at ring %s as %s by %s (from inbox/%s).\n" % (
        today, ring, new_id, args.by, item.slug)
    dest_dir = os.path.join(tree.decisions_dir, ring)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, new_id + ".md")
    with open(dest, "w", encoding="utf-8") as fh:
        fh.write("\n".join(fm) + "\n" + body)
    os.remove(item.path)
    print('placed %s "%s" at %s' % (new_id, item.title, tree.rel(dest)))
    print("cite it as %s and re-run validate" % cite_text([new_id]))
    return 0


def set_field(text, key, value):
    """Replace or insert one frontmatter line by key."""
    lines = text.split("\n")
    end = lines.index("---", 1)
    new = "%s: %s" % (key, value) if value != "" else "%s:" % key
    for k in range(1, end):
        if lines[k].split(":", 1)[0].strip() == key:
            j = k + 1
            while j < end and re.match(r"^\s+-\s", lines[j]):   # a block list's items go with its key
                j += 1
            lines[k:j] = [new]
            return "\n".join(lines)
    lines.insert(end, new)
    return "\n".join(lines)


def read_text(path):
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def write_text(path, text):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def append_history(text, note):
    if re.search(r"^## History\s*$", text, re.M):
        return text.rstrip("\n") + "\n" + note + "\n"
    return text.rstrip("\n") + "\n\n## History\n\n" + note + "\n"


def retire_node(tree, node, action, successor, by, authorized_by, what):
    """Ledger line, then delete the file (delete mode) or set status (keep mode).  dte:B24"""
    tree.append_ledger(node.id, action, successor, by, authorized_by, node.summary)
    mode = CONFIG["retire"]
    if mode == "delete" and tree.git_status() is None:
        print("  WARNING: retire = delete needs git for history; keeping the file instead")
        mode = "keep"
    if mode == "delete":
        os.remove(node.path)
        return "%s; file deleted, ledger line written (text in git history)" % what
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    succ = successor if action != "to-spec" else ""
    text = set_field(text, "status", "superseded" if succ else "reverted")
    text = set_field(text, "superseded_by", fm_id(succ) if succ else "")
    if authorized_by:
        text = set_field(text, "authorized_by", authorized_by)
    text = append_history(text, "- %s %s by %s." % (datetime.date.today().isoformat(), what, by))
    write_text(node.path, text.replace("\n", nl))
    return "%s; file kept with status (retire = keep), ledger line written" % what


def rewrite_references(tree, old_id, new_id):
    """Every citation of OLD becomes NEW, with NEW's name where OLD's followed it, in artifacts and in
    leaf bodies (History excepted: it records what was true then); OLD -> NEW in children's parents.  dte:B32"""
    tree.scan()
    old_name = tree.leaves[old_id].name if old_id in tree.leaves else ""
    new_name = tree.leaves[new_id].name if new_id in tree.leaves else ""
    files = sorted({rel for rel, _, cid, _ in tree.citations if cid == old_id})
    for rel in files:
        path = os.path.join(tree.root, rel)
        write_text(path, rename_citations(read_text(path), old_id, new_id, old_name, new_name))
    for leaf in tree.ordered_leaves():
        if leaf.id == old_id or old_id not in tree.body_citations(leaf):
            continue
        text = read_text(leaf.path)
        head, sep, hist = text.partition("\n## History")
        write_text(leaf.path, rename_citations(head, old_id, new_id, old_name, new_name) + sep + hist)
    children = list(tree.children.get(old_id, []))
    for c in children:
        cpath = tree.leaves[c].path
        ctext = read_text(cpath)
        cnl = "\r\n" if "\r\n" in ctext else "\n"
        ctext = ctext.replace("\r\n", "\n")
        ps = [new_id if p == old_id else p for p in tree.leaves[c].parents]
        ctext = set_field(ctext, "parents", fm_ids(ps))
        write_text(cpath, ctext.replace("\n", cnl))
    return files, children


def cmd_retire(tree, args, carry_contest=False):
    """dte:B24. A contest travels to a successor only when that contest produced it (contest --record
    writing the winner); a leaf that merely absorbed the retired one did not get contested.  dte:B60"""
    tree.validate()
    old_id, new_id = args.id, args.superseded_by
    node = tree.leaves.get(old_id)
    if node is None:
        print("unknown id: %s (%s)" % (old_id, tree.retired_hint(old_id)))
        return 2
    if not node.in_effect and not new_id:
        new_id = str(node.superseded_by or "") or None
    if new_id:
        new = tree.leaves.get(new_id)
        if new is None:
            print("successor %s does not exist" % new_id)
            return 2
        if not new.in_effect:
            print("successor %s is %s" % (new_id, new.status))
            return 2
    if CONFIG["protect_human"] and node.human_held and not args.authorized_by:
        print("%s is human-held; retiring it needs --authorized-by <human>  (B11)" % old_id)
        return 2
    if node.in_effect:
        action = "superseded" if new_id else "reverted"
    else:
        action = node.status
    files = sorted({rel for rel, _, cid, _ in tree.citations if cid == old_id})
    children = list(tree.children.get(old_id, []))
    if new_id:
        t = read_text(new.path)
        nl = "\r\n" if "\r\n" in t else "\n"
        t = t.replace("\r\n", "\n")
        carried = _section(node.body, "## Contest") if (node.contested_by and carry_contest) else ""
        if carried:   # dte:B60 the contest that produced the successor travels with it, and settles it
            t = _insert_section(t, "## Contest",
                                "Carried from %s, which this leaf supersedes.\n\n%s" % (old_id, carried))
            if not new.contested_by:
                t = set_field(t, "contested_by", node.contested_by)
                t = append_history(t, "- %s settled by the contest of %s, which it supersedes (contested by %s)."
                                   % (datetime.date.today().isoformat(), old_id, node.contested_by))
        if CONFIG["retire"] == "keep" and old_id not in new.supersedes:
            t = set_field(t, "supersedes", fm_ids(new.supersedes + [old_id]))
        write_text(new.path, t.replace("\n", nl))
        rewrite_references(tree, old_id, new_id)
    fate = retire_node(tree, node, action, new_id, args.by, args.authorized_by,
                       ("superseded by %s" % new_id) if new_id else "reverted")
    print('retired %s "%s"' % (old_id, node.summary))
    print("  " + fate)
    if new_id:
        print("  rewrote %d citing file(s) and %d child(ren) to %s. REVIEW each: they were built under %s."
              % (len(files), len(children), new_id, old_id))
        for f in files:
            print("    " + f)
        for c in children:
            print("    %s" % tree.leaves[c].label())
    else:
        if files or children:
            print("  these now fail validation until re-pointed or retired (blast radius of the revert):")
            for f in files:
                print("    " + f)
            for c in children:
                print("    %s" % tree.leaves[c].label())
        if node.supersedes:
            print("  %s had superseded: %s. Candidates to return." % (old_id, ", ".join(node.supersedes)))
    return 0


def cmd_move(tree, args):
    """dte:B32"""
    tree.validate()
    old_id, ring = args.id, args.ring.upper()
    if not re.match(r"^[A-Z]$", ring):
        print("ring must be a single letter A-Z")
        return 2
    node = tree.leaves.get(old_id)
    if node is None:
        print("unknown id: %s" % old_id)
        return 2
    if not node.in_effect:
        print("%s is %s; only in-effect leaves move" % (old_id, node.status))
        return 2
    if node.ring == ring:
        print("%s is already at ring %s" % (old_id, ring))
        return 2
    if CONFIG["protect_human"] and node.human_held and not args.authorized_by:
        print("%s is human-held; a move supersedes it and needs --authorized-by <human>  (B11)" % old_id)
        return 2
    if args.parents:
        parents = [p.strip() for p in args.parents.split(",") if p.strip()]
    else:
        parents = [p for p in node.parents
                   if p in tree.leaves and ring_depth(tree.leaves[p].ring) < ring_depth(ring)]
    dropped = [p for p in node.parents if p not in parents]
    if ring == "A" and parents:
        print("ring A leaves cannot have parents")
        return 2
    if ring != "A" and not parents:
        print("no parent of %s is shallower than ring %s; pass --parents" % (old_id, ring))
        return 2
    for p in parents:
        if p not in tree.leaves:
            print("parent %s does not exist" % p)
            return 2
        if ring_depth(tree.leaves[p].ring) >= ring_depth(ring):
            print("parent %s is not shallower than ring %s" % (p, ring))
            return 2
    children = [c for c in tree.children.get(old_id, [])]
    for c in children:
        if ring_depth(tree.leaves[c].ring) <= ring_depth(ring):
            print("child %s is at ring %s, not deeper than %s; move or re-parent it first"
                  % (c, tree.leaves[c].ring, ring))
            return 2
    new_id = next_id(tree, ring)
    today = datetime.date.today().isoformat()
    # new leaf
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    text = set_field(text, "id", new_id)
    text = set_field(text, "uuid", new_uuid())   # a move makes a new leaf (B32); the ledger links the two
    text = set_field(text, "parents", fm_ids(parents))
    text = set_field(text, "ratified_by", "")
    text = set_field(text, "authorized_by", args.authorized_by or "")  # the human authorised this file too
    body_note = "- %s moved from %s to ring %s as %s by %s%s.%s" % (
        today, old_id, ring, new_id, args.by,
        (" (dropped parents: %s)" % ", ".join(dropped)) if dropped else "",
        "")
    if "## History" in text:
        text = text.rstrip("\n") + "\n" + body_note + "\n"
    else:
        text = text.rstrip("\n") + "\n\n## History\n\n" + body_note + "\n"
    dest_dir = os.path.join(tree.decisions_dir, ring)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, new_id + ".md")
    write_text(dest, text.replace("\n", nl))
    # old leaf
    fate = retire_node(tree, node, "moved", new_id, args.by, args.authorized_by,
                       "moved to ring %s as %s" % (ring, new_id))
    files, children = rewrite_references(tree, old_id, new_id)
    print('moved %s -> %s "%s" at %s' % (old_id, new_id, node.summary, tree.rel(dest)))
    print("  %s %s" % (old_id, fate))
    print("  parents: %s" % ", ".join(parents))
    if dropped:
        print("  DROPPED parents: %s  (their blast radius shrank; run dte blast on each)" % ", ".join(dropped))
    print("  rewrote citations in %d file(s): %s" % (len(files), ", ".join(files) or "none"))
    print("  re-parented %d child(ren): %s" % (len(children), ", ".join(children) or "none"))
    print("  precedence changed: run dte conflicts if %s has declared contradictions" % new_id)
    return 0


def cmd_authority(tree, args):
    """dte:B13"""
    if not CONFIG["authority"]:
        print("No authority map in dte.cfg. Default: ask the human for everything above your ring.")
    else:
        print("Authority map (advisory; binds agents, never humans):")
        for key, holder in CONFIG["authority"]:
            print("  %-3s %s" % (key, holder))
    rings = sorted({n.ring for n in tree.leaves.values()} | ({args.ring.upper()} if args.ring else set()))
    print("\nWhom to ask, per ring in use:")
    for r in rings:
        print("  %s: %s" % (r, holder_of(r, CONFIG)))
    return 0


# ---------------------------------------------------------------- authoring  dte:B29

CFG_TEMPLATE = """# DTE configuration. One key = value per line. Every key shown with its default.
#
# summaries: print "ID name: title" everywhere (on) or bare IDs (off).
summaries = on
#
# protect_human: leaves made or ratified by a human need authorized_by (a human's
# name) before they can be superseded, reverted, or moved.
protect_human = on
#
# authority: advisory map of who holds each ring. "C+" means C and deeper.
# Binds agents, never humans. Unmapped rings mean "ask the human".
authority = A:human, B:orchestrator, C+:subagent
#
# retire: delete removes a retired leaf's file (needs git; the ledger
# decisions/RETIRED burns the number and names any successor); keep sets a status instead.
retire = delete
#
# decisions: where the tree lives, relative to this file (inside an Obsidian vault, say tree/decisions).
decisions = decisions
#
# links: how the tool writes citations and link fields. token writes dte:ID; wikilink writes [[ID]]
# so decisions/ opens as an Obsidian vault. Both forms are always read.
links = token
#
# must_test: validate warns on a leaf stating a MUST that no test cites and no *Unenforced:* line labels.
must_test = on
#
# Layers below the tree (B37): globs that say what kind of artifact cites a leaf.
# The tree holds why; specs hold what; code holds how; tests enforce; agent
# instructions carry process rules. show prints each as a derived list and a
# leaf never stores any of it. docs describe and do not count as reach. A spec
# may say `covers: <globs>` in a comment near its top: the files it matches are
# built to it and count as cited through it (B44).
docs = *.md, docs/*
specs = specs/*, spec/*, *.spec.md
tests = tests/*, test/*, test_*, *_test.*, *.test.*
agents = CLAUDE.md, AGENTS.md, .claude/*
#
# scope checks (advisory).
broad_fraction = 0.3
broad_min = 5
"""

COVERAGE_FILE = ".dtecoverage"
COVERAGE_TEMPLATE = """# Coverage exclusions (dte coverage). An artifact that cites no decision BECAUSE no decision
# governs it goes here, under the reason it needs none, so 100% coverage is reachable and
# means something. A "why:" line opens a group; the globs under it (the .dteignore syntax)
# belong to that group. Excluded files are still scanned: a citation inside one still
# counts, and a glob that matches nothing is reported as stale. Everything not listed
# here is expected to cite.
why: DTE's own scaffolding; no project decision governs it
dte.cfg
.dteignore
#
# why: package manifests and toolchain configuration serve the build, not a product decision
# package.json
# tsconfig*.json
"""

IGNORE_TEMPLATE = """# Globs the dte scanner skips (in addition to .git and the decisions dir).
node_modules
vendor
dist
build
target
__pycache__
*.min.js
*.lock
*.png
*.jpg
*.gif
*.pdf
"""


def new_uuid(ms=None, seed=None):
    """A UUIDv7: 48 bits of Unix milliseconds, then random bits (from seed's hash when given).  local patch"""
    ms = int(time.time() * 1000) if ms is None else int(ms)
    rand = hashlib.sha256(seed.encode("utf-8")).digest()[:10] if seed is not None else os.urandom(10)
    b = ms.to_bytes(6, "big") + bytes([0x70 | (rand[0] & 0x0F), rand[1], 0x80 | (rand[2] & 0x3F)]) + rand[3:10]
    h = b.hex()
    return "%s-%s-%s-%s-%s" % (h[0:8], h[8:12], h[12:16], h[16:20], h[20:32])


def with_uuid(text, value):
    """Insert a uuid line right after the frontmatter's id line.  local patch"""
    lines = text.split("\n")
    for k, line in enumerate(lines[1:], 1):
        if line == "---":
            break
        if line.startswith("id:"):
            lines.insert(k + 1, "uuid: %s" % value)
            return "\n".join(lines)
    return set_field(text, "uuid", value)


def backfill_uuid(node):
    """A stable uuid for a leaf that predates them: time from its date, random bits from its id and title."""
    try:
        day = datetime.datetime.strptime(str(node.raw.get("date") or ""), "%Y-%m-%d")
        ms = int(day.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000) + node.number
    except ValueError:
        ms = None
    return new_uuid(ms, "%s|%s" % (node.id, node.title))


def cmd_upgrade(tree, args):
    """Bring a 0.1 tree to the 0.2 format, frontmatter only (bodies are untouched, so no History line is
    owed): the name becomes the one alias, uuids are backfilled stably, and the fields another record
    already holds go (status: active, made_by: ai, an empty conflicts_with, confidence, and under
    retire = delete supersedes and superseded_by). Idempotent.  dte:B43, dte:B58"""
    changed = 0
    for node in tree.ordered_leaves():
        text = read_text(node.path)
        nl = "\r\n" if "\r\n" in text else "\n"
        t = text.replace("\r\n", "\n")
        before = t
        name = _first_alias(node.raw) or str(node.raw.get("name") or "")
        if name and not _first_alias(node.raw):
            t = set_field(t, "aliases", "[%s]" % name)
        t = drop_field(t, "name")
        t = drop_field(t, "confidence")
        if node.raw.get("status") in ("active", None, "") and "status" in node.raw:
            t = drop_field(t, "status")
        if str(node.raw.get("made_by") or "") == "ai":
            t = drop_field(t, "made_by")
        if not node.conflicts_with and "conflicts_with" in node.raw:
            t = drop_field(t, "conflicts_with")
        if CONFIG["retire"] == "delete":
            t = drop_field(t, "supersedes")
            t = drop_field(t, "superseded_by")
        if not node.uuid:
            t = with_uuid(t, backfill_uuid(node))
        if t != before:
            write_text(node.path, t.replace("\n", nl))
            changed += 1
    print("upgrade: %d of %d leaves rewritten to the %s format (frontmatter only)" % (changed, len(tree.leaves), VERSION))
    if changed:
        print("  next: dte validate. Commit this on its own so the diff reads as a format change.")
    return 0


def _swap_leaf(tree, node, new_id, history):
    """Write leaf under new_id (same uuid: the same leaf) and remove the old file."""
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = set_field(text.replace("\r\n", "\n"), "id", new_id)
    text = append_history(text, history)
    dest_dir = os.path.join(tree.decisions_dir, new_id[0])
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, new_id + ".md")
    write_text(dest, text.replace("\n", nl))
    os.remove(node.path)
    return dest


def renumber_leaf(tree, old_id, new_id, by, why):
    """Same leaf, new number: citations, bodies and children follow. No ledger line, since the old number
    goes on naming whichever leaf holds it elsewhere; validate knows the leaf by its uuid.  dte:B58"""
    node = tree.leaves[old_id]
    rewrite_references(tree, old_id, new_id)
    node = Tree(tree.root, tree.decisions_dir).leaves[old_id]   # the rewrite may have touched its own file
    _swap_leaf(tree, node, new_id, "- %s renumbered from %s to %s by %s%s." % (
        datetime.date.today().isoformat(), old_id, new_id, by, (" (" + why + ")") if why else ""))


def cmd_renumber(tree, args):
    """dte:B58"""
    tree.validate()
    node = tree.leaves.get(args.id)
    if node is None:
        print("unknown id: %s (%s)" % (args.id, tree.retired_hint(args.id)))
        return 2
    new_id = args.to or next_id(tree, node.ring)
    if not ID_RE.match(new_id) or new_id[0] != node.ring:
        print("%s is not an id in ring %s; a renumber keeps the ring (a ring change is dte move)" % (new_id, node.ring))
        return 2
    if new_id in tree.leaves or new_id in tree.retired or new_id in branch_ids(tree):
        print("%s is taken here, in the ledger, or on another branch" % new_id)
        return 2
    renumber_leaf(tree, args.id, new_id, args.by, args.note)
    print('renumbered %s -> %s "%s"; citations, bodies and children rewritten' % (args.id, new_id, node.summary))
    return 0


def leaves_at(tree, ref):
    """{id: uuid} for every leaf file at a git ref, and the ids its ledger retired."""
    dec = tree.rel(tree.decisions_dir)
    ls = subprocess.run(["git", "-C", tree.root, "ls-tree", "-r", "--name-only", ref, "--", dec],
                        capture_output=True, text=True)
    if ls.returncode != 0:
        return None, None
    out = {}
    for path in ls.stdout.splitlines():
        base = os.path.splitext(os.path.basename(path))[0]
        if not (path.endswith(".md") and ID_RE.match(base)):
            continue
        body = subprocess.run(["git", "-C", tree.root, "show", "%s:%s" % (ref, path)],
                              capture_output=True, text=True).stdout
        m = re.search(r"^uuid:\s*(\S+)", body, re.M)
        out[base] = m.group(1) if m else ""
    led = subprocess.run(["git", "-C", tree.root, "show", "%s:%s/%s" % (ref, dec, LEDGER)],
                         capture_output=True, text=True).stdout
    retired = {l.split("\t", 1)[0] for l in led.splitlines() if ID_RE.match(l.split("\t", 1)[0])}
    return out, retired


def cmd_merge_ids(tree, args):
    """Before this branch merges into (or rebases onto) ref: every leaf here whose id ref gives to a
    different leaf (another uuid, none, or a retirement) takes a fresh id, its references with it.  dte:B58"""
    tree.validate()
    theirs, their_retired = leaves_at(tree, args.ref)
    if theirs is None:
        print("cannot read %s; is it a branch or commit git knows?" % args.ref)
        return 2
    clash = []
    for node in tree.ordered_leaves():
        u = theirs.get(node.id)
        if node.id in theirs and u and u == node.uuid:
            continue
        if node.id in theirs or (node.id in their_retired and node.id not in tree.retired):
            clash.append((node.id, "%s gives %s to %s" % (args.ref, node.id,
                          "a retired leaf" if node.id not in theirs else "another leaf")))
    if not clash:
        print("no id collisions with %s" % args.ref)
        return 0
    taken = set(tree.leaves) | set(tree.retired) | set(theirs) | their_retired | branch_ids(tree)
    for old_id, why in clash:
        ring = old_id[0]
        n = max([int(i[1:]) for i in taken if i[0] == ring] + [0]) + 1
        new_id = "%s%d" % (ring, n)
        taken.add(new_id)
        if args.dry_run:
            print("would renumber %s -> %s (%s)" % (old_id, new_id, why))
            continue
        fresh = Tree(tree.root, tree.decisions_dir)
        fresh.validate()
        renumber_leaf(fresh, old_id, new_id, args.by, why)
        print("renumbered %s -> %s (%s)" % (old_id, new_id, why))
    return 0


def _guard_human(node, authorized_by, what):
    if CONFIG["protect_human"] and node.human_held and not authorized_by:
        print("%s is human-held; %s needs --authorized-by <human>  (B11)" % (node.id, what))
        return True
    return False


def _bullets(text):
    """A section's text as bullet lines: a paragraph becomes one bullet, bullets stay."""
    out = []
    for para in re.split(r"\n\s*\n", text.strip()):
        lines = [l for l in para.split("\n") if l.strip()]
        if lines and all(re.match(r"^\s*([-*]|\d+\.)\s", l) for l in lines if not l.startswith("  ")):
            out += lines
        elif lines:
            out.append("- " + " ".join(l.strip() for l in lines))
    return out


def cmd_fold(tree, args):
    """A child that only restates or details part of its parent goes back into it: its Decision and
    Consequences become the parent's Consequences, its citations and children move to the parent, and
    the ledger records the fold.  dte:B48"""
    tree.validate()
    node = tree.leaves.get(args.id)
    if node is None or not node.in_effect:
        print("unknown or retired id: %s" % args.id)
        return 2
    into = args.into or (node.parents[0] if len(node.parents) == 1 else None)
    if into is None:
        print("%s has %d parents; name the one it folds into with --into" % (args.id, len(node.parents)))
        return 2
    if into not in node.parents or into not in tree.leaves:
        print("%s is not a parent of %s; a leaf folds only into its own parent" % (into, args.id))
        return 2
    parent = tree.leaves[into]
    if _guard_human(node, args.authorized_by, "folding it") or _guard_human(parent, args.authorized_by, "folding into it"):
        return 2
    today = datetime.date.today().isoformat()
    block = _bullets(_section(node.body, "## Decision")) + _bullets(_section(node.body, "## Consequences"))
    text = read_text(parent.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = _insert_section(text.replace("\r\n", "\n"), "## Consequences", "\n".join(block))
    text = append_history(text, "- %s %s %s folded in by %s (an aspect of this leaf, B48)." % (today, node.id, node.name, args.by))
    if args.authorized_by:
        text = set_field(text, "authorized_by", args.authorized_by)
    write_text(parent.path, text.replace("\n", nl))
    fresh = Tree(tree.root, tree.decisions_dir)
    fresh.validate()
    files, children = rewrite_references(fresh, node.id, into)
    fresh = Tree(tree.root, tree.decisions_dir)
    fate = retire_node(fresh, fresh.leaves[node.id], "folded", into, args.by, args.authorized_by, "folded into %s" % into)
    print('folded %s "%s" into %s' % (node.id, node.summary, parent.label()))
    print("  " + fate)
    print("  %d citing file(s) and %d child(ren) now point at %s; REVIEW the merged Consequences" % (len(files), len(children), into))
    return 0


def cmd_to_spec(tree, args):
    """A leaf that was mechanics (still true had the opposite been chosen) becomes spec text: its Decision
    and Consequences go under its title in the spec, the spec cites the leaf's parents, its citations and
    children move to those parents, and the ledger records where the text went.  dte:B47"""
    tree.validate()
    node = tree.leaves.get(args.id)
    if node is None or not node.in_effect:
        print("unknown or retired id: %s" % args.id)
        return 2
    if node.ring == "A":
        print("%s is a core goal; a goal is never mechanics" % args.id)
        return 2
    if _guard_human(node, args.authorized_by, "moving it to a spec"):
        return 2
    spec = at_root(tree, args.spec)
    rel = tree.rel(spec)
    if tree.layer_of(rel) != "specs":
        print("%s is outside the specs globs in dte.cfg; a spec lives where they say" % rel)
        return 2
    parents = [p for p in node.parents if p in tree.leaves]
    if not os.path.exists(spec):
        os.makedirs(os.path.dirname(spec), exist_ok=True)
        title = os.path.splitext(os.path.basename(spec))[0].replace("-", " ").replace("_", " ").capitalize()
        write_text(spec, "%s\n# %s\n" % (comment_line(".md", cite_text(parents)), title))
    text = read_text(spec).replace("\r\n", "\n")
    have = {i for line in text.split("\n")[:15] for i in cited_ids(line)}
    lines = ["", "## %s" % node.title, ""]
    lines += [_section(node.body, "## Decision").strip()]
    cons = _section(node.body, "## Consequences").strip()
    if cons:
        lines += [""] + [l for l in cons.split("\n")]
    write_text(spec, text.rstrip("\n") + "\n" + "\n".join(lines) + "\n")
    missing = [p for p in parents if p not in have]
    if missing:
        with redirect_quiet():
            cmd_cite(Tree(tree.root, tree.decisions_dir), argparse.Namespace(file=spec, ids=",".join(missing)))
    fresh = Tree(tree.root, tree.decisions_dir)
    fresh.validate()
    files = sorted({r for r, _, cid, _ in fresh.citations if cid == node.id and r != rel})
    if parents:
        rewrite_references(fresh, node.id, parents[0])
    kids = list(fresh.children.get(node.id, []))
    for c in kids:   # a child of a mechanics leaf hangs from what the leaf served (rewrite put parents[0] there)
        cn = Tree(tree.root, tree.decisions_dir).leaves[c]
        ps = []
        for p in cn.parents + parents:
            if p != node.id and p not in ps:
                ps.append(p)
        ct = read_text(cn.path)
        write_text(cn.path, set_field(ct, "parents", fm_ids(ps)))
    fresh = Tree(tree.root, tree.decisions_dir)
    fate = retire_node(fresh, fresh.leaves[node.id], "to-spec", rel, args.by, args.authorized_by, "moved to %s" % rel)
    print('%s "%s" is now spec text in %s' % (node.id, node.summary, rel))
    print("  " + fate)
    if files:
        print("  %d file(s) cited it and now cite %s%s; REVIEW whether each is built to %s instead:"
              % (len(files), parents[0] if parents else "nothing", (" (also served: %s)" % ", ".join(parents[1:])) if parents[1:] else "", rel))
        for f in files:
            print("    " + f)
    if kids:
        print("  re-parented %d child(ren) to %s" % (len(kids), ", ".join(parents)))
    return 0


class redirect_quiet:
    """Swallow a helper command's own report."""
    def __enter__(self):
        self._old, sys.stdout = sys.stdout, open(os.devnull, "w")

    def __exit__(self, *exc):
        sys.stdout.close()
        sys.stdout = self._old


def _sweep(text, pairs):
    """Whole-word replacements, a capitalized word getting a capitalized replacement."""
    for old, new in pairs:
        text = re.sub(r"\b%s\b" % re.escape(old), new, text)
        if old[:1].islower():
            text = re.sub(r"\b%s\b" % re.escape(old[:1].upper() + old[1:]), new[:1].upper() + new[1:], text)
    return text


def apply_sweep(tree, pairs, authorized_by, skip=()):
    """Rewrite titles and bodies (History and Contest kept as they were) of every in-effect leaf. Returns the leaves
    changed, or None when a human-held one would change without a human's name."""
    changed = []
    for node in tree.ordered_leaves():
        if not node.in_effect or node.id in skip:   # a leaf that quotes the old word on purpose
            continue
        text = read_text(node.path)
        nl = "\r\n" if "\r\n" in text else "\n"
        text = text.replace("\r\n", "\n")
        fm_end = text.index("\n---", 3) + 4
        head, body = text[:fm_end], text[fm_end:]
        out, keep = [], False
        for line in body.split("\n"):
            if line.startswith("## "):
                keep = line.strip() in ("## History", "## Contest")
                out.append(line)
                continue
            out.append(line if keep else _sweep(line, pairs))
        new_body = "\n".join(out)
        new_title = _sweep(node.title, pairs)
        if new_title != node.title:
            head = set_field(head, "title", fm_str(new_title))
        if new_body == body and new_title == node.title:
            continue
        if CONFIG["protect_human"] and node.human_held and not (authorized_by or node.authorized_by):
            print("%s is human-held; a sweep that changes it needs --authorized-by <human>  (B11)" % node.id)
            return None
        if authorized_by:
            head = set_field(head, "authorized_by", authorized_by)
        write_text(node.path, (head + new_body).replace("\n", nl))
        changed.append(node.id)
    return changed


def cmd_editorial(tree, args):
    """One log line for a wording-only sweep, instead of the same History line on every leaf it touched:
    each leaf is recorded with a hash of its new body, so a later edit is noticed again. With --replace the
    sweep itself is done here, titles included, so no frontmatter is hand-edited.  dte:B61, dte:B29"""
    tree.validate()
    if args.replace:
        pairs = []
        for r in args.replace:
            old, sep, new = r.partition("=")
            if not sep or not old:
                print("--replace takes OLD=NEW, got %r" % r)
                return 2
            pairs.append((old, new))
        done = apply_sweep(tree, pairs, args.authorized_by, set(split_ids(",".join(args.skip))))
        if done is None:
            return 2
        print("swept %d leaves: %s" % (len(done), ", ".join(done) or "none"))
        tree = Tree(tree.root, tree.decisions_dir)
        tree.validate()
    hits = [n for n, logged in tree.body_changes() if not logged]
    if not hits:
        print("no unlogged body changes in this working tree; nothing to record")
        return 0
    p = tree.editorial_path()
    new = not os.path.exists(p)
    with open(p, "a", encoding="utf-8", newline="") as fh:
        if new:
            fh.write("# Wording-only sweeps. One line each; a leaf's History stays about the decision.  dte:B61\n")
            fh.write("# date\tby\tnote\tleaves (id@body-hash)\n")
        fh.write("\t".join([datetime.date.today().isoformat(), args.by, args.note.replace("\t", " "),
                             " ".join("%s@%s" % (n.id, body_hash(n.body)) for n in hits)]) + "\n")
    print("logged one editorial sweep over %d leaves: %s" % (len(hits), ", ".join(n.id for n in hits)))
    return 0


def lean_fields(new_id, title, parents, name, status="active", made_by="ai", by="", date=None,
                ratified_by="", authorized_by="", contested_by="", branch="", extra=()):
    """A leaf's frontmatter in the 0.2 shape: only what no other record holds. status only when not
    active, made_by only when not ai, no supersedes (the ledger has it), no by (git has it, B59) unless an
    import carries one, the name as the one alias.  dte:B43"""
    fields = [("id", new_id), ("uuid", new_uuid()), ("title", fm_str(title))]
    if status and status != "active":
        fields.append(("status", status))
    fields.append(("parents", list(parents)))
    if branch:
        fields.append(("branch", branch))
    if made_by and made_by != "ai":
        fields.append(("made_by", made_by))
    if by:
        fields.append(("by", by))
    fields += [("date", date or datetime.date.today().isoformat()), ("ratified_by", ratified_by or "")]
    for k, v in (("authorized_by", authorized_by), ("contested_by", contested_by)) + tuple(extra):
        if v:
            fields.append((k, v))
    if name:
        fields.append(("aliases", "[%s]" % name))   # so [[name]] resolves in Obsidian
    return fields


def drop_field(text, key):
    """Remove one frontmatter key (and a block list's items under it)."""
    lines = text.split("\n")
    end = lines.index("---", 1)
    for k in range(1, end):
        if lines[k].split(":", 1)[0].strip() == key:
            j = k + 1
            while j < end and re.match(r"^\s+-\s", lines[j]):
                j += 1
            del lines[k:j]
            return "\n".join(lines)
    return text


def unfetched_branches(tree):
    """Branch heads the remote has that this clone has no ref for: ids minted there are invisible to next.  dte:C15"""
    try:
        out = subprocess.run(["git", "-C", tree.root, "ls-remote", "--heads", "origin"],
                             capture_output=True, text=True, timeout=8)
        if out.returncode != 0:
            return []
        local = subprocess.run(["git", "-C", tree.root, "for-each-ref", "--format=%(refname)", "refs/remotes/origin", "refs/heads"],
                               capture_output=True, text=True).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return []
    have = {r.split("/", 3)[-1] if r.startswith("refs/remotes/") else r[len("refs/heads/"):] for r in local}
    return sorted(line.split("refs/heads/", 1)[1] for line in out.stdout.splitlines()
                  if "refs/heads/" in line and line.split("refs/heads/", 1)[1] not in have)


def warn_unfetched(tree):
    if os.environ.get("DTE_NO_REMOTE"):
        return
    missing = unfetched_branches(tree)
    if missing:
        print("warning: origin has %d branch(es) this clone has not fetched (%s); an id minted there is invisible"
              " to next. git fetch origin, or dte merge-ids later." % (len(missing), ", ".join(missing[:5])))


def build_frontmatter(fields):
    lines = ["---"]
    for k, v in fields:
        if isinstance(v, list):
            lines.append("%s: %s" % (k, fm_ids(v)))
        elif v is None or v == "":
            lines.append("%s:" % k)
        else:
            lines.append("%s: %s" % (k, v))
    lines.append("---")
    return "\n".join(lines) + "\n"


def check_parents(tree, ring, parents):
    if ring == "A" and parents:
        return "ring A leaves cannot have parents"
    if ring != "A" and not parents:
        return "a ring %s leaf needs parents; pass --parents A1,B2" % ring
    for p in parents:
        if p not in tree.leaves:
            return "parent %s %s" % (p, tree.retired_hint(p))
        if ring_depth(tree.leaves[p].ring) >= ring_depth(ring):
            return "parent %s is not shallower than ring %s" % (p, ring)
    return None


def split_ids(s):
    return [p.strip() for p in (s or "").split(",") if p.strip()]


def node_body(args):
    """The body from --body-file (verbatim, frontmatter stripped) or from the section flags.  dte:B33"""
    if getattr(args, "body_file", None):
        if not os.path.exists(args.body_file):
            print("no such file: %s" % args.body_file)
            return None
        text = read_text(args.body_file).replace("\r\n", "\n")
        if text.startswith("---"):
            try:
                _, text = parse_frontmatter(text)
            except ValueError:
                pass
        if "## Decision" not in text or "## Why" not in text:
            print("%s needs '## Decision' and '## Why' sections" % args.body_file)
            return None
        return "\n" + text.strip("\n") + "\n"
    body = "\n## Decision\n\n%s\n\n## Why\n\n%s\n" % (args.decision or "TODO", args.why or "TODO")
    if args.consequences:
        body += "\n## Consequences\n\n%s\n" % args.consequences
    return body


def cmd_new(tree, args):
    """dte:B29"""
    ring = args.ring.upper()
    if not re.match(r"^[A-Z]$", ring):
        print("ring must be a single letter A-Z")
        return 2
    if args.made_by not in MADE_BY:
        print("--made-by must be one of %s" % sorted(MADE_BY))
        return 2
    if args.status not in ("active", "proposed"):
        print("--status must be active or proposed")
        return 2
    parents = split_ids(args.parents)
    err = check_parents(tree, ring, parents)
    if err:
        print(err)
        return 2
    if not args.name:
        print("a leaf needs --name <camelCase>, the handle said beside its id (A5, B32)")
        return 2
    if not NAME_RE.match(args.name):
        print("a name is a camelCase identifier like shareImpl")
        return 2
    if any(n.name == args.name and n.in_effect for n in tree.leaves.values()):
        print("name %s is already taken" % args.name)
        return 2
    warn_unfetched(tree)
    new_id = next_id(tree, ring)
    fields = lean_fields(new_id, args.title, parents, args.name, status=args.status, made_by=args.made_by,
                         authorized_by=args.authorized_by, branch=args.branch)
    body = node_body(args)
    if body is None:
        return 2
    dest_dir = os.path.join(tree.decisions_dir, ring)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, new_id + ".md")
    write_text(dest, build_frontmatter(fields) + body)
    print('created %s "%s" at %s' % (new_id, args.title, tree.rel(dest)))
    todo = [] if (args.decision and args.why) else ["fill in the TODO sections"]
    print("  " + "; ".join(todo + ["cite it as %s from what it governs" % cite_text([new_id])]))
    return 0


IMPORT_FIELDS = KNOWN_FIELDS - {"id", "uuid", "superseded_by", "supersedes", "conflicts_with"} | {"ring", "name"}


def cmd_import(tree, args):
    """Re-home an existing corpus: one markdown file per leaf, every property carried
    through, parents by name or id, ids allocated parent-first.  dte:B33"""
    tree.validate()
    src = os.path.abspath(args.dir)
    if not os.path.isdir(src):
        print("no such directory: %s" % args.dir)
        return 2
    items = []
    for fn in sorted(os.listdir(src)):
        if not fn.endswith(".md"):
            continue
        path = os.path.join(src, fn)
        try:
            data, body = parse_frontmatter(read_text(path).replace("\r\n", "\n"))
        except ValueError as e:
            print("%s: %s" % (fn, e))
            return 2
        data = _normalise(data)
        key = os.path.splitext(fn)[0]
        items.append((key, data, body, path))
    errors = []
    names = {n.name: n.id for n in tree.leaves.values() if n.name and n.in_effect}
    keys = {}
    for key, data, body, path in items:
        ring = str(data.get("ring") or "").upper()
        if not re.match(r"^[A-Z]$", ring):
            errors.append("%s: needs ring: <letter>" % key)
        for f in data:
            if f not in IMPORT_FIELDS:
                errors.append("%s: unknown property %r; import carries only leaf properties (B33)" % (key, f))
        if not data.get("title"):
            errors.append("%s: title is required" % key)
        if "## Decision" not in body or "## Why" not in body:
            errors.append("%s: body needs '## Decision' and '## Why'" % key)
        name = str(data.get("name") or _first_alias(data) or "")
        if name and not NAME_RE.match(name):
            errors.append("%s: name %r is not a camelCase identifier" % (key, name))
        if name and (name in names or name in keys):
            errors.append("%s: name %r is already taken" % (key, name))
        for handle in (key, name):
            if handle:
                keys[handle] = key
    if errors:
        print("\n".join(errors))
        return 2
    # parents: an existing id, an existing name, or another file in the batch (by file name or name)
    by_key = {k: (d, b, p) for k, d, b, p in items}
    def parent_ref(ref):
        if ref in tree.leaves:
            return ("id", ref)
        if ref in names:
            return ("id", names[ref])
        if ref in keys:
            return ("batch", keys[ref])
        return None
    order, seen, visiting = [], set(), set()
    def visit(key):
        if key in seen:
            return True
        if key in visiting:
            errors.append("%s: parents form a cycle" % key); return False
        visiting.add(key)
        data = by_key[key][0]
        ps = data.get("parents") or []
        for ref in (ps if isinstance(ps, list) else [ps]):
            ref = _scalar(str(ref))
            got = parent_ref(ref)
            if got is None:
                errors.append("%s: parent %r is not an existing leaf or a file in the batch" % (key, ref)); return False
            if got[0] == "batch" and not visit(got[1]):
                return False
        visiting.discard(key); seen.add(key); order.append(key)
        return True
    for key, _, _, _ in items:
        visit(key)
    if errors:
        print("\n".join(errors))
        return 2
    today = datetime.date.today().isoformat()
    source = args.source or os.path.relpath(src, tree.root).replace(os.sep, "/")
    counters = {}
    assigned = {}
    written = []
    for key in order:
        data, body, path = by_key[key]
        ring = str(data["ring"]).upper()
        ps = data.get("parents") or []
        parents = []
        for ref in (ps if isinstance(ps, list) else [ps]):
            kind, val = parent_ref(_scalar(str(ref)))
            parents.append(val if kind == "id" else assigned[val])
        err = check_parents(tree, ring, [p for p in parents if p in tree.leaves]) if all(p in tree.leaves for p in parents) else None
        for pid in parents:
            pring = tree.leaves[pid].ring if pid in tree.leaves else pid[0]
            if ring_depth(pring) >= ring_depth(ring):
                err = "parent %s is not shallower than ring %s" % (pid, ring)
        if ring != "A" and not parents:
            err = "a ring %s leaf needs parents" % ring
        if ring == "A" and parents:
            err = "ring A leaves cannot have parents"
        if err:
            print("%s: %s" % (key, err))
            for w in written:
                os.remove(w)
            return 2
        if ring not in counters:
            counters[ring] = next_id(tree, ring)
        new_id = counters[ring]
        counters[ring] = ring + str(int(new_id[1:]) + 1)
        assigned[key] = new_id
        extra = []
        for f in ("tags", "cssclasses"):
            if data.get(f):
                v = data[f]
                extra.append((f, "[%s]" % ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)))
        name = str(data.get("name") or _first_alias(data) or "")
        fields = lean_fields(new_id, str(data["title"]), parents, name, status=str(data.get("status") or "active"),
                             made_by=str(data.get("made_by") or "ai"), by=str(data.get("by") or ""),
                             date=str(data.get("date") or today), ratified_by=str(data.get("ratified_by") or ""),
                             authorized_by=str(data.get("authorized_by") or ""),
                             contested_by=str(data.get("contested_by") or ""), branch=str(data.get("branch") or ""),
                             extra=extra)
        text = build_frontmatter(fields) + "\n" + body.strip("\n") + "\n"
        text = append_history(text, "- %s imported from %s (%s) by %s." % (today, source, key, args.by))
        if data.get("ratified_by"):
            text = append_history(text, "- %s ratified by %s, carried by the import." % (today, data["ratified_by"]))
        dest_dir = os.path.join(tree.decisions_dir, ring)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, new_id + ".md")
        write_text(dest, text)
        written.append(dest)
        tree.leaves[new_id] = Leaf(dest, parse_frontmatter(text)[0], body)
        print("  %s  <-  %s  %s" % (new_id, key, str(data["title"])[:70]))
    print("imported %d leaves from %s. They are re-homed content: no contest is owed at import (B60, B33)."
          % (len(written), source))
    print("  next: dte validate; cite each from what it governs; remove %s when done." % args.dir)
    return 0


def cmd_show(tree, args):
    """dte:B29"""
    tree.validate()
    i = args.id
    node = tree.leaves.get(i)
    if node is None:
        if i in tree.retired:
            row = tree.retired[i]
            print('%s "%s"  RETIRED' % (i, row["title"]))
            print("  %s" % tree.retired_hint(i))
            print("  by %s%s" % (row["by"], ("; authorized by " + row["authorized_by"]) if row["authorized_by"] else ""))
            return 0
        print("unknown id: %s" % i)
        return 2
    print(node.label())
    print("  file: %s" % tree.rel(node.path))
    print("  status: %s   made_by: %s%s   date: %s"
          % (node.status, node.made_by, ("   by: " + node.by) if node.by else "", node.raw.get("date") or "?"))
    extra = []
    if node.ratified_by:
        extra.append("ratified_by: %s" % node.ratified_by)
    if node.authorized_by:
        extra.append("authorized_by: %s" % node.authorized_by)
    if tree.branch_of(i):
        extra.append("branch: %s (only there, B54)" % tree.branch_of(i))
    if extra:
        print("  " + "   ".join(extra))
    if node.parents:
        print("  parents:")
        for p in node.parents:
            print("    " + (tree.leaves[p].label() if p in tree.leaves else "%s (%s)" % (p, tree.retired_hint(p))))
        print("  lineage to the core:")
        for chain in tree.ancestors(i):
            print("    " + "  <-  ".join(chain))
    else:
        print("  parents: none (core)")
    kids = tree.ordered(tree.children.get(i, []))
    print("  children (%d):" % len(kids))
    for c in kids:
        print("    " + tree.leaves[c].label())
    by_layer = tree.cited_by(i)
    n_hits = sum(len(v) for v in by_layer.values())
    print("  citing artifacts (%d), derived from citations, never stored here:" % n_hits)
    for layer in ("specs", "code", "tests", "agents", "docs"):
        hits = by_layer.get(layer)
        if not hits:
            continue
        print("    %s:" % tree.LAYER_LABEL[layer])
        for rel in sorted(hits):
            lines = [str(x) for x in hits[rel]]
            nums = [x for x in lines if x.isdigit()]
            print("      %s  %s" % (rel, ("lines " + ", ".join(sorted(nums, key=int))) if nums else lines[0]))
    if node.supersedes:
        print("  supersedes: " + ", ".join(node.supersedes))
    if node.superseded_by:
        print("  superseded_by: %s" % node.superseded_by)
    if node.conflicts_with:
        print("  conflicts_with: " + ", ".join(node.conflicts_with))
    print()
    for line in node.body.strip("\n").splitlines():
        print("  " + line)
    return 0


def cmd_find(tree, args):
    """dte:B29"""
    q = args.text.lower()
    n = 0
    for node in tree.ordered_leaves():
        hay = (node.id + " " + node.summary + " " + node.body).lower()
        if q in hay:
            n += 1
            print(node.label())
            if q not in (node.id + " " + node.summary).lower():
                for line in node.body.splitlines():
                    if q in line.lower():
                        print("    " + line.strip()[:110])
                        break
    for i, row in sorted(tree.retired.items(), key=lambda kv: id_key(kv[0])):
        if q in (i + " " + row["title"]).lower():
            n += 1
            print('%s "%s"  [retired: %s]' % (i, row["title"], row["action"]))
    for it in tree.inbox:
        if q in (it.slug + " " + it.title + " " + it.body).lower():
            n += 1
            print('inbox/%s "%s"  [pending placement]' % (it.slug, it.title))
    if not n:
        print("no matches for %r" % args.text)
    return 0


def cmd_authorize(tree, args):
    """Record a human's go-ahead on an existing leaf: authorized_by plus a History line.  dte:C21,B11"""
    tree.validate()
    code = 0
    for i in args.ids:
        node = tree.leaves.get(i)
        if node is None:
            print("unknown id: %s (%s)" % (i, tree.retired_hint(i)))
            code = 2
            continue
        text = read_text(node.path)
        nl = "\r\n" if "\r\n" in text else "\n"
        text = text.replace("\r\n", "\n")
        text = set_field(text, "authorized_by", args.by)
        text = append_history(text, "- %s authorized by %s%s." % (
            datetime.date.today().isoformat(), args.by, (": " + args.note) if args.note else ""))
        write_text(node.path, text.replace("\n", nl))
        print('authorized %s "%s" by %s' % (i, node.summary, args.by))
    return code


def cmd_ratify(tree, args):
    """dte:B29, dte:B59"""
    rc = 0
    for i in args.ids:
        rc = max(rc, ratify_one(tree, i, args.by))
    return rc


def ratify_one(tree, i, by):
    node = tree.leaves.get(i)
    if node is None:
        print("unknown id: %s (%s)" % (i, tree.retired_hint(i)))
        return 2
    if not node.in_effect:
        print("%s is %s; only in-effect leaves are ratified" % (i, node.status))
        return 2
    if node.made_by == "human":
        print("%s is human-made; ratification is for ai and joint leaves" % i)
        return 2
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    text = set_field(text, "ratified_by", by)
    flipped = node.status == "proposed"
    if flipped:
        text = set_field(text, "status", "active")
    if flipped:
        text = drop_field(text, "status")
    # dte:B62 a ratified leaf is present governance: the contest and the activity log informed the ruling,
    # git keeps both, and History restarts at the ratification
    dropped = [h for h in ("## Contest", "## History") if h in text.split("\n")]
    for h in dropped:
        text = _drop_section(text, h)
    text = append_history(text, "- %s ratified by %s%s%s." % (
        datetime.date.today().isoformat(), by, " (proposed -> active)" if flipped else "",
        "; earlier %s in git" % " and ".join(h[3:].lower() for h in dropped) if dropped else ""))
    write_text(node.path, text.replace("\n", nl))
    print('ratified %s "%s" by %s%s' % (i, node.summary, by,
                                        "; status proposed -> active" if flipped else ""))
    print("  it is now human-held (B11); the owner may reword it in their own voice")
    if dropped:
        print("  dropped %s (B62); git keeps what was dropped" % ", ".join(dropped))
    return 0


# ---------------------------------------------------------------- cite, brief, hook  dte:B29,B27

COMMENT_STYLES = (
    ("#", {".py", ".rb", ".sh", ".bash", ".zsh", ".fish", ".yml", ".yaml", ".toml", ".cfg", ".ini",
           ".ps1", ".pl", ".r", ".txt", ".env", ".mk", ".cmake", ".dockerfile", ".gitignore",
           ".dteignore", ".dtecoverage", ""}),
    ("//", {".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".go", ".rs", ".java", ".c", ".h", ".cpp",
            ".hpp", ".cc", ".cs", ".swift", ".kt", ".kts", ".scala", ".dart", ".php", ".m", ".zig"}),
    ("<!--", {".md", ".markdown", ".html", ".htm", ".xml", ".svg", ".vue", ".svelte"}),
    ("/*", {".css", ".scss", ".less"}),
    ("--", {".sql", ".lua", ".hs", ".elm"}),
)
NO_COMMENTS = {".json", ".csv", ".tsv"}


def comment_line(ext, text):
    ext = ext.lower()
    if ext in NO_COMMENTS:
        return None
    for marker, exts in COMMENT_STYLES:
        if ext in exts:
            if marker == "<!--":
                return "<!-- %s -->" % text
            if marker == "/*":
                return "/* %s */" % text
            return "%s %s" % (marker, text)
    return "# " + text


def _citation_only(line):
    rest = LINK_RE.sub("", CITE_RE.sub("", line))
    rest = re.sub(r"[\s,]", "", rest)
    return all(c in "#/*<!->;%'\"-{}()" for c in rest)


def at_root(tree, p):
    """A path the user typed: as given when it exists from here or is absolute, else relative to --root."""
    if os.path.isabs(p) or os.path.exists(p):
        return os.path.abspath(p)
    return os.path.join(tree.root, p)


def cmd_cite(tree, args):
    """dte:B29"""
    ids = split_ids(args.ids)
    for i in ids:
        if i not in tree.leaves:
            print("cannot cite %s: %s" % (i, tree.retired_hint(i)))
            return 2
        if not tree.leaves[i].in_effect:
            print("cannot cite %s: it is %s" % (i, tree.leaves[i].status))
            return 2
    path = at_root(tree, args.file)
    if not os.path.isfile(path):
        print("no such file: %s" % args.file)
        return 2
    rel = tree.rel(path)
    ext = os.path.splitext(path)[1]
    text = read_text(path)
    nl = "\r\n" if "\r\n" in text else "\n"
    lines = text.replace("\r\n", "\n").split("\n")
    # where the file-level comment goes
    at = 0
    if lines and lines[0].startswith("#!"):
        at = 1
    if ext.lower() in (".md", ".markdown") and lines and lines[0].strip() == "---":
        for k in range(1, len(lines)):
            if lines[k].strip() == "---":
                at = k + 1
                break
    # the header already cites some of them anywhere (named or not, beside other ids): those are done
    header = set()
    for k in range(at, min(at + 15, len(lines))):
        header.update(cited_ids(lines[k]))
    ids = [x for x in ids if x not in header]
    if not ids:
        print("%s already cites %s" % (rel, args.ids))
        return 0
    # an existing top-of-file citation line: append to it, but only when the line holds
    # nothing but the comment marker and the citation; a line-level citation inside a
    # sentence is about one block and is left alone
    for k in range(at, min(at + 3, len(lines))):
        have = cited_ids(lines[k])
        if have and _citation_only(lines[k]):
            new = [x for x in ids if x not in have]
            if not new:
                print("%s already cites %s" % (rel, ", ".join(ids)))
                return 0
            m = CITE_RE.search(lines[k])
            if m:
                lines[k] = lines[k][:m.start(1)] + ",".join(have + new) + lines[k][m.end(1):]
            else:
                last = list(LINK_RE.finditer(lines[k]))[-1]
                lines[k] = lines[k][:last.end()] + ", " + ", ".join("[[%s]]" % x for x in new) + lines[k][last.end():]
            write_text(path, nl.join(lines))
            print("%s: added %s to the existing citation on line %d" % (rel, ",".join(new), k + 1))
            return 0
    comment = comment_line(ext, cite_text(ids))
    if comment is None:
        print("%s: %s files have no comments; cite from a sibling file or a README" % (rel, ext))
        return 2
    lines.insert(at, comment)
    write_text(path, nl.join(lines))
    print("%s: inserted %r on line %d" % (rel, comment, at + 1))
    return 0


def cmd_brief(tree, args):
    """dte:B27"""
    if args.builder:
        if not os.path.isfile(args.builder):
            print("no such spec: %s" % args.builder)
            return 2
        return builder_brief(tree, args.builder)
    if not args.ring:
        print("brief needs a ring, or --builder <spec>")
        return 2
    tree.validate()
    ring = args.ring.upper()
    if not re.match(r"^[A-Z]$", ring):
        print("ring must be a single letter A-Z")
        return 2
    above = [n for n in tree.ordered_leaves() if n.in_effect and ring_depth(n.ring) < ring_depth(ring)]
    scope_note = ""
    if args.under:
        if args.under not in tree.leaves:
            print("unknown id: %s (%s)" % (args.under, tree.retired_hint(args.under)))
            return 2
        keep = {args.under}
        for chain in tree.ancestors(args.under):
            keep.update(x for x in chain if x in tree.leaves)
        keep.update(tree.descendants(args.under))
        above = [n for n in above if n.id in keep]
        scope_note = " relevant to %s" % args.under
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    prev = chr(ord(ring) - 1) if ring != "A" else None
    print("DTE BRIEF: you operate at ring %s of this project's decision tree." % ring)
    print()
    print("Rules:")
    print("  1. Decide only at ring %s or deeper. Create decisions with" % ring)
    print("     `python %s new %s --name <camelCase> --title \"...\" --by <you> --parents <ids> --decision \"...\" --why \"...\"`." % (tool, ring))
    print("     A leaf is a call a person could make in plain words; a sentence that would still be true had the")
    print("     opposite been chosen is mechanics and goes in the spec (B47). A child decides a question its parent")
    print("     leaves open; one that only details its parent folds back into it (B48).")
    if prev:
        print("  2. Anything that belongs at ring %s or shallower, or whose ring is unclear, is not yours:" % prev)
        print("     write decisions/inbox/<slug>.md and ask %s." % holder_of(prev, CONFIG))
    else:
        print("  2. You hold the core. Nothing is above you.")
    print("  3. Cite what your work serves: `python %s cite <file> <ID>`. Refer to every decision as ID plus its name." % tool)
    print("  4. Never change a decision made or ratified by a human. If your environment refuses an edit to the tree,")
    print("     stop and ask for an authorization that names the leaves; never route around the refusal (B53).")
    print("     Before you finish, run `DTE_RING=%s python %s validate`; it must print OK." % (ring, tool))
    print("  5. Before acting under a leaf marked unratified and not contested, run `python %s contest <ID>`" % tool)
    print("     and follow it: build the alternatives, scope their cost, judge by the parents, record the verdict.")
    print("     A contested or ratified leaf is settled: act on it and never re-ask (A7, B60).")
    print("     A leaf marked imported was re-homed, not decided; its contest is owed before the first new work under it.")
    print()
    print("Decisions above your ring that bind you%s (%d):" % (scope_note, len(above)))
    cur = None
    for n in above:
        if n.ring != cur:
            cur = n.ring
            print("  ring %s:" % cur)
        held = " [human-held]" if n.human_held else ""
        print("    %s%s" % (n.label(), held))
    if args.under:
        print()
        print("Your subtree: `python %s tree --under %s`; read any leaf with `python %s show <ID>`."
              % (tool, args.under, tool))
    return 0


def spec_skeleton(tree, node):
    """dte:A8, dte:B37"""
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    out = [comment_line(".md", cite_text([node.id])), "", "# Spec: %s" % (node.name or node.id), "",
           "Serves %s %s (ring %s). Filled by an agent that holds a ring; built by an agent that never reads the tree (B42)."
           % (node.id, ("%s: %s" % (node.name, node.title)) if node.name else node.title, node.ring), "",
           "## Purpose", "", _section(node.body, "## Decision").strip() or "TODO", "",
           "## Constraints", ""]
    for p in node.parents:
        pn = tree.leaves.get(p)
        if pn:
            out.append("- %s %s: %s" % (pn.id, pn.name or pn.title, " ".join(_section(pn.body, "## Decision").split())))
    cons = _section(node.body, "## Consequences").strip()
    if cons:
        out += [l for l in cons.split("\n") if l.strip()]
    if not node.parents and not cons:
        out.append("- TODO")
    out += ["", "## Covered decisions", ""]
    desc = tree.descendants(node.id)
    for i in tree.ordered(desc):
        c = tree.leaves[i]
        if c.in_effect:
            out.append("- %s %s: %s" % (c.id, c.name or c.title, " ".join(_section(c.body, "## Decision").split())))
    if not desc:
        out.append("- none yet; requirements below are decided here and may become child leaves")
    out += ["", "## Requirements", "", "TODO one numbered requirement per behaviour, each naming the decision it serves.", "",
            "## Out of scope", "", "TODO", "",
            "## Gaps", "",
            "A builder that finds this spec silent stops that part and runs `python %s gap <this file> --title \"...\" --by <name>`; it never improvises." % tool, ""]
    return "\n".join(out)


def cmd_spec(tree, args):
    """dte:A8"""
    node = tree.leaves.get(args.id)
    if node is None:
        print("unknown id: %s (%s)" % (args.id, tree.retired_hint(args.id)))
        return 2
    text = spec_skeleton(tree, node)
    if args.out:
        if os.path.exists(args.out):
            print("refusing to overwrite %s" % args.out)
            return 2
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        write_text(args.out, text)
        rel = tree.rel(os.path.abspath(args.out))
        layer = tree.layer_of(rel)
        print("wrote %s, citing %s" % (rel, node.id))
        if layer != "specs":
            print("  note: %s is outside the specs glob in dte.cfg, so show will list it as %s" % (rel, LAYER_LABEL[layer]))
        return 0
    print(text)
    return 0


def cmd_gap(tree, args):
    """dte:B42"""
    spec = tree.rel(os.path.abspath(args.spec))
    if not os.path.isfile(os.path.join(tree.root, spec)):
        print("no such spec: %s" % spec)
        return 2
    slug = "gap-" + re.sub(r"[^a-z0-9]+", "-", args.title.lower()).strip("-")[:60]
    path = os.path.join(tree.inbox_dir, slug + ".md")
    if os.path.exists(path):
        print("a gap with that title is already filed: %s" % tree.rel(path))
        return 2
    os.makedirs(tree.inbox_dir, exist_ok=True)
    body = (args.note or "TODO what the spec does not say, and what the builder needs to know").strip()
    write_text(path, "---\nkind: gap\nspec: %s\ntitle: %s\nmade_by: ai\nby: %s\ndate: %s\n---\n\n## Gap\n\n%s\n"
               % (spec, fm_str(args.title), args.by, datetime.date.today().isoformat(), body))
    print("filed %s: the spec %s is silent on %r; whoever holds the spec answers there, then removes the file" % (tree.rel(path), spec, args.title))
    return 0


def builder_brief(tree, spec):
    """dte:B42, dte:B42"""
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    rel = tree.rel(os.path.abspath(spec))
    text = read_text(spec).replace("\r\n", "\n")
    ids = sorted({i for line in text.split("\n") for i in cited_ids(line)}, key=id_key)
    print("DTE BUILDER BRIEF: you build to the spec below and to nothing else (B42 builderAutonomy).")
    print()
    print("Rules:")
    print("  1. Build exactly what the spec says. You decide nothing: never run new, contest, place, retire or move,")
    print("     and never read decisions/. Unratified leaves are not your concern; you have no ring.")
    print("  2. Every file you create or substantially change carries the spec's citation at the top:")
    print("     `python %s cite <file> %s`." % (tool, ",".join(ids) if ids else "<IDs the spec names>"))
    print("  3. When the spec is silent, ambiguous or contradicts itself, stop that part and file the gap:")
    print("     `python %s gap %s --title \"...\" --by <you> --note \"...\"`. Never improvise." % (tool, rel))
    print("  4. Before you finish, `python %s validate` must print OK. Do not set DTE_RING." % tool)
    print()
    print("Spec: %s" % rel)
    print("-" * 72)
    print(text.rstrip("\n"))
    return 0


def cmd_hook(tree, args):
    """dte:B29"""
    hooks = os.path.join(tree.root, ".git", "hooks")
    if not os.path.isdir(hooks):
        print("no .git/hooks here; is %s a git repository?" % tree.root)
        return 2
    path = os.path.join(hooks, "pre-commit")
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as fh:
            if "dte" in fh.read():
                print("pre-commit hook already runs dte")
                return 0
        print("a pre-commit hook already exists and does not mention dte; add this line to it:")
        print("  python %s validate || exit 1" % tool)
        return 2
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("#!/bin/sh\n# Refuse commits that break the decision tree.  dte:B29\n"
                 "python %s validate || exit 1\n" % tool)
    try:
        os.chmod(path, 0o755)
    except OSError:
        pass
    print("installed .git/hooks/pre-commit: runs `python %s validate` before every commit" % tool)
    return 0


def cmd_reparent(tree, args):
    """The one way a leaf's parents change: an orphan's, or a same-ring move of any leaf.  dte:B29,B24,B11"""
    node = tree.leaves.get(args.id)
    if node is None:
        print("unknown id: %s (%s)" % (args.id, tree.retired_hint(args.id)))
        return 2
    if CONFIG["protect_human"] and node.human_held and not args.authorized_by:
        print("%s is human-held; re-parenting it needs --authorized-by <human>  (B11)" % args.id)
        return 2
    parents = split_ids(args.parents)
    if args.id in parents:
        print("a leaf cannot be its own parent")
        return 2
    err = check_parents(tree, node.ring, parents)
    if err:
        print(err)
        return 2
    for p in parents:
        if not tree.leaves[p].in_effect:
            print("parent %s is %s; pick an in-effect leaf" % (p, tree.leaves[p].status))
            return 2
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    old = ", ".join(node.parents) or "none"
    text = set_field(text, "parents", fm_ids(parents))
    if args.authorized_by:
        text = set_field(text, "authorized_by", args.authorized_by)
    text = append_history(text, "- %s re-parented from [%s] to [%s] by %s%s." % (
        datetime.date.today().isoformat(), old, ", ".join(parents), args.by,
        (", authorized by " + args.authorized_by) if args.authorized_by else ""))
    write_text(node.path, text.replace("\n", nl))
    print('re-parented %s "%s": [%s] -> [%s]' % (args.id, node.summary, old, ", ".join(parents)))
    return 0


SETTABLE = ("title", "name")   # dte:B29 the fields with no invariant
FIELD_OWNER = {                            # where a refused field is actually changed
    "status": "retire, ratify, or move", "parents": "reparent", "supersedes": "retire --superseded-by",
    "superseded_by": "retire --superseded-by", "conflicts_with": "conflict", "ratified_by": "ratify",
    "authorized_by": "--authorized-by on retire, move, or set", "contested_by": "contest --record",
    "id": "move", "made_by": "nothing: provenance is fixed at creation (A3)",
    "by": "nothing: provenance is fixed at creation (A3)", "date": "nothing: provenance is fixed at creation (A3)",
    "uuid": "nothing: a leaf's uuid never changes (B58)", "aliases": "set <ID> name", "branch": "nothing yet: set at new with --branch",
    "confidence": "nothing: 0.2 dropped it; say how sure in the Why (B43)",
}


def cmd_set(tree, args):
    """dte:B29, dte:B29, dte:B11 (a change to a human-held leaf needs a human's name)"""
    node = tree.leaves.get(args.id)
    if node is None:
        print("unknown id: %s (%s)" % (args.id, tree.retired_hint(args.id)))
        return 2
    field = args.field.strip().lower()
    if field not in SETTABLE:
        owner = FIELD_OWNER.get(field)
        if owner:
            print("%s is not set by hand; use %s  (B29)" % (field, owner))
        else:
            print("unknown field %s; set changes one of: %s  (B29)" % (field, ", ".join(SETTABLE)))
        return 2
    if not node.in_effect:
        print("%s is %s; set a field on an in-effect leaf" % (args.id, node.status))
        return 2
    new = " ".join(args.value.split())
    if not new:
        print("the new value is empty")
        return 2
    old = {"title": node.title, "name": node.name}[field]
    if new == old:
        print("%s already has %s = %s" % (args.id, field, new))
        return 0
    if field == "name" and not NAME_RE.match(new):
        print("a name is a camelCase identifier like shareImpl")
        return 2
    if field == "name" and any(n.name == new and n.in_effect for n in tree.leaves.values()):
        print("name %s is already taken" % new)
        return 2
    if CONFIG["protect_human"] and node.human_held and not args.authorized_by:
        print("%s is human-held; changing it needs --authorized-by <human>  (B11)" % args.id)
        return 2
    if field == "title" and len(new) > TITLE_MAX:
        print("warning: title is %d characters; B16 asks for under %d" % (len(new), TITLE_MAX))
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    if field == "name":
        text = set_field(text, "aliases", "[%s]" % new)
        text = drop_field(text, "name")
    else:
        text = set_field(text, field, fm_str(new) if field == "title" else new)
    if args.authorized_by:
        text = set_field(text, "authorized_by", args.authorized_by)
    text = append_history(text, '- %s %s changed from "%s" by %s%s.' % (
        datetime.date.today().isoformat(), field, old or "(unset)", args.by,
        (", authorized by " + args.authorized_by) if args.authorized_by else ""))
    write_text(node.path, text.replace("\n", nl))
    print('set %s %s: "%s" -> "%s"' % (args.id, field, old or "(unset)", new))
    return 0


def _empty_sections(body):
    """Headings with nothing under them before the next heading of the same or higher level."""
    lines = body.replace("\r\n", "\n").split("\n")
    out = []
    for k, line in enumerate(lines):
        if not line.startswith("## "):
            continue
        rest = []
        for nxt in lines[k + 1:]:
            if nxt.startswith("## "):
                break
            rest.append(nxt)
        if not "".join(rest).strip():
            out.append(line.strip())
    return out


def body_hash(body):
    """A short hash of a body, whitespace-insensitive, for the editorial log.  dte:B61"""
    norm = re.sub(r"\s+", " ", body.replace("\r\n", "\n")).strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()[:12]


def _section(body, heading):
    """The lines under heading up to the next ## heading, or an empty string."""
    lines = body.replace("\r\n", "\n").split("\n")
    if heading not in lines:
        return ""
    i = lines.index(heading) + 1
    j = next((k for k in range(i, len(lines)) if lines[k].startswith("## ")), len(lines))
    return "\n".join(lines[i:j]).strip("\n")


def _drop_section(text, heading):
    """Remove heading and its lines up to the next ## heading; text unchanged if absent."""
    lines = text.rstrip("\n").split("\n")
    if heading not in lines:
        return text
    i = lines.index(heading)
    j = next((k for k in range(i + 1, len(lines)) if lines[k].startswith("## ")), len(lines))
    while i > 0 and not lines[i - 1].strip():
        i -= 1
    del lines[i:j]
    if lines and lines[-1].strip():
        pass
    return "\n".join(lines).rstrip("\n") + "\n"


def _insert_section(text, heading, block):
    """Append block under heading; create the section before History if it is absent."""
    lines = text.rstrip("\n").split("\n")
    if heading in lines:
        i = lines.index(heading)
        j = next((k for k in range(i + 1, len(lines)) if lines[k].startswith("## ")), len(lines))
        while j > i + 1 and not lines[j - 1].strip():
            j -= 1
        lines[j:j] = [""] + block.split("\n")
    elif "## History" in lines:
        i = lines.index("## History")
        lines[i:i] = [heading, ""] + block.split("\n") + [""]
    else:
        lines += ["", heading, ""] + block.split("\n")
    return "\n".join(lines) + "\n"


CONTEST_CHOICES = ("keep", "opposite", "deletion", "variant")


def cmd_contest(tree, args):
    """dte:B60, dte:B60 (one contest per unratified leaf, then it is settled)"""
    tree.validate()
    node = tree.leaves.get(args.id)
    if node is None:
        print("unknown id: %s (%s)" % (args.id, tree.retired_hint(args.id)))
        return 2
    if not node.in_effect:
        print("%s is %s; only in-effect leaves are contested" % (args.id, node.status))
        return 2
    if node.human_held:
        print("%s is human-held; a human-made or ratified leaf is settled and is never contested (B60)" % args.id)
        return 2
    if args.record:
        return record_contest(tree, node, args)
    if node.contested_by and not args.again:
        print("%s was already contested by %s; it is settled until a human ratifies it or an agent"
              " supersedes it (B60, A7)" % (args.id, node.contested_by))
        print("  pass --again to run a second contest anyway")
        return 2
    cites = sorted({rel for rel, ln, cid, r in tree.citations if r == node.id})
    kids = tree.children.get(node.id, [])
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    print("CONTEST %s  dte:B60" % node.label())
    print()
    for line in node.body.strip().split("\n"):
        print("  " + line)
    print()
    print("Rubric (the parents): read them, judge by them, never touch them.")
    for p in node.parents:
        print("  " + (tree.leaves[p].label() if p in tree.leaves else "%s (%s)" % (p, tree.retired_hint(p))))
    if not node.parents:
        print("  none: %s is a core leaf; the rubric is the project's purpose as the owner stated it" % node.id)
    print()
    print("Build each alternative far enough to scope its cost, then judge them against the rubric alone.")
    print("Children of %s (%d) and artifacts citing it (%d) count for nothing: a better leaf may need none of them."
          % (node.id, len(kids), len(cites)))
    print("Do not reopen parents, siblings, or children in this contest.")
    # dte:B40
    print("A Why that names the incident that forced the leaf is load-bearing; one that names none is")
    print("preventive judgment and the thinner claim (B40 originInWhy). Weigh it so.")
    print()
    print("  keep      %s as written" % node.id)
    print("  opposite  the decision reversed")
    print("  deletion  no leaf here; the parents alone must explain what %s explains" % node.id)
    print("  variant   optional: a third way the rubric permits")
    print()
    print("Record the verdict and move on. The leaf is then settled until a human ratifies it (A7):")
    print("  python %s contest %s --record --chosen <%s> --by <you> --note \"...\" [--file NOTES.md]"
          % (tool, node.id, "|".join(CONTEST_CHOICES)))
    print("If keep did not win: write the winner with `python %s new %s ...`, then"
          " `python %s retire %s --by <you> [--superseded-by NEW]`." % (tool, node.ring, tool, node.id))
    return 0


def record_contest(tree, node, args):
    """dte:B60"""
    if not args.by:
        print("--record needs --by <who judged>")
        return 2
    if not args.chosen:
        print("--record needs --chosen <%s>" % "|".join(CONTEST_CHOICES))
        return 2
    note = ""
    if args.file:
        if not os.path.exists(args.file):
            print("no such file: %s" % args.file)
            return 2
        note = read_text(args.file).replace("\r\n", "\n").strip()
    if args.note:
        note = (note + "\n\n" + args.note.strip()) if note else args.note.strip()
    if not note:
        print("--record needs --note or --file: the alternatives, their scoped costs, and why %s won" % args.chosen)
        return 2
    today = datetime.date.today().isoformat()
    block = "### Contest %s by %s: %s wins\n\n%s" % (today, args.by, args.chosen, note)
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    text = _insert_section(text, "## Contest", block)
    text = set_field(text, "contested_by", args.by)
    text = append_history(text, "- %s contested by %s; %s won." % (today, args.by, args.chosen))
    write_text(node.path, text.replace("\n", nl))
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    print('recorded contest on %s "%s": %s wins' % (node.id, node.summary, args.chosen))
    if args.chosen != "keep" and (args.title or args.retire):   # dte:B60 one step from verdict to tree
        return settle_contest(tree, node, args)
    if args.chosen == "keep":
        print("  %s is settled; act on it without re-asking until a human ratifies or supersedes it (A7, B60)" % node.id)
    elif args.chosen == "deletion":
        print("  next: python %s retire %s --by <you>   then reconcile what `blast %s` listed" % (tool, node.id, node.id))
    else:
        print("  next: python %s new %s --title ... --parents %s   then   python %s retire %s --by <you> --superseded-by NEW"
              % (tool, node.ring, ",".join(node.parents), tool, node.id))
    return 0


def settle_contest(tree, node, args):
    """Write the winner (opposite or variant, from --title and a body) at the same ring with the
    same parents, then retire the loser superseded by it; or revert it for deletion.  dte:B60"""
    if args.chosen == "deletion":
        if not args.retire:
            return 0
        new_id = None
    else:
        if not args.title:
            return 0
        body = node_body(args)
        if body is None:
            return 2
        new_id = next_id(tree, node.ring)
        if args.name and not NAME_RE.match(args.name):
            print("a name is a camelCase identifier like shareImpl")
            return 2
        fields = lean_fields(new_id, args.title, node.parents, args.name or "", contested_by=args.by)
        text = build_frontmatter(fields) + body
        text = append_history(text, "- %s created as the %s that won the contest of %s; by %s."
                              % (datetime.date.today().isoformat(), args.chosen, node.id, args.by))
        dest = os.path.join(tree.decisions_dir, node.ring, new_id + ".md")
        write_text(dest, text)
        print('created %s "%s" at %s' % (new_id, args.title, tree.rel(dest)))
    fresh = Tree(tree.root, tree.decisions_dir)
    ns = argparse.Namespace(id=node.id, superseded_by=new_id, by=args.by, authorized_by=args.authorized_by)
    return cmd_retire(fresh, ns, carry_contest=True)


def cmd_conflict(tree, args):
    """dte:B29, dte:B4"""
    a, b = args.a, args.b
    if a == b:
        print("a leaf cannot contradict itself")
        return 2
    for x in (a, b):
        if x not in tree.leaves:
            print("unknown id: %s (%s)" % (x, tree.retired_hint(x)))
            return 2
        if not tree.leaves[x].in_effect:
            print("%s is %s" % (x, tree.leaves[x].status))
            return 2
    for x, y in ((a, b), (b, a)):
        n = tree.leaves[x]
        if y not in n.conflicts_with:
            text = read_text(n.path)
            nl = "\r\n" if "\r\n" in text else "\n"
            text = text.replace("\r\n", "\n")
            text = set_field(text, "conflicts_with", fm_ids(n.conflicts_with + [y]))
            write_text(n.path, text.replace("\n", nl))
    na, nb = tree.leaves[a], tree.leaves[b]
    print("declared: %s  vs  %s" % (na.label(), nb.label()))
    if ring_depth(na.ring) < ring_depth(nb.ring):
        print("  %s wins (ring %s over %s)" % (a, na.ring, nb.ring))
    elif ring_depth(na.ring) > ring_depth(nb.ring):
        print("  %s wins (ring %s over %s)" % (b, nb.ring, na.ring))
    else:
        print("  SAME RING: validate will fail until one is superseded or moved (B4)")
    return 0


def cmd_retired(tree, args):
    """dte:B29, dte:B24"""
    if not tree.retired:
        print("Ledger empty. Nothing has been retired.")
        return 0
    for i, row in sorted(tree.retired.items(), key=lambda kv: id_key(kv[0])):
        fate = row["action"] + ((" -> " + row["successor"]) if row["successor"] else "")
        auth = ("  authorized by " + row["authorized_by"]) if row["authorized_by"] else ""
        print('%-5s %s  %-18s by %s%s  "%s"' % (i, row["date"], fate, row["by"], auth, row["title"]))
    return 0


def cmd_export(tree, args):
    """dte:B29"""
    tree.validate()
    leaves = []
    for n in tree.ordered_leaves():
        d = {k: v for k, v in n.raw.items()}
        d["ring"] = n.ring
        d["path"] = tree.rel(n.path)
        leaves.append(d)
    data = {
        "leaves": leaves,
        "citations": [{"file": rel, "line": ln, "id": cid} for rel, ln, cid, r in tree.citations],
        "retired": [tree.retired[i] for i in sorted(tree.retired, key=id_key)],
        "inbox": [{"slug": it.slug, "title": it.title, "proposed_ring": it.proposed_ring,
                   "ask": it.ask, "made_by": it.made_by, "by": it.by} for it in tree.inbox],
        "errors": tree.errors,
        "warnings": tree.warnings,
    }
    text = json.dumps(data, indent=2, sort_keys=True)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print("wrote %s: %d leaves, %d citations, %d retired, %d inbox"
              % (args.out, len(leaves), len(data["citations"]), len(data["retired"]), len(data["inbox"])))
    else:
        print(text)
    return 0


VERSION = "0.2"
VENDOR_FILES = ("PROTOCOL.md", "SPEC.md", "ADOPTING.md", "README.md", "WALKTHROUGH.md")   # dte:B56
VENDOR_DIR = "vendor/dte"


def _source_commit(src):
    try:
        out = subprocess.run(["git", "-C", src, "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except OSError:
        pass
    return "unknown commit"


def render_decisions(src_tree):
    """One markdown file of a tree's in-effect leaves, by ring, for readers who must know
    the decisions without hosting them as leaves.  dte:B39"""
    out = ["# DTE decisions", "",
           "Every in-effect decision of DTE itself, rendered. These are DTE's, not this",
           "project's: read them, cite nothing here, and never re-create them as leaves.", ""]
    cur = None
    for n in src_tree.ordered_leaves():
        if not n.in_effect:
            continue
        if n.ring != cur:
            cur = n.ring
            out += ["## Ring %s" % cur, ""]
        held = " (human-held)" if n.human_held else ""
        out += ["### %s%s" % (n.label(), held), ""]
        for heading, label in (("## Decision", "Decision"), ("## Why", "Why"), ("## Consequences", "Consequences")):
            sec = _section(n.body, heading)
            if sec:
                out += ["**%s.** %s" % (label, sec.strip()), ""]
    return "\n".join(out).rstrip("\n") + "\n"


def _rendered_ids(text):
    """{id: heading} for every leaf a DECISIONS.md render lists."""
    return {m.group(1): m.group(0)[4:] for m in re.finditer(r"^### ([A-Z]\d+)\b.*$", text, re.M)}


def cmd_vendor(tree, args):
    """Copy DTE's rule text and a render of its decisions in, stamped with the copy's own refresh command,
    and say which of DTE's A and B leaves changed since the last stamp.  dte:B39, dte:B39, dte:B56"""
    src = os.path.abspath(args.src)
    src_dec = os.path.join(src, "decisions")
    missing = [f for f in VENDOR_FILES if not os.path.isfile(os.path.join(src, f))]
    if missing or not os.path.isdir(src_dec):
        print("not a DTE %s checkout: %s (missing %s)" % (VERSION, src, ", ".join(missing + ([] if os.path.isdir(src_dec) else ["decisions/"]))))
        return 2
    rel_dest = args.dir.replace(os.sep, "/").strip("/")
    dest = os.path.join(tree.root, rel_dest)
    os.makedirs(dest, exist_ok=True)
    me = os.path.abspath(__file__)
    src_tool = os.path.join(src, "tools", "dte.py")
    # the adopter's own copy of the tool: the running file if it lives in the project, else tools/dte.py
    inside = os.path.commonpath([me, tree.root]) == tree.root
    target = me if inside and me != os.path.abspath(src_tool) else os.path.join(tree.root, "tools", "dte.py")
    tool = os.path.relpath(target, tree.root).replace(os.sep, "/")
    # the stamp carries only what the copy needs to refresh itself: never a path to the source checkout
    stamp = "<!-- vendored from DTE %s (%s) on %s. Do not edit; refresh with: python %s vendor --from <a DTE checkout> --dir %s -->\n\n" % (
        VERSION, _source_commit(src), datetime.date.today().isoformat(), tool, rel_dest)
    old_render = os.path.join(dest, "DECISIONS.md")
    before = _rendered_ids(read_text(old_render)) if os.path.isfile(old_render) else None
    written = []
    for f in VENDOR_FILES:
        write_text(os.path.join(dest, f), stamp + read_text(os.path.join(src, f)))
        written.append(f)
    stale_protocol = os.path.join(dest, "CLAUDE.md")   # 0.1 vendored the protocol under this name
    if os.path.isfile(stale_protocol) and "vendored from DTE" in read_text(stale_protocol)[:200]:
        os.remove(stale_protocol)
        print("removed %s/CLAUDE.md: 0.2 vendors the protocol as PROTOCOL.md" % rel_dest)
    src_tree = Tree(src, src_dec)
    render = render_decisions(src_tree)
    write_text(old_render, stamp + render)
    written.append("DECISIONS.md")
    print("vendored DTE %s into %s/: %s" % (VERSION, rel_dest, ", ".join(written)))
    if os.path.isfile(src_tool) and os.path.abspath(src_tool) != os.path.abspath(target):
        if not os.path.isfile(target) or read_text(src_tool) != read_text(target):
            os.makedirs(os.path.dirname(target), exist_ok=True)
            write_text(target, read_text(src_tool))
            print("refreshed %s from the source" % tool)
        else:
            print("%s already matches the source" % tool)
    ign = os.path.join(tree.root, ".dteignore")
    existing = read_text(ign) if os.path.isfile(ign) else ""
    have = {l.strip().rstrip("*").rstrip("/") for l in existing.replace("\r\n", "\n").split("\n")}
    if rel_dest not in have:
        head = existing if existing else IGNORE_TEMPLATE
        write_text(ign, head.rstrip("\n") + "\n# Vendored DTE rule text: its citations are DTE's tree, not this one.\n%s/\n" % rel_dest)
        print("added %s/ to .dteignore" % rel_dest)
    if before is not None:   # dte:B56 when the rules change, the adopter hears which and what each asks of it
        after = _rendered_ids(render)
        top = lambda d: {i: h for i, h in d.items() if i[0] in "AB"}
        added = [i for i in sorted(top(after), key=id_key) if i not in before]
        gone = [i for i in sorted(top(before), key=id_key) if i not in after]
        if added or gone:
            print("\nDTE's rules changed since the last vendor. Each new A or B leaf may ask a sweep of your tree"
                  " (%s/ADOPTING.md, When the rules change):" % rel_dest)
            for i in added:
                n = src_tree.leaves.get(i)
                print("  new      %s" % after[i])
                if n:
                    print("           " + " ".join(_section(n.body, "## Decision").split())[:220])
            for i in gone:
                print("  retired  %s" % before[i])
        else:
            print("\nNo A or B leaf of DTE changed since the last vendor.")
    print("next: have your agent harness load %s/PROTOCOL.md (and SPEC.md, DECISIONS.md) at session start" % rel_dest)
    return 0


def cmd_init(tree, args):
    """dte:B29"""
    root = os.path.abspath(args.root)
    made, kept = [], []
    me = os.path.basename(__file__)
    ignore = IGNORE_TEMPLATE + "# The dte tool itself: its dte: tokens belong to DTE's own tree, not this one.\n%s\n" % me
    for rel, content in (("dte.cfg", CFG_TEMPLATE), (".dteignore", ignore), (COVERAGE_FILE, COVERAGE_TEMPLATE)):
        p = os.path.join(root, rel)
        if os.path.exists(p):
            kept.append(rel)
        else:
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(content)
            made.append(rel)
    inbox = os.path.join(root, CONFIG["decisions"], INBOX_DIR)
    if os.path.isdir(inbox):
        kept.append("decisions/")
    else:
        os.makedirs(inbox, exist_ok=True)
        made.append("decisions/ (with inbox/)")
    if made:
        print("created: " + ", ".join(made))
    if kept:
        print("left alone (already existed): " + ", ".join(kept))
    print("next:")
    print("  1. write the core: dte new A --name <goalName> --title \"<goal>\" --by <owner> --made-by human   (three to six)")
    print("  2. edit dte.cfg: authority map, the layer globs, retire mode")
    print("  3. dte vendor --from <path to a DTE checkout>: copies DTE's rule text and a render of its")
    print("     decisions into vendor/dte/, ignored by the scanner; have your agent harness load PROTOCOL.md at session start")
    print("  4. dte validate, then dte coverage: those gauges are the adoption measure")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="dte", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".")
    ap.add_argument("--decisions", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("--full", action="store_true", help="list every unratified leaf instead of the count (C23)")
    v.add_argument("--as", dest="as_ring", default=os.environ.get("DTE_RING") or None, metavar="RING",
                   help="check changed leaves against an agent's ring (B15); default $DTE_RING")
    t = sub.add_parser("tree")
    t.add_argument("--files", action="store_true", help="show citing artifacts under each leaf")
    t.add_argument("--under", default=None, metavar="ID", help="print only the subtree under ID")
    sub.add_parser("blast").add_argument("id")
    sub.add_parser("trace").add_argument("path")
    sub.add_parser("conflicts")
    cv = sub.add_parser("coverage")
    cv.add_argument("--excluded", action="store_true", help="list the excluded files under each reason")
    cv.add_argument("--check", action="store_true", help="exit 1 unless every artifact cites or is excluded, with no stale exclusion")
    sub.add_parser("next").add_argument("ring")
    vd = sub.add_parser("vendor")
    vd.add_argument("--from", dest="src", required=True, metavar="DIR", help="a DTE checkout")
    vd.add_argument("--dir", default=VENDOR_DIR, help="where the copies go (default %s)" % VENDOR_DIR)
    sub.add_parser("scope").add_argument("--comments", action="store_true",
                                          help="list comment-heavy files with no citation (B38)")
    sub.add_parser("inbox")
    ob = sub.add_parser("outbox")
    ob.add_argument("--done", default=None, metavar="ID|slug", help="clear one processed item")
    p = sub.add_parser("place")
    p.add_argument("slug")
    p.add_argument("ring")
    p.add_argument("--by", required=True, help="who is placing it")
    p.add_argument("--parents", default=None, help="comma-separated parent ids")
    m = sub.add_parser("move")
    m.add_argument("id")
    m.add_argument("ring")
    m.add_argument("--by", required=True, help="who is moving it")
    m.add_argument("--parents", default=None, help="comma-separated parent ids")
    m.add_argument("--authorized-by", dest="authorized_by", default=None,
                   help="human authorising the move of a human-held leaf")
    r = sub.add_parser("retire")
    r.add_argument("id")
    r.add_argument("--by", required=True, help="who is retiring it")
    r.add_argument("--superseded-by", dest="superseded_by", default=None, help="successor id")
    r.add_argument("--authorized-by", dest="authorized_by", default=None,
                   help="human authorising the retirement of a human-held leaf")
    a = sub.add_parser("authority")
    a.add_argument("ring", nargs="?", default=None)
    n = sub.add_parser("new")
    n.add_argument("ring")
    n.add_argument("--title", required=True)
    n.add_argument("--name", default=None, help="readable camelCase handle, unique; becomes the Obsidian alias")
    n.add_argument("--body-file", dest="body_file", default=None,
                   help="markdown file whose sections become the body verbatim (B33); beats --decision/--why")
    n.add_argument("--by", required=True)
    n.add_argument("--parents", default=None, help="comma-separated parent ids")
    n.add_argument("--made-by", dest="made_by", default="ai", help="ai | human | joint")
    n.add_argument("--status", default="active", help="active | proposed")
    n.add_argument("--branch", default="", help="the leaf roots a subtree that lives only on this branch (B54)")
    n.add_argument("--decision", default=None, help="text of the Decision section")
    n.add_argument("--why", default=None, help="text of the Why section")
    n.add_argument("--consequences", default=None, help="text of the Consequences section")
    n.add_argument("--authorized-by", dest="authorized_by", default=None,
                   help="human authorising an agent to write this leaf above its ring")
    sub.add_parser("show").add_argument("id")
    sub.add_parser("unratified")
    im = sub.add_parser("import")
    im.add_argument("dir", help="folder of markdown files: frontmatter ring, title, parents (by name, id or file), body")
    im.add_argument("--by", required=True, help="who ran the import")
    im.add_argument("--source", default=None, help="label for the History line; defaults to the folder")
    au = sub.add_parser("authorize")
    au.add_argument("ids", nargs="+")
    au.add_argument("--by", required=True, help="the human authorising")
    au.add_argument("--note", default=None)
    sub.add_parser("find").add_argument("text")
    ra = sub.add_parser("ratify")
    ra.add_argument("ids", nargs="+")
    ra.add_argument("--by", required=True, help="the human ratifying")
    rp = sub.add_parser("reparent")
    rp.add_argument("id")
    rp.add_argument("--parents", required=True, help="comma-separated parent ids")
    rp.add_argument("--by", required=True)
    rp.add_argument("--authorized-by", dest="authorized_by", default=None,
                    help="the human authorising a change to a human-held leaf (B11)")
    rn = sub.add_parser("renumber")
    rn.add_argument("id")
    rn.add_argument("--to", default=None, help="the new id (default: the next free one in the ring)")
    rn.add_argument("--by", required=True)
    rn.add_argument("--note", default=None, help="why, for the History line")
    mi = sub.add_parser("merge-ids")
    mi.add_argument("ref", help="the branch or commit this one will merge into or rebase onto")
    mi.add_argument("--by", required=True)
    mi.add_argument("--dry-run", dest="dry_run", action="store_true")
    fo = sub.add_parser("fold")
    fo.add_argument("id")
    fo.add_argument("--into", default=None, help="the parent it folds into (default: its only parent)")
    fo.add_argument("--by", required=True)
    fo.add_argument("--authorized-by", dest="authorized_by", default=None)
    ts = sub.add_parser("to-spec")
    ts.add_argument("id")
    ts.add_argument("spec", help="the spec file the text goes into (created if missing)")
    ts.add_argument("--by", required=True)
    ts.add_argument("--authorized-by", dest="authorized_by", default=None)
    ed = sub.add_parser("editorial")
    ed.add_argument("--by", required=True)
    ed.add_argument("--note", required=True, help="what the sweep changed, in one line")
    ed.add_argument("--replace", action="append", default=[], metavar="OLD=NEW",
                    help="whole-word replacement over every in-effect leaf's title and body, History kept; repeatable")
    ed.add_argument("--authorized-by", dest="authorized_by", default=None,
                    help="the human authorising a sweep that touches human-held leaves (B11)")
    ed.add_argument("--skip", action="append", default=[], metavar="ID",
                    help="leave this leaf out of --replace (one that quotes the old word on purpose); repeatable")
    sub.add_parser("upgrade")
    st = sub.add_parser("set")
    st.add_argument("id")
    st.add_argument("field", help="one of: %s (B29); the body is edited by hand" % ", ".join(SETTABLE))
    st.add_argument("value")
    st.add_argument("--by", required=True)
    st.add_argument("--authorized-by", dest="authorized_by", default=None,
                    help="the human authorising a change to a human-held leaf (B11)")
    ct = sub.add_parser("contest")
    ct.add_argument("id")
    ct.add_argument("--record", action="store_true", help="write the verdict instead of printing the brief")
    ct.add_argument("--chosen", choices=CONTEST_CHOICES, default=None)
    ct.add_argument("--by", default=None, help="who judged")
    ct.add_argument("--note", default=None, help="the alternatives, their scoped costs, and the verdict")
    ct.add_argument("--file", default=None, help="markdown file holding the same, appended before --note")
    ct.add_argument("--again", action="store_true", help="contest a leaf that was already contested")
    ct.add_argument("--title", default=None, help="with --record and a non-keep verdict: write the winner with this title (B60)")
    ct.add_argument("--name", default=None, help="the winner's camelCase name")
    ct.add_argument("--body-file", dest="body_file", default=None, help="the winner's body; or use --decision/--why")
    ct.add_argument("--decision", default=None)
    ct.add_argument("--why", default=None)
    ct.add_argument("--consequences", default=None)
    ct.add_argument("--retire", action="store_true", help="with --chosen deletion: revert the leaf now")
    ct.add_argument("--authorized-by", dest="authorized_by", default=None)
    cf = sub.add_parser("conflict")
    cf.add_argument("a")
    cf.add_argument("b")
    sub.add_parser("retired")
    ex = sub.add_parser("export")
    ex.add_argument("--out", default=None)
    sub.add_parser("init")
    ci = sub.add_parser("cite")
    ci.add_argument("file")
    ci.add_argument("ids", help="comma-separated ids")
    br = sub.add_parser("brief")
    br.add_argument("ring", nargs="?", default=None)
    br.add_argument("--under", default=None, metavar="ID", help="restrict binding leaves to one subtree")
    br.add_argument("--builder", default=None, metavar="SPEC", help="brief an agent that builds to this spec and holds no ring (B42)")
    sp = sub.add_parser("spec")
    sp.add_argument("id")
    sp.add_argument("--out", default=None, metavar="FILE", help="write the skeleton here instead of stdout")
    gp = sub.add_parser("gap")
    gp.add_argument("spec")
    gp.add_argument("--title", required=True)
    gp.add_argument("--by", required=True)
    gp.add_argument("--note", default=None)
    sub.add_parser("hook")
    args = ap.parse_args(argv)
    CONFIG.clear()
    CONFIG.update(load_config(args.root))
    decisions = args.decisions or os.path.join(args.root, CONFIG["decisions"])
    tree = Tree(args.root, decisions)
    return {
        "validate": cmd_validate, "tree": cmd_tree, "blast": cmd_blast,
        "trace": cmd_trace, "conflicts": cmd_conflicts, "coverage": cmd_coverage,
        "next": cmd_next, "scope": cmd_scope, "inbox": cmd_inbox, "outbox": cmd_outbox, "place": cmd_place,
        "authority": cmd_authority, "move": cmd_move, "retire": cmd_retire,
        "new": cmd_new, "show": cmd_show, "find": cmd_find, "ratify": cmd_ratify,
        "unratified": cmd_unratified, "import": cmd_import, "authorize": cmd_authorize,
        "conflict": cmd_conflict, "reparent": cmd_reparent, "set": cmd_set, "contest": cmd_contest, "retired": cmd_retired, "export": cmd_export,
        "init": cmd_init, "vendor": cmd_vendor, "spec": cmd_spec, "gap": cmd_gap, "cite": cmd_cite, "brief": cmd_brief, "hook": cmd_hook,
        "renumber": cmd_renumber, "merge-ids": cmd_merge_ids, "fold": cmd_fold, "to-spec": cmd_to_spec,
        "editorial": cmd_editorial, "upgrade": cmd_upgrade,
    }[args.cmd](tree, args)


if __name__ == "__main__":
    # Windows consoles default to cp1252; a leaf body with an arrow must not crash show.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
