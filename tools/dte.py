#!/usr/bin/env python3
"""dte: Decision Tree Engineering reference tool.  dte:B6,C19

One file, standard library only, Python 3.8+. Copy it into any project.

  ask the tree
    python dte.py show <ID>              one decision: lineage, children, citing lines, body
    python dte.py find <text>            search ids, titles, bodies, ledger, inbox
    python dte.py tree [--files] [--under ID]   the whole tree, or one subtree
    python dte.py blast <ID>             what would changing this touch?
    python dte.py trace <path>           why does this artifact exist?
    python dte.py conflicts              declared contradictions and who wins
    python dte.py coverage               artifacts with no citation
    python dte.py scope                  advisory: no reach, too broad, skipped rings
    python dte.py retired                the ledger
    python dte.py authority [ring]       who holds each ring (whom to ask)
    python dte.py next <ring>            next free id in a ring
  change the tree (frontmatter is never hand-edited)
    python dte.py new <ring> --title T --by NAME [--parents A1] [--made-by ai|human|joint]
    python dte.py ratify <ID>... --by HUMAN
    python dte.py cite <file> <ID,ID>    insert a citation in the file's comment syntax
    python dte.py brief <ring> [--under ID]   the block to hand a subagent at that ring
    python dte.py conflict <A> <B>       declare a contradiction on both sides
    python dte.py reparent <ID> --parents A1,B2 --by NAME   fix an orphan
    python dte.py set <ID> title|confidence VALUE --by NAME [--authorized-by NAME]   the one generic field write
    python dte.py contest <ID> [--record --chosen X --by NAME --note ...]   one contest per unratified node
    python dte.py move <ID> <ring> --by NAME [--parents A1] [--authorized-by NAME]
    python dte.py retire <ID> --by NAME [--superseded-by NEW] [--authorized-by NAME]
    python dte.py inbox / place <slug> <ring> --by NAME [--parents A1,B2]
  check and integrate
    python dte.py validate [--as RING]   consistency; exit 1 on errors ($DTE_RING is the default ring)
    python dte.py export [--out FILE]    JSON of nodes, citations, ledger, inbox
    python dte.py init                   scaffold decisions/, dte.cfg, .dteignore in a new project
    python dte.py hook                   install a pre-commit hook that runs validate

Options: --root DIR (default: cwd)  --decisions DIR (default: ROOT/decisions)
Config:  ROOT/dte.cfg, key = value lines (summaries, protect_human, authority,
         docs, broad_fraction, broad_min, retire)
"""
import argparse
import datetime
import fnmatch
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

ID_RE = re.compile(r"^([A-Z])(\d+)$")   # dte:B32
# Two citation forms, read everywhere: the dte: token and the [[ID]] wikilink
# (optionally [[ID|alias]]) that Obsidian follows. `links` in dte.cfg picks the written one.
CITE_RE = re.compile(r"\bdte:([A-Z]\d+(?:\s*,\s*[A-Z]\d+)*)")
LINK_RE = re.compile(r"\[\[([A-Z]\d+)(?:\|[^\]]*)?\]\]")


def cited_ids(line):
    """Every id cited on a line, in order, from both forms."""
    found = []
    for m in CITE_RE.finditer(line):
        found.extend(re.split(r"\s*,\s*", m.group(1)))
    found.extend(m.group(1) for m in LINK_RE.finditer(line))
    return found


def summary_of(name, title):
    """How a node is printed: `name: title` when it has a handle, else the title (dte:B32)."""
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
        ids = [new_id if x == old_id else x for x in re.split(r"\s*,\s*", m.group(1))]
        return "dte:" + ",".join(ids)
    text = CITE_RE.sub(swap, text)
    return LINK_RE.sub(lambda m: m.group(0).replace("[[" + old_id, "[[" + new_id, 1)
                       if m.group(1) == old_id else m.group(0), text)
STATUSES = {"proposed", "active", "superseded", "reverted"}
MADE_BY = {"human", "ai", "joint"}
LIST_FIELDS = {"parents", "supersedes", "conflicts_with"}
# No depends_on or structural fields: that axis belongs to the graph.  dte:B9
OBSIDIAN_FIELDS = {"aliases", "tags", "cssclasses"}   # Obsidian's own keys. aliases is written from name and must equal it (dte:B32)
KNOWN_FIELDS = LIST_FIELDS | OBSIDIAN_FIELDS | {
    "id", "name", "title", "status", "superseded_by", "made_by", "by", "date",
    "ratified_by", "confidence", "authorized_by", "contested_by",
}
INBOX_FIELDS = {"name", "title", "proposed_ring", "ask", "made_by", "by", "date", "parents", "confidence", "kind", "spec"} | OBSIDIAN_FIELDS
# The outbox: what a human changes in the vault and an agent must process. A note dropped in
# decisions/outbox, an action tag on a node (a tags property or an inline #ratify, #retire, #contest, #ask),
# or a ratified_by typed into the properties pane. Never a bare diff: an anonymous edit cannot
# be told from an agent's own unfinished work, and validate already lists changed nodes (B17).
OUTBOX_DIR = "outbox"
NAME_RE = re.compile(r"^[a-z][A-Za-z0-9]*$")   # the readable handle: camelCase, unique across the tree (dte:B32)
ACTION_TAG_RE = re.compile(r"(?<![\w/#])#(ratify|retire|contest|ask)\b")
ACTIONS = {
    "ratify": "the human ratifies it: dte ratify <ID> --by <human>",
    "retire": "the human reverts it: dte blast <ID>, then dte retire <ID> --by <human> --authorized-by <human>, fix the orphans",
    "contest": "the human disputes it: dte contest <ID> --again, build the alternatives, record the verdict, report",
    "ask": "the human left a question or comment in the body: answer it in chat; if it changes the node, make the change and add a History line",
}
IN_EFFECT = {"proposed", "active"}
TITLE_MAX = 100          # dte:B16
INBOX_DIR = "inbox"      # dte:B14
LEDGER = "RETIRED"       # dte:C11

DEFAULTS = {"summaries": True, "protect_human": True, "authority": (),
            "docs": ("*.md", "docs/*"), "broad_fraction": 0.3, "broad_min": 5,   # dte:C8
            # Layers below the tree, told apart by glob so a node never stores what is below it.  dte:B37,C24
            "specs": ("specs/*", "spec/*", "*.spec.md"),
            "tests": ("tests/*", "test/*", "test_*", "*_test.*", "*.test.*", "*.spec.ts", "*.spec.js"),
            "agents": ("CLAUDE.md", "AGENTS.md", ".claude/*", ".cursorrules", ".github/copilot-instructions.md"),
            "retire": "delete",   # dte:B24
            "links": "token",     # token writes dte:ID; wikilink writes [[ID]] (Obsidian-browsable)
            "scan_self": False}   # the tool's own file is skipped unless the tree is DTE's own (dte:C3)
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
            if key in ("summaries", "protect_human", "scan_self"):
                cfg[key] = val.lower() in ("on", "true", "yes", "1")
            elif key in ("docs", "specs", "tests", "agents"):
                cfg[key] = tuple(x.strip() for x in val.split(",") if x.strip())
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
    m = LINK_RE.fullmatch(raw)   # "[[B7]]" in a link field reads as B7
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


class Node:
    def __init__(self, path, data, body):
        self.path = path
        self.body = body
        self.raw = _normalise(data)
        data = self.raw
        self.id = str(data.get("id") or "")
        self.title = str(data.get("title") or "")
        self.name = str(data.get("name") or "")
        self.summary = summary_of(self.name, self.title)
        self.status = str(data.get("status") or "")
        self.made_by = str(data.get("made_by") or "")
        self.by = str(data.get("by") or "")
        self.superseded_by = data.get("superseded_by") or None
        self.ratified_by = data.get("ratified_by") or None
        self.authorized_by = data.get("authorized_by") or None
        self.contested_by = data.get("contested_by") or None   # dte:B28
        self.confidence = data.get("confidence") or None
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
                state += ", contested"   # dte:B28
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
        self.name = str(self.raw.get("name") or "")
        self.proposed_ring = str(self.raw.get("proposed_ring") or "").upper()
        self.ask = str(self.raw.get("ask") or "")
        self.made_by = str(self.raw.get("made_by") or "")
        self.by = str(self.raw.get("by") or "")
        self.kind = str(self.raw.get("kind") or "decision")   # decision | gap  dte:C27
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
        self.nodes = {}
        self.inbox = []
        self.outbox = []           # (slug, title, path) notes the human dropped for an agent
        self.retired = {}          # id -> ledger row  dte:C11
        self.errors = []
        self.warnings = []
        self.children = defaultdict(list)
        self.citations = []
        self.scanned_files = []
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
        for node in self.nodes.values():
            for p in node.parents:
                r = self.resolve(p)
                if r:
                    self.children[r].append(node.id)

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
        for node in self.ordered_nodes():
            for act in node.actions:
                items.append(("tag", node.id, "%s  #%s" % (node.label(), act),
                              ACTIONS[act]
                              + "; then dte outbox --done %s" % node.id))
            if node.ratified_by and not re.search(r"ratified by", node.body):
                items.append(("ratified", node.id, "%s  ratified_by: %s typed in, no History line" % (node.label(), node.ratified_by),
                              "run dte ratify %s --by \"%s\" so History records it"
                              % (node.id, node.ratified_by)))
        return items

    # -- ledger  dte:C11
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
                fh.write("# Retired decision ids. Never reissued. Text lives in git history.  dte:C11\n")
                fh.write("# id\tdate\taction\tsuccessor\tby\tauthorized_by\ttitle\n")
            fh.write("\t".join([id_, datetime.date.today().isoformat(), action, successor or "-",
                                by, authorized_by or "-", title.replace("\t", " ")]) + "\n")

    def retired_hint(self, i):
        row = self.retired.get(i)
        if not row:
            return "does not exist"
        s = "was retired on %s (%s%s)" % (row["date"], row["action"],
                                         (" to " if row["action"] == "moved" else " by ") + row["successor"]
                                         if row["successor"] else "")
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
        node = Node(path, data, body)
        if not ID_RE.match(node.id):
            self.errors.append("%s: bad or missing id %r" % (rel, node.id))
            return
        if node.id in self.nodes:
            self.errors.append("%s: duplicate id %s (also %s)"
                               % (rel, node.id, self.rel(self.nodes[node.id].path)))
            return
        self.nodes[node.id] = node

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
        return i if i in self.nodes else None

    def ordered(self, ids=None):
        return sorted(ids if ids is not None else self.nodes, key=id_key)

    def ordered_nodes(self):
        return [self.nodes[i] for i in self.ordered()]

    # -- validation (rules R1..R9 in SPEC)
    def validate(self, as_ring=None):
        if self._validated:
            return not self.errors
        self._validated = True
        E, W = self.errors, self.warnings
        names = {}   # handle -> id
        for node in self.ordered_nodes():
            i = node.id
            expected = os.path.join(self.decisions_dir, node.ring, i + ".md")
            if os.path.abspath(node.path) != os.path.abspath(expected):
                E.append("%s: file should be at %s" % (i, self.rel(expected)))
            for f in node.raw:
                if f not in KNOWN_FIELDS:
                    E.append("%s: unknown frontmatter field %r" % (i, f))
            if node.name and not NAME_RE.match(node.name):
                E.append("%s: name %r is not a camelCase identifier" % (i, node.name))
            if node.name and node.in_effect and names.get(node.name, i) != i:
                E.append("%s: name %r is already %s's" % (i, node.name, names[node.name]))
            if node.in_effect:
                names.setdefault(node.name, i)
            aliases = node.raw.get("aliases")
            if aliases is not None and [str(a) for a in (aliases if isinstance(aliases, list) else [aliases]) if str(a)] != ([node.name] if node.name else []):
                E.append("%s: aliases must be exactly the name (no second identity, B32); set name instead" % i)
            if node.status not in STATUSES:
                E.append("%s: status must be one of %s" % (i, sorted(STATUSES)))
            if node.made_by not in MADE_BY:
                E.append("%s: made_by must be one of %s" % (i, sorted(MADE_BY)))
            if not node.by:
                E.append("%s: 'by' is required" % i)
            if not node.title:
                E.append("%s: title is required" % i)
            elif len(node.title) > TITLE_MAX:   # dte:B16
                W.append("%s: title is %d chars; keep the summary under %d" % (i, len(node.title), TITLE_MAX))
            if "## Decision" not in node.body or "## Why" not in node.body:
                E.append("%s: body needs '## Decision' and '## Why' sections" % i)
            if re.search(r"^TODO$", node.body, re.M):
                W.append("%s: body still has a TODO placeholder; finish it" % i)
            if node.ratified_by and "## Contest" in node.body.split("\n"):   # dte:B41
                W.append("%s: ratified but still carries '## Contest'; a ratified node is present governance, drop it" % i)
            # R1 parents  dte:B10
            if node.ring == "A" and node.parents:
                E.append("%s: core (A) nodes cannot have parents" % i)
            if node.ring != "A" and not node.parents:
                E.append("%s: non-core node has no parents" % i)
            for p in node.parents:
                pid = self.resolve(p)
                if pid is None:
                    E.append("%s: ORPHAN, parent %s %s; re-parent, supersede, or revert %s"
                             % (i, p, self.retired_hint(p), i))
                    continue
                parent = self.nodes[pid]
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
                elif i not in self.nodes[sb].supersedes:
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
                elif self.nodes[sid].status != "superseded":
                    E.append("%s: supersedes %s but %s has status %s"
                             % (i, sid, sid, self.nodes[sid].status))
            # R2 conflicts  dte:B4
            for c in node.conflicts_with:
                cid = self.resolve(c)
                if cid is None:
                    E.append("%s: conflicts_with %s %s" % (i, c, self.retired_hint(c)))
                elif self.nodes[cid].in_effect and node.in_effect \
                        and self.nodes[cid].ring == node.ring:
            # a same-ring contradiction is a refinement filed as a sibling: dte:B35
                    E.append("%s: same-ring contradiction with %s; supersede or move one" % (i, cid))
            # R7 human-held protection  dte:B11
            if CONFIG["protect_human"] and node.human_held and not node.authorized_by:
                if node.status in ("superseded", "reverted"):
                    E.append("%s: human-held node is %s without authorized_by naming a human"
                             % (i, node.status))
            if node.in_effect and not self.children.get(i):
                self._leaf_ids.add(i)
        # citations  dte:C3
        self.scan()
        for rel, ln, cid, resolved in self.citations:
            if resolved is None:
                if cid in self.retired:
                    E.append("%s:%d: cites %s, which %s" % (rel, ln, cid, self.retired_hint(cid)))
                else:
                    E.append("%s:%d: citation to unknown id %s" % (rel, ln, cid))
            elif not self.nodes[resolved].in_effect:
                W.append("%s:%d: cites %s which is %s" % (rel, ln, cid, self.nodes[resolved].status))
        for node, logged in self.body_changes():   # dte:B36
            if not logged:
                W.append("%s: body changed in this working tree with no new History line; add one" % node.id)
        for code, rel in self.retired_paths():   # dte:C11
            gone_id = os.path.splitext(os.path.basename(rel))[0]
            if code == "R":
                E.append("%s: node file renamed; use dte move (a move is a new id plus retirement)" % rel)
            elif gone_id not in self.retired:
                E.append("%s: node file deleted with no ledger line; use dte retire" % rel)
            elif CONFIG["retire"] == "keep":
                E.append("%s: node file deleted but retire = keep; restore it with a status instead" % rel)
            elif gone_id in self.nodes:
                E.append("%s: deleted and retired, yet %s still exists as a node" % (rel, gone_id))
        if as_ring:
            self._check_authority(as_ring)
        return not E

    def _check_authority(self, as_ring):
        """dte:B15"""
        E, W = self.errors, self.warnings
        as_ring = as_ring.upper()
        changed, exact = self.changed_files()
        if not exact:
            W.append("git unavailable or not a repository; treating every node as changed (--as check is coarse)")
        by_path = {self.rel(n.path): n for n in self.nodes.values()}
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
                E.append("%s: human-held node changed without authorized_by (agent at ring %s)"
                         % (node.id, as_ring))
        for code, rel in self.retired_paths():   # deleted this working tree  dte:C11
            if code != "D":
                continue
            gone_id = os.path.splitext(os.path.basename(rel))[0]
            row = self.retired.get(gone_id)
            auth = row["authorized_by"] if row else ""
            if ring_depth(gone_id[0]) < ring_depth(as_ring) and not auth:
                E.append("%s: retired by an agent at ring %s but lived at ring %s; escalate to %s"
                         % (gone_id, as_ring, gone_id[0], holder_of(gone_id[0], CONFIG)))
            old = self.node_at_head(rel)
            if old is not None and CONFIG["protect_human"] and old.human_held and not auth:
                E.append("%s: human-held node deleted without authorized_by in the ledger (agent at ring %s)"
                         % (gone_id, as_ring))

    def node_at_head(self, rel):
        """The node as committed at HEAD, or None."""
        try:
            out = subprocess.run(["git", "-C", self.root, "show", "HEAD:" + rel],
                                 capture_output=True, text=True, check=True).stdout
            data, body = parse_frontmatter(out)
            return Node(os.path.join(self.root, rel), data, body)
        except (OSError, subprocess.CalledProcessError, ValueError):
            return None

    def git_status(self):
        """[(code, path, old_path)] from git, or None without git.  dte:C6"""
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
            return {self.rel(n.path) for n in self.nodes.values()}, False
        return {p for _, p, _ in rows}, True

    def retired_paths(self):
        """Node files git says were deleted or renamed, excluding the inbox.  dte:C11"""
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
        """Advisory scope checks.  dte:B21,C8"""
        self.validate()
        frac, minimum = CONFIG["broad_fraction"], CONFIG["broad_min"]
        impl = defaultdict(set)
        core_lines = []
        for rel, ln, cid, r in self.citations:
            if not r or self.layer_of(rel) == "docs":   # dte:B37 docs describe; specs, tests, agents, code reach
                continue
            impl[r].add(rel)
            if self.nodes[r].ring == "A":
                core_lines.append((rel, ln, r))
        n_noncore = sum(1 for n in self.nodes.values() if n.ring != "A" and n.in_effect)
        n_art = len(self.scanned_files)
        F = []
        for n in self.ordered_nodes():
            if not n.in_effect:
                continue
            for p in n.parents:
                pid = self.resolve(p)
                if pid and ring_depth(n.ring) - ring_depth(self.nodes[pid].ring) > 1:
                    between = chr(ord(n.ring) - 1)
                    F.append(("skipped ring", n.id,
                              "parent %s is at ring %s; a ring %s decision is missing, or %s belongs at ring %s"
                              % (pid, self.nodes[pid].ring, between, n.id, between)))
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
                      "cites core node %s directly; no rule-level decision explains this line, add one or cite something more specific" % r))
        return F

    def unratified(self):
        return [n for n in self.ordered_nodes()
                if n.made_by in ("ai", "joint") and not n.ratified_by and n.in_effect]

    LAYERS = ("tests", "specs", "agents", "docs")
    LAYER_LABEL = {"tests": "enforced by", "specs": "specified by", "agents": "instructs",
                   "docs": "described by", "code": "implemented by"}

    def layer_of(self, rel):
        """Which layer below the tree a citing artifact belongs to, by the dte.cfg globs.  dte:B37,C24"""
        for layer in self.LAYERS:
            if self._ignored(rel, list(CONFIG[layer])):
                return layer
        return "code"

    def cited_by(self, i):
        """{layer: {rel: [lines]}} every artifact citing i, grouped by layer."""
        out = defaultdict(lambda: defaultdict(list))
        for rel, ln, cid, r in self.citations:
            if r == i:
                out[self.layer_of(rel)][rel].append(ln)
        return out

    def body_changes(self):
        """[(node, has_new_history)] nodes whose body differs from HEAD.  dte:B36,C7"""
        changed, exact = self.changed_files()
        if not exact:
            return []
        by_path = {self.rel(n.path): n for n in self.nodes.values()}
        out = []
        for rel in sorted(changed):
            node = by_path.get(rel)
            if node is None:
                continue
            old = self.node_at_head(rel)
            if old is None:
                continue
            # whitespace-insensitive: a reflow for the reading surface is not a body edit (B36)
            strip = lambda b: re.sub(r"\s+", " ", re.sub(r"\n## History\n.*", "", b.replace("\r\n", "\n"), flags=re.S)).strip()
            if strip(old.body) != strip(node.body):
                hist = lambda b: [l for l in b.replace("\r\n", "\n").split("\n") if l.startswith("- ")]
                old_h = _section(old.body, "## History")
                new_h = _section(node.body, "## History")
                out.append((node, len(hist(new_h)) > len(hist(old_h))))
        return out

    # -- scanning  dte:C3
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
        """Parent chains from i to the core, memoised and capped: a node with several
        parents in each of several rings has combinatorially many chains."""
        memo = self.__dict__.setdefault("_anc", {})
        if i in memo:
            return memo[i]
        node = self.nodes[i]
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
            print("\nUnratified AI/joint decisions: %d (%d contested, %d imported); list: dte unratified  dte:B7, dte:B28"
                  % (len(un), contested, imported))


def print_unratified(tree, un=None):
    """dte:C23 the full list lives behind its own command so validate stays short"""
    un = tree.unratified() if un is None else un
    if not un:
        print("No unratified AI/joint decisions.")
        return
    contested = sum(1 for n in un if n.contested_by)
    print("Unratified AI/joint decisions (%d, %d contested):  dte:B7, dte:B28" % (len(un), contested))
    for n in un:
        who = ("  contested by %s" % n.contested_by) if n.contested_by else ""
        imp = "  imported" if n.imported else ""
        print("  %s  [%s: %s]%s%s" % (n.label(), n.made_by, n.by, who, imp))


def cmd_unratified(tree, args):
    tree.validate()
    print_unratified(tree)
    return 0


def print_inbox(tree):
    """dte:B14, dte:C27"""
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


def print_changed_nodes(tree):
    """dte:C7"""
    changed, exact = tree.changed_files()
    if not exact:
        return
    by_path = {tree.rel(n.path): n for n in tree.nodes.values()}
    hits = [by_path[r] for r in sorted(changed) if r in by_path]
    if not hits:
        return
    bodies = {n.id: logged for n, logged in tree.body_changes()}
    print("\nNodes changed in this working tree (report these, ID plus name):  dte:B17")
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
        rows = [(rel, n, c) for rel, n, c in comment_census(tree) if n >= COMMENT_HEAVY and c == 0]
        rows.sort(key=lambda r: -r[1])
        if not rows:
            print("No migration candidates: every file with %d+ comment lines carries a citation." % COMMENT_HEAVY)
            return 0
        print("MIGRATION CANDIDATES (%d): comment-heavy files with no citation (B38)" % len(rows))
        for rel, n, _ in rows:
            print("  %-50s %4d comment lines" % (rel, n))
        print("\nWHY comments move into a node's Why; HOW into a spec; WHAT stays. A heuristic, not a finding.")
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
            label = tree.nodes[subject].label() if subject in tree.nodes else subject
            print("  %s\n    %s" % (label, msg))
        print()
    print("%d findings. Advisory: thresholds and docs globs are in dte.cfg." % len(F))
    return 0


def cmd_validate(tree, args):
    ok = tree.validate(as_ring=args.as_ring)
    report(tree, full=args.full)
    print_changed_nodes(tree)
    n_out = len(tree.outbox_items())
    if n_out:
        print("\nOUTBOX (%d): the human designated things in the vault for an agent; run dte outbox" % n_out)
    F = tree.scope_findings()
    if F:
        print("\n%d scope findings (advisory): run dte scope" % len(F))
    n_cited = len({r for r, _, _, _ in tree.citations})
    print("\n%d nodes, %d pending, %d citations in %d/%d artifacts, %d errors, %d warnings"
          % (len(tree.nodes), len(tree.inbox), len(tree.citations), n_cited,
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
        node = tree.nodes[i]
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
        if args.under not in tree.nodes:
            print("unknown id: %s (%s)" % (args.under, tree.retired_hint(args.under)))
            return 2
        walk(args.under, 0)
        return 0
    for i in tree.ordered():
        if tree.nodes[i].ring == "A":
            walk(i, 0)
    stray = [i for i in tree.ordered() if tree.nodes[i].ring != "A" and i not in seen]
    if stray:
        print("\nNot reachable from the core:")
        for i in stray:
            print("  " + tree.nodes[i].label())
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
    node = tree.nodes[target]
    print("BLAST RADIUS of %s\n" % node.label())
    if node.human_held:
        print("  This node is human-held. Changing it needs authorized_by from a human.  dte:B11\n")
    desc = tree.descendants(target)
    by_ring = defaultdict(list)
    for d in desc:
        by_ring[tree.nodes[d].ring].append(d)
    print("Descendant decisions (%d):" % len(desc))
    if not desc:
        print("  none")
    for ring in sorted(by_ring):
        print("  ring %s:" % ring)
        for d in tree.ordered(by_ring[ring]):
            n = tree.nodes[d]
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
    if node.supersedes:
        print("\nCurrently superseded by %s (candidates to return if %s is reverted):" % (target, target))
        for s in node.supersedes:
            sid = tree.resolve(s)
            if sid:
                print("  " + tree.nodes[sid].label())
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
                if i in tree.nodes and i not in order:
                    order.append(i)
    order.sort(key=lambda i: (-ring_depth(tree.nodes[i].ring), id_key(i)))
    print("\nDecisions, most specific first:")
    for i in order:
        print("  " + tree.nodes[i].label())
    return 0


def cmd_conflicts(tree, args):
    """dte:B4"""
    tree.validate()
    pairs = set()
    for n in tree.nodes.values():
        for c in n.conflicts_with:
            cid = tree.resolve(c)
            if cid:
                pairs.add(tuple(sorted((n.id, cid), key=id_key)))
    if not pairs:
        print("No declared contradictions.")
        return 0
    for a, b in sorted(pairs, key=lambda p: (id_key(p[0]), id_key(p[1]))):
        na, nb = tree.nodes[a], tree.nodes[b]
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


def cmd_coverage(tree, args):
    """dte:B22"""
    tree.scan()
    cited = {r for r, _, _, _ in tree.citations}
    missing = [f for f in tree.scanned_files if f not in cited]
    total = len(tree.scanned_files)
    pct = 100.0 * (total - len(missing)) / total if total else 0.0
    print("Coverage: %d/%d artifacts cite a decision (%.1f%%)\n" % (total - len(missing), total, pct))
    if missing:
        print("No citation:")
        for f in missing:
            print("  " + f)
    enforced = {r for rel, _, _, r in tree.citations if r and tree.layer_of(rel) == "tests"}
    unenforced = [n for n in tree.ordered_nodes() if n.in_effect and n.ring != "A" and n.id not in enforced]
    if unenforced:
        print("\nIn effect, no citing test (%d); a rule nothing checks can be violated silently (B37):" % len(unenforced))
        for n in unenforced:
            print("  " + n.label())
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
    used = [n.number for n in tree.nodes.values() if n.ring == ring]
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
    node = tree.nodes.get(ref)
    if node is None:
        print("no outbox note or node called %s" % ref)
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
        print("%s is a spec gap, not a decision: answer it in %s, then remove the file (C27)" % (args.slug, item.spec))
        return 2
    parents = [p.strip() for p in (args.parents or "").split(",") if p.strip()] or item.parents
    if ring == "A" and parents:
        print("ring A nodes cannot have parents")
        return 2
    if ring != "A" and not parents:
        print("a ring %s node needs parents; pass --parents A1,B2" % ring)
        return 2
    for p in parents:
        pid = tree.resolve(p)
        if pid is None:
            print("parent %s does not exist" % p)
            return 2
        if ring_depth(tree.nodes[pid].ring) >= ring_depth(ring):
            print("parent %s is not shallower than ring %s" % (pid, ring))
            return 2
    new_id = next_id(tree, ring)
    today = datetime.date.today().isoformat()
    fm = [
        "---",
        "id: %s" % new_id,
        "title: %s" % fm_str(item.title),
        "status: active",
        "parents: %s" % fm_ids(parents),
        "supersedes: []",
        "superseded_by:",
        "conflicts_with: []",
        "made_by: %s" % item.made_by,
        "by: %s" % item.by,
        "date: %s" % (item.raw.get("date") or today),
        "ratified_by:",
    ]
    if item.raw.get("confidence"):
        fm.append("confidence: %s" % item.raw["confidence"])
    if item.name:
        fm.insert(2, "name: %s" % item.name)
        fm.append("aliases: [%s]" % item.name)
    fm.append("---")
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
            lines[k] = new
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
    """Ledger line, then delete the file (delete mode) or set status (keep mode).  dte:B24,C11"""
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
    text = set_field(text, "status", "superseded" if successor else "reverted")
    text = set_field(text, "superseded_by", fm_id(successor) if successor else "")
    if authorized_by:
        text = set_field(text, "authorized_by", authorized_by)
    text = append_history(text, "- %s %s by %s." % (datetime.date.today().isoformat(), what, by))
    write_text(node.path, text.replace("\n", nl))
    return "%s; file kept with status (retire = keep), ledger line written" % what


def rewrite_references(tree, old_id, new_id):
    """dte:OLD -> dte:NEW in artifacts, OLD -> NEW in children's parents.  dte:C9"""
    files = sorted({rel for rel, _, cid, _ in tree.citations if cid == old_id})
    for rel in files:
        path = os.path.join(tree.root, rel)
        write_text(path, sub_citations(read_text(path), old_id, new_id))
    children = list(tree.children.get(old_id, []))
    for c in children:
        cpath = tree.nodes[c].path
        ctext = read_text(cpath)
        cnl = "\r\n" if "\r\n" in ctext else "\n"
        ctext = ctext.replace("\r\n", "\n")
        ps = [new_id if p == old_id else p for p in tree.nodes[c].parents]
        ctext = set_field(ctext, "parents", fm_ids(ps))
        write_text(cpath, ctext.replace("\n", cnl))
    return files, children


def cmd_retire(tree, args):
    """dte:C11"""
    tree.validate()
    old_id, new_id = args.id, args.superseded_by
    node = tree.nodes.get(old_id)
    if node is None:
        print("unknown id: %s (%s)" % (old_id, tree.retired_hint(old_id)))
        return 2
    if not node.in_effect and not new_id:
        new_id = str(node.superseded_by or "") or None
    if new_id:
        new = tree.nodes.get(new_id)
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
        if old_id not in new.supersedes:
            t = set_field(t, "supersedes", fm_ids(new.supersedes + [old_id]))
        carried = _section(node.body, "## Contest") if node.contested_by else ""
        if carried:   # dte:C17,C22 the contest that produced the successor travels with it, and settles it
            t = _insert_section(t, "## Contest",
                                "Carried from %s, which this node supersedes.\n\n%s" % (old_id, carried))
            if not new.contested_by:
                t = set_field(t, "contested_by", node.contested_by)
                t = append_history(t, "- %s settled by the contest of %s, which it supersedes (contested by %s)."
                                   % (datetime.date.today().isoformat(), old_id, node.contested_by))
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
            print("    %s" % tree.nodes[c].label())
    else:
        if files or children:
            print("  these now fail validation until re-pointed or retired (blast radius of the revert):")
            for f in files:
                print("    " + f)
            for c in children:
                print("    %s" % tree.nodes[c].label())
        if node.supersedes:
            print("  %s had superseded: %s. Candidates to return." % (old_id, ", ".join(node.supersedes)))
    return 0


def cmd_move(tree, args):
    """dte:C9"""
    tree.validate()
    old_id, ring = args.id, args.ring.upper()
    if not re.match(r"^[A-Z]$", ring):
        print("ring must be a single letter A-Z")
        return 2
    node = tree.nodes.get(old_id)
    if node is None:
        print("unknown id: %s" % old_id)
        return 2
    if not node.in_effect:
        print("%s is %s; only in-effect nodes move" % (old_id, node.status))
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
                   if p in tree.nodes and ring_depth(tree.nodes[p].ring) < ring_depth(ring)]
    dropped = [p for p in node.parents if p not in parents]
    if ring == "A" and parents:
        print("ring A nodes cannot have parents")
        return 2
    if ring != "A" and not parents:
        print("no parent of %s is shallower than ring %s; pass --parents" % (old_id, ring))
        return 2
    for p in parents:
        if p not in tree.nodes:
            print("parent %s does not exist" % p)
            return 2
        if ring_depth(tree.nodes[p].ring) >= ring_depth(ring):
            print("parent %s is not shallower than ring %s" % (p, ring))
            return 2
    children = [c for c in tree.children.get(old_id, [])]
    for c in children:
        if ring_depth(tree.nodes[c].ring) <= ring_depth(ring):
            print("child %s is at ring %s, not deeper than %s; move or re-parent it first"
                  % (c, tree.nodes[c].ring, ring))
            return 2
    new_id = next_id(tree, ring)
    today = datetime.date.today().isoformat()
    # new node
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    text = set_field(text, "id", new_id)
    text = set_field(text, "status", "active")
    text = set_field(text, "parents", fm_ids(parents))
    text = set_field(text, "supersedes", fm_ids([old_id]))
    text = set_field(text, "superseded_by", "")
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
    # old node
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
    rings = sorted({n.ring for n in tree.nodes.values()} | ({args.ring.upper()} if args.ring else set()))
    print("\nWhom to ask, per ring in use:")
    for r in rings:
        print("  %s: %s" % (r, holder_of(r, CONFIG)))
    return 0


# ---------------------------------------------------------------- authoring  dte:B29

CFG_TEMPLATE = """# DTE configuration. One key = value per line. Every key shown with its default.
#
# summaries: print "ID title" everywhere (on) or bare IDs (off).
summaries = on
#
# protect_human: nodes made or ratified by a human need authorized_by (a human's
# name) before they can be superseded, reverted, or moved.
protect_human = on
#
# authority: advisory map of who holds each ring. "C+" means C and deeper.
# Binds agents, never humans. Unmapped rings mean "ask the human".
authority = A:human, B:orchestrator, C+:subagent
#
# retire: delete removes a retired node's file (needs git; the ledger
# decisions/RETIRED burns the number); keep sets a status instead.
retire = delete
#
# Layers below the tree (B37): globs that say what kind of artifact cites a node.
# The tree holds why; specs hold what; code holds how; tests enforce; agent
# instructions carry process rules. show prints each as a derived list and a
# node never stores any of it. docs describe and do not count as reach.
docs = *.md, docs/*
specs = specs/*, spec/*, *.spec.md
tests = tests/*, test/*, test_*, *_test.*, *.test.*
agents = CLAUDE.md, AGENTS.md, .claude/*
#
# scope checks (advisory).
broad_fraction = 0.3
broad_min = 5
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
        return "ring A nodes cannot have parents"
    if ring != "A" and not parents:
        return "a ring %s node needs parents; pass --parents A1,B2" % ring
    for p in parents:
        if p not in tree.nodes:
            return "parent %s %s" % (p, tree.retired_hint(p))
        if ring_depth(tree.nodes[p].ring) >= ring_depth(ring):
            return "parent %s is not shallower than ring %s" % (p, ring)
    return None


def split_ids(s):
    return [p.strip() for p in (s or "").split(",") if p.strip()]


def node_body(args):
    """The body from --body-file (verbatim, frontmatter stripped) or from the section flags.  dte:C20"""
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
    new_id = next_id(tree, ring)
    fields = [
        ("id", new_id), ("title", fm_str(args.title)), ("status", args.status), ("parents", parents),
        ("supersedes", []), ("superseded_by", ""), ("conflicts_with", []),
        ("made_by", args.made_by), ("by", args.by),
        ("date", datetime.date.today().isoformat()), ("ratified_by", ""),
    ]
    if args.authorized_by:
        fields.append(("authorized_by", args.authorized_by))
    if args.confidence:
        fields.append(("confidence", args.confidence))
    if args.name:
        if not NAME_RE.match(args.name):
            print("a name is a camelCase identifier like shareImpl")
            return 2
        fields.insert(1, ("name", args.name))
        fields.append(("aliases", "[%s]" % args.name))   # so [[name]] resolves in Obsidian
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


IMPORT_FIELDS = KNOWN_FIELDS - {"id", "superseded_by", "supersedes", "conflicts_with"} | {"ring"}


def cmd_import(tree, args):
    """Re-home an existing corpus: one markdown file per node, every property carried
    through, parents by name or id, ids allocated parent-first.  dte:B33,C20"""
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
    names = {n.name: n.id for n in tree.nodes.values() if n.name and n.in_effect}
    keys = {}
    for key, data, body, path in items:
        ring = str(data.get("ring") or "").upper()
        if not re.match(r"^[A-Z]$", ring):
            errors.append("%s: needs ring: <letter>" % key)
        for f in data:
            if f not in IMPORT_FIELDS:
                errors.append("%s: unknown property %r; import carries only node properties (B33)" % (key, f))
        if not data.get("title"):
            errors.append("%s: title is required" % key)
        if "## Decision" not in body or "## Why" not in body:
            errors.append("%s: body needs '## Decision' and '## Why'" % key)
        name = str(data.get("name") or "")
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
        if ref in tree.nodes:
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
                errors.append("%s: parent %r is not an existing node or a file in the batch" % (key, ref)); return False
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
        err = check_parents(tree, ring, [p for p in parents if p in tree.nodes]) if all(p in tree.nodes for p in parents) else None
        for pid in parents:
            pring = tree.nodes[pid].ring if pid in tree.nodes else pid[0]
            if ring_depth(pring) >= ring_depth(ring):
                err = "parent %s is not shallower than ring %s" % (pid, ring)
        if ring != "A" and not parents:
            err = "a ring %s node needs parents" % ring
        if ring == "A" and parents:
            err = "ring A nodes cannot have parents"
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
        fields = [("id", new_id)]
        if data.get("name"):
            fields.append(("name", str(data["name"])))
        fields += [("title", fm_str(str(data["title"]))), ("status", str(data.get("status") or "active")),
                   ("parents", parents), ("supersedes", []), ("superseded_by", ""), ("conflicts_with", []),
                   ("made_by", str(data.get("made_by") or "ai")), ("by", str(data.get("by") or args.by)),
                   ("date", str(data.get("date") or today)), ("ratified_by", str(data.get("ratified_by") or ""))]
        for f in ("authorized_by", "contested_by", "confidence", "tags", "cssclasses"):
            if data.get(f):
                v = data[f]
                fields.append((f, "[%s]" % ", ".join(str(x) for x in v) if isinstance(v, list) else str(v)))
        if data.get("name"):
            fields.append(("aliases", "[%s]" % data["name"]))
        text = build_frontmatter(fields) + "\n" + body.strip("\n") + "\n"
        text = append_history(text, "- %s imported from %s (%s) by %s." % (today, source, key, args.by))
        if data.get("ratified_by"):
            text = append_history(text, "- %s ratified by %s, carried by the import." % (today, data["ratified_by"]))
        dest_dir = os.path.join(tree.decisions_dir, ring)
        os.makedirs(dest_dir, exist_ok=True)
        dest = os.path.join(dest_dir, new_id + ".md")
        write_text(dest, text)
        written.append(dest)
        tree.nodes[new_id] = Node(dest, dict((k, v) for k, v in fields), body)
        print("  %s  <-  %s  %s" % (new_id, key, str(data["title"])[:70]))
    print("imported %d nodes from %s. They are re-homed content: no contest is owed at import (B28, B33)."
          % (len(written), source))
    print("  next: dte validate; cite each from what it governs; remove %s when done." % args.dir)
    return 0


def cmd_show(tree, args):
    """dte:B29"""
    tree.validate()
    i = args.id
    node = tree.nodes.get(i)
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
    print("  status: %s   made_by: %s   by: %s   date: %s"
          % (node.status, node.made_by, node.by, node.raw.get("date") or "?"))
    extra = []
    if node.ratified_by:
        extra.append("ratified_by: %s" % node.ratified_by)
    if node.authorized_by:
        extra.append("authorized_by: %s" % node.authorized_by)
    if node.confidence:
        extra.append("confidence: %s" % node.confidence)
    if extra:
        print("  " + "   ".join(extra))
    if node.parents:
        print("  parents:")
        for p in node.parents:
            print("    " + (tree.nodes[p].label() if p in tree.nodes else "%s (%s)" % (p, tree.retired_hint(p))))
        print("  lineage to the core:")
        for chain in tree.ancestors(i):
            print("    " + "  <-  ".join(chain))
    else:
        print("  parents: none (core)")
    kids = tree.ordered(tree.children.get(i, []))
    print("  children (%d):" % len(kids))
    for c in kids:
        print("    " + tree.nodes[c].label())
    by_layer = tree.cited_by(i)
    n_hits = sum(len(v) for v in by_layer.values())
    print("  citing artifacts (%d), derived from citations, never stored here:" % n_hits)
    for layer in ("specs", "code", "tests", "agents", "docs"):
        hits = by_layer.get(layer)
        if not hits:
            continue
        print("    %s:" % tree.LAYER_LABEL[layer])
        for rel in sorted(hits):
            print("      %s  lines %s" % (rel, ", ".join(str(x) for x in sorted(hits[rel]))))
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
    for node in tree.ordered_nodes():
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
    """Record a human's go-ahead on an existing node: authorized_by plus a History line.  dte:C21,B11"""
    tree.validate()
    code = 0
    for i in args.ids:
        node = tree.nodes.get(i)
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
    """dte:B29, dte:B7"""
    rc = 0
    for i in args.ids:
        rc = max(rc, ratify_one(tree, i, args.by))
    return rc


def ratify_one(tree, i, by):
    node = tree.nodes.get(i)
    if node is None:
        print("unknown id: %s (%s)" % (i, tree.retired_hint(i)))
        return 2
    if not node.in_effect:
        print("%s is %s; only in-effect nodes are ratified" % (i, node.status))
        return 2
    if node.made_by == "human":
        print("%s is human-made; ratification is for ai and joint nodes" % i)
        return 2
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    text = set_field(text, "ratified_by", by)
    flipped = node.status == "proposed"
    if flipped:
        text = set_field(text, "status", "active")
    dropped = "## Contest" in text.split("\n")
    if dropped:   # dte:B41: the contest informed the ruling; git keeps it
        text = _drop_section(text, "## Contest")
    text = append_history(text, "- %s ratified by %s%s%s." % (
        datetime.date.today().isoformat(), by, " (proposed -> active)" if flipped else "",
        "; contest section dropped, see git" if dropped else ""))
    write_text(node.path, text.replace("\n", nl))
    print('ratified %s "%s" by %s%s' % (i, node.summary, by,
                                        "; status proposed -> active" if flipped else ""))
    print("  it is now human-held (B11)")
    if dropped:
        print("  contest section dropped (B41); the commit before this one keeps it")
    return 0


# ---------------------------------------------------------------- cite, brief, hook  dte:C14,B27

COMMENT_STYLES = (
    ("#", {".py", ".rb", ".sh", ".bash", ".zsh", ".fish", ".yml", ".yaml", ".toml", ".cfg", ".ini",
           ".ps1", ".pl", ".r", ".txt", ".env", ".mk", ".cmake", ".dockerfile", ".gitignore",
           ".dteignore", ""}),
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


def cmd_cite(tree, args):
    """dte:C14"""
    ids = split_ids(args.ids)
    for i in ids:
        if i not in tree.nodes:
            print("cannot cite %s: %s" % (i, tree.retired_hint(i)))
            return 2
        if not tree.nodes[i].in_effect:
            print("cannot cite %s: it is %s" % (i, tree.nodes[i].status))
            return 2
    path = os.path.abspath(args.file)
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
    above = [n for n in tree.ordered_nodes() if n.in_effect and ring_depth(n.ring) < ring_depth(ring)]
    scope_note = ""
    if args.under:
        if args.under not in tree.nodes:
            print("unknown id: %s (%s)" % (args.under, tree.retired_hint(args.under)))
            return 2
        keep = {args.under}
        for chain in tree.ancestors(args.under):
            keep.update(x for x in chain if x in tree.nodes)
        keep.update(tree.descendants(args.under))
        above = [n for n in above if n.id in keep]
        scope_note = " relevant to %s" % args.under
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    prev = chr(ord(ring) - 1) if ring != "A" else None
    print("DTE BRIEF: you operate at ring %s of this project's decision tree." % ring)
    print()
    print("Rules:")
    print("  1. Decide only at ring %s or deeper. Create decisions with" % ring)
    print("     `python %s new %s --title \"...\" --by <you> --parents <ids> --decision \"...\" --why \"...\"`." % (tool, ring))
    if prev:
        print("  2. Anything that belongs at ring %s or shallower, or whose ring is unclear, is not yours:" % prev)
        print("     write decisions/inbox/<slug>.md and ask %s." % holder_of(prev, CONFIG))
    else:
        print("  2. You hold the core. Nothing is above you.")
    print("  3. Cite what your work serves: `python %s cite <file> <ID>`. Refer to every decision as ID plus its name." % tool)
    print("  4. Never change a decision made or ratified by a human. Before you finish, run")
    print("     `DTE_RING=%s python %s validate`; it must print OK." % (ring, tool))
    print("  5. Before acting under a node marked unratified and not contested, run `python %s contest <ID>`" % tool)
    print("     and follow it: build the alternatives, scope their cost, judge by the parents, record the verdict.")
    print("     A contested or ratified node is settled: act on it and never re-ask (A7, B28).")
    print("     A node marked imported was re-homed, not decided; its contest is owed before the first new work under it.")
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
        print("Your subtree: `python %s tree --under %s`; read any node with `python %s show <ID>`."
              % (tool, args.under, tool))
    return 0


def spec_skeleton(tree, node):
    """dte:C26, dte:B37"""
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    out = [comment_line(".md", cite_text([node.id])), "", "# Spec: %s" % (node.name or node.id), "",
           "Serves %s %s (ring %s). Filled by an agent that holds a ring; built by an agent that never reads the tree (B42)."
           % (node.id, ("%s: %s" % (node.name, node.title)) if node.name else node.title, node.ring), "",
           "## Purpose", "", _section(node.body, "## Decision").strip() or "TODO", "",
           "## Constraints", ""]
    for p in node.parents:
        pn = tree.nodes.get(p)
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
        c = tree.nodes[i]
        if c.in_effect:
            out.append("- %s %s: %s" % (c.id, c.name or c.title, " ".join(_section(c.body, "## Decision").split())))
    if not desc:
        out.append("- none yet; requirements below are decided here and may become child nodes")
    out += ["", "## Requirements", "", "TODO one numbered requirement per behaviour, each naming the decision it serves.", "",
            "## Out of scope", "", "TODO", "",
            "## Gaps", "",
            "A builder that finds this spec silent stops that part and runs `python %s gap <this file> --title \"...\" --by <name>`; it never improvises." % tool, ""]
    return "\n".join(out)


def cmd_spec(tree, args):
    """dte:C26"""
    node = tree.nodes.get(args.id)
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
    """dte:C27"""
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
    """dte:C27, dte:B42"""
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    rel = tree.rel(os.path.abspath(spec))
    text = read_text(spec).replace("\r\n", "\n")
    ids = sorted({i for line in text.split("\n") for i in cited_ids(line)}, key=id_key)
    print("DTE BUILDER BRIEF: you build to the spec below and to nothing else (B42 builderAutonomy).")
    print()
    print("Rules:")
    print("  1. Build exactly what the spec says. You decide nothing: never run new, contest, place, retire or move,")
    print("     and never read decisions/. Unratified nodes are not your concern; you have no ring.")
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
    """dte:C14"""
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
        fh.write("#!/bin/sh\n# Refuse commits that break the decision tree.  dte:C14\n"
                 "python %s validate || exit 1\n" % tool)
    try:
        os.chmod(path, 0o755)
    except OSError:
        pass
    print("installed .git/hooks/pre-commit: runs `python %s validate` before every commit" % tool)
    return 0


def cmd_reparent(tree, args):
    """dte:B29, dte:B24 (orphans are fixed here, never by hand)"""
    node = tree.nodes.get(args.id)
    if node is None:
        print("unknown id: %s (%s)" % (args.id, tree.retired_hint(args.id)))
        return 2
    parents = split_ids(args.parents)
    if args.id in parents:
        print("a node cannot be its own parent")
        return 2
    err = check_parents(tree, node.ring, parents)
    if err:
        print(err)
        return 2
    for p in parents:
        if not tree.nodes[p].in_effect:
            print("parent %s is %s; pick an in-effect node" % (p, tree.nodes[p].status))
            return 2
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    old = ", ".join(node.parents) or "none"
    text = set_field(text, "parents", fm_ids(parents))
    text = append_history(text, "- %s re-parented from [%s] to [%s] by %s." % (
        datetime.date.today().isoformat(), old, ", ".join(parents), args.by))
    write_text(node.path, text.replace("\n", nl))
    print('re-parented %s "%s": [%s] -> [%s]' % (args.id, node.summary, old, ", ".join(parents)))
    return 0


SETTABLE = ("title", "name", "confidence")       # dte:B29 the fields with no invariant
CONFIDENCES = ("low", "medium", "high")
FIELD_OWNER = {                            # where a refused field is actually changed
    "status": "retire, ratify, or move", "parents": "reparent", "supersedes": "retire --superseded-by",
    "superseded_by": "retire --superseded-by", "conflicts_with": "conflict", "ratified_by": "ratify",
    "authorized_by": "--authorized-by on retire, move, or set", "contested_by": "contest --record",
    "id": "move", "made_by": "nothing: provenance is fixed at creation (A3)",
    "by": "nothing: provenance is fixed at creation (A3)", "date": "nothing: provenance is fixed at creation (A3)",
}


def cmd_set(tree, args):
    """dte:C18, dte:B29, dte:B11 (a change to a human-held node needs a human's name)"""
    node = tree.nodes.get(args.id)
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
        print("%s is %s; set a field on an in-effect node" % (args.id, node.status))
        return 2
    new = " ".join(args.value.split())
    if not new:
        print("the new value is empty")
        return 2
    old = {"title": node.title, "name": node.name}.get(field, node.confidence or "")
    if new == old:
        print("%s already has %s = %s" % (args.id, field, new))
        return 0
    if field == "name" and not NAME_RE.match(new):
        print("a name is a camelCase identifier like shareImpl")
        return 2
    if field == "name" and any(n.name == new and n.in_effect for n in tree.nodes.values()):
        print("name %s is already taken" % new)
        return 2
    if field == "confidence" and new not in CONFIDENCES:
        print("confidence is one of: %s" % ", ".join(CONFIDENCES))
        return 2
    if CONFIG["protect_human"] and node.human_held and not args.authorized_by:
        print("%s is human-held; changing it needs --authorized-by <human>  (B11)" % args.id)
        return 2
    if field == "title" and len(new) > TITLE_MAX:
        print("warning: title is %d characters; B16 asks for under %d" % (len(new), TITLE_MAX))
    text = read_text(node.path)
    nl = "\r\n" if "\r\n" in text else "\n"
    text = text.replace("\r\n", "\n")
    text = set_field(text, field, fm_str(new) if field == "title" else new)
    if field == "name":
        text = set_field(text, "aliases", "[%s]" % new)
    if args.authorized_by:
        text = set_field(text, "authorized_by", args.authorized_by)
    text = append_history(text, '- %s %s changed from "%s" by %s%s.' % (
        datetime.date.today().isoformat(), field, old or "(unset)", args.by,
        (", authorized by " + args.authorized_by) if args.authorized_by else ""))
    write_text(node.path, text.replace("\n", nl))
    print('set %s %s: "%s" -> "%s"' % (args.id, field, old or "(unset)", new))
    return 0


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
    """dte:C17, dte:B28 (one contest per unratified node, then it is settled)"""
    tree.validate()
    node = tree.nodes.get(args.id)
    if node is None:
        print("unknown id: %s (%s)" % (args.id, tree.retired_hint(args.id)))
        return 2
    if not node.in_effect:
        print("%s is %s; only in-effect nodes are contested" % (args.id, node.status))
        return 2
    if node.human_held:
        print("%s is human-held; a human-made or ratified node is settled and is never contested (B28)" % args.id)
        return 2
    if args.record:
        return record_contest(tree, node, args)
    if node.contested_by and not args.again:
        print("%s was already contested by %s; it is settled until a human ratifies it or an agent"
              " supersedes it (B28, A7)" % (args.id, node.contested_by))
        print("  pass --again to run a second contest anyway")
        return 2
    cites = sorted({rel for rel, ln, cid, r in tree.citations if r == node.id})
    kids = tree.children.get(node.id, [])
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    print("CONTEST %s  dte:B28" % node.label())
    print()
    for line in node.body.strip().split("\n"):
        print("  " + line)
    print()
    print("Rubric (the parents): read them, judge by them, never touch them.")
    for p in node.parents:
        print("  " + (tree.nodes[p].label() if p in tree.nodes else "%s (%s)" % (p, tree.retired_hint(p))))
    if not node.parents:
        print("  none: %s is a core node; the rubric is the project's purpose as the owner stated it" % node.id)
    print()
    print("Build each alternative far enough to scope its cost, then judge them against the rubric alone.")
    print("Children of %s (%d) and artifacts citing it (%d) count for nothing: a better node may need none of them."
          % (node.id, len(kids), len(cites)))
    print("Do not reopen parents, siblings, or children in this contest.")
    # dte:B40
    print("A Why that names the incident that forced the node is load-bearing; one that names none is")
    print("preventive judgment and the thinner claim (B40 originInWhy). Weigh it so.")
    print()
    print("  keep      %s as written" % node.id)
    print("  opposite  the decision reversed")
    print("  deletion  no node here; the parents alone must explain what %s explains" % node.id)
    print("  variant   optional: a third way the rubric permits")
    print()
    print("Record the verdict and move on. The node is then settled until a human ratifies it (A7):")
    print("  python %s contest %s --record --chosen <%s> --by <you> --note \"...\" [--file NOTES.md]"
          % (tool, node.id, "|".join(CONTEST_CHOICES)))
    print("If keep did not win: write the winner with `python %s new %s ...`, then"
          " `python %s retire %s --by <you> [--superseded-by NEW]`." % (tool, node.ring, tool, node.id))
    return 0


def record_contest(tree, node, args):
    """dte:C17"""
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
    if args.chosen != "keep" and (args.title or args.retire):   # dte:C22 one step from verdict to tree
        return settle_contest(tree, node, args)
    if args.chosen == "keep":
        print("  %s is settled; act on it without re-asking until a human ratifies or supersedes it (A7, B28)" % node.id)
    elif args.chosen == "deletion":
        print("  next: python %s retire %s --by <you>   then reconcile what `blast %s` listed" % (tool, node.id, node.id))
    else:
        print("  next: python %s new %s --title ... --parents %s   then   python %s retire %s --by <you> --superseded-by NEW"
              % (tool, node.ring, ",".join(node.parents), tool, node.id))
    return 0


def settle_contest(tree, node, args):
    """Write the winner (opposite or variant, from --title and a body) at the same ring with the
    same parents, then retire the loser superseded by it; or revert it for deletion.  dte:C22"""
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
        fields = [("id", new_id)]
        if args.name:
            if not NAME_RE.match(args.name):
                print("a name is a camelCase identifier like shareImpl")
                return 2
            fields.append(("name", args.name))
        fields += [("title", fm_str(args.title)), ("status", "active"), ("parents", list(node.parents)),
                   ("supersedes", []), ("superseded_by", ""), ("conflicts_with", []),
                   ("made_by", "ai"), ("by", args.by), ("date", datetime.date.today().isoformat()),
                   ("ratified_by", ""), ("contested_by", args.by)]
        if args.name:
            fields.append(("aliases", "[%s]" % args.name))
        text = build_frontmatter(fields) + body
        text = append_history(text, "- %s created as the %s that won the contest of %s; by %s."
                              % (datetime.date.today().isoformat(), args.chosen, node.id, args.by))
        dest = os.path.join(tree.decisions_dir, node.ring, new_id + ".md")
        write_text(dest, text)
        print('created %s "%s" at %s' % (new_id, args.title, tree.rel(dest)))
    fresh = Tree(tree.root, tree.decisions_dir)
    ns = argparse.Namespace(id=node.id, superseded_by=new_id, by=args.by, authorized_by=args.authorized_by)
    return cmd_retire(fresh, ns)


def cmd_conflict(tree, args):
    """dte:B29, dte:B4"""
    a, b = args.a, args.b
    if a == b:
        print("a node cannot contradict itself")
        return 2
    for x in (a, b):
        if x not in tree.nodes:
            print("unknown id: %s (%s)" % (x, tree.retired_hint(x)))
            return 2
        if not tree.nodes[x].in_effect:
            print("%s is %s" % (x, tree.nodes[x].status))
            return 2
    for x, y in ((a, b), (b, a)):
        n = tree.nodes[x]
        if y not in n.conflicts_with:
            text = read_text(n.path)
            nl = "\r\n" if "\r\n" in text else "\n"
            text = text.replace("\r\n", "\n")
            text = set_field(text, "conflicts_with", fm_ids(n.conflicts_with + [y]))
            write_text(n.path, text.replace("\n", nl))
    na, nb = tree.nodes[a], tree.nodes[b]
    print("declared: %s  vs  %s" % (na.label(), nb.label()))
    if ring_depth(na.ring) < ring_depth(nb.ring):
        print("  %s wins (ring %s over %s)" % (a, na.ring, nb.ring))
    elif ring_depth(na.ring) > ring_depth(nb.ring):
        print("  %s wins (ring %s over %s)" % (b, nb.ring, na.ring))
    else:
        print("  SAME RING: validate will fail until one is superseded or moved (B4)")
    return 0


def cmd_retired(tree, args):
    """dte:B29, dte:C11"""
    if not tree.retired:
        print("Ledger empty. Nothing has been retired.")
        return 0
    for i, row in sorted(tree.retired.items(), key=lambda kv: id_key(kv[0])):
        fate = row["action"] + ((" -> " + row["successor"]) if row["successor"] else "")
        auth = ("  authorized by " + row["authorized_by"]) if row["authorized_by"] else ""
        print('%-5s %s  %-18s by %s%s  "%s"' % (i, row["date"], fate, row["by"], auth, row["title"]))
    return 0


def cmd_export(tree, args):
    """dte:C12"""
    tree.validate()
    nodes = []
    for n in tree.ordered_nodes():
        d = {k: v for k, v in n.raw.items()}
        d["ring"] = n.ring
        d["path"] = tree.rel(n.path)
        nodes.append(d)
    data = {
        "nodes": nodes,
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
        print("wrote %s: %d nodes, %d citations, %d retired, %d inbox"
              % (args.out, len(nodes), len(data["citations"]), len(data["retired"]), len(data["inbox"])))
    else:
        print(text)
    return 0


VENDOR_FILES = ("CLAUDE.md", "SPEC.md", "ADOPTING.md", "README.md")
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
    """One markdown file of a tree's in-effect nodes, by ring, for readers who must know
    the decisions without hosting them as nodes.  dte:B39"""
    out = ["# DTE decisions", "",
           "Every in-effect decision of DTE itself, rendered. These are DTE's, not this",
           "project's: read them, cite nothing here, and never re-create them as nodes.", ""]
    cur = None
    for n in src_tree.ordered_nodes():
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


def cmd_vendor(tree, args):
    """dte:C25, dte:B39"""
    src = os.path.abspath(args.src)
    src_dec = os.path.join(src, "decisions")
    missing = [f for f in VENDOR_FILES if not os.path.isfile(os.path.join(src, f))]
    if missing or not os.path.isdir(src_dec):
        print("not a DTE checkout: %s (missing %s)" % (src, ", ".join(missing + ([] if os.path.isdir(src_dec) else ["decisions/"]))))
        return 2
    dest = os.path.join(tree.root, args.dir)
    os.makedirs(dest, exist_ok=True)
    tool = os.path.relpath(os.path.abspath(__file__), tree.root).replace(os.sep, "/")
    # no source path in the stamp: an absolute path would carry the user's home directory into the adopter's repo
    stamp = "<!-- vendored from DTE %s on %s. Do not edit; refresh with: python %s vendor --from <your DTE checkout> -->\n\n" % (
        _source_commit(src), datetime.date.today().isoformat(), tool)
    written = []
    for f in VENDOR_FILES:
        write_text(os.path.join(dest, f), stamp + read_text(os.path.join(src, f)))
        written.append(f)
    src_tree = Tree(src, src_dec)
    write_text(os.path.join(dest, "DECISIONS.md"), stamp + render_decisions(src_tree))
    written.append("DECISIONS.md")
    rel_dest = args.dir.replace(os.sep, "/").rstrip("/")
    print("vendored into %s/: %s" % (rel_dest, ", ".join(written)))
    src_tool = os.path.join(src, "tools", "dte.py")
    me = os.path.abspath(__file__)
    if os.path.isfile(src_tool) and os.path.abspath(src_tool) != me:
        if read_text(src_tool) != read_text(me):
            write_text(me, read_text(src_tool))
            print("refreshed %s from the source" % tool)
        else:
            print("%s already matches the source" % tool)
    ign = os.path.join(tree.root, ".dteignore")
    entry = rel_dest + "/*"
    existing = read_text(ign) if os.path.isfile(ign) else ""
    if entry not in existing.replace("\r\n", "\n").split("\n"):
        head = existing if existing else IGNORE_TEMPLATE
        write_text(ign, head.rstrip("\n") + "\n# Vendored DTE rule text: its citations are DTE's tree, not this one.\n%s\n" % entry)
        print("added %s to .dteignore" % entry)
    print("next: have your agent harness load %s/CLAUDE.md, SPEC.md, ADOPTING.md and DECISIONS.md at session start" % rel_dest)
    return 0


def cmd_init(tree, args):
    """dte:C13"""
    root = os.path.abspath(args.root)
    made, kept = [], []
    me = os.path.basename(__file__)
    ignore = IGNORE_TEMPLATE + "# The dte tool itself: its dte: tokens belong to DTE's own tree, not this one.\n%s\n" % me
    for rel, content in (("dte.cfg", CFG_TEMPLATE), (".dteignore", ignore)):
        p = os.path.join(root, rel)
        if os.path.exists(p):
            kept.append(rel)
        else:
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(content)
            made.append(rel)
    inbox = os.path.join(root, "decisions", INBOX_DIR)
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
    print("  1. write the core: dte new A --title \"<goal>\" --by <owner> --made-by human   (three to six of these)")
    print("  2. edit dte.cfg: authority map, docs globs, retire mode")
    print("  3. dte vendor --from <path to a DTE checkout>: copies DTE's rule text and a render of its")
    print("     decisions into vendor/dte/, ignored by the scanner; have your agent harness load them at session start")
    print("  4. dte validate, then dte coverage: that number is the adoption gauge")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="dte", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".")
    ap.add_argument("--decisions", default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("--full", action="store_true", help="list every unratified node instead of the count (C23)")
    v.add_argument("--as", dest="as_ring", default=os.environ.get("DTE_RING") or None, metavar="RING",
                   help="check changed nodes against an agent's ring (B15); default $DTE_RING")
    t = sub.add_parser("tree")
    t.add_argument("--files", action="store_true", help="show citing artifacts under each node")
    t.add_argument("--under", default=None, metavar="ID", help="print only the subtree under ID")
    sub.add_parser("blast").add_argument("id")
    sub.add_parser("trace").add_argument("path")
    sub.add_parser("conflicts")
    sub.add_parser("coverage")
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
                   help="human authorising the move of a human-held node")
    r = sub.add_parser("retire")
    r.add_argument("id")
    r.add_argument("--by", required=True, help="who is retiring it")
    r.add_argument("--superseded-by", dest="superseded_by", default=None, help="successor id")
    r.add_argument("--authorized-by", dest="authorized_by", default=None,
                   help="human authorising the retirement of a human-held node")
    a = sub.add_parser("authority")
    a.add_argument("ring", nargs="?", default=None)
    n = sub.add_parser("new")
    n.add_argument("ring")
    n.add_argument("--title", required=True)
    n.add_argument("--name", default=None, help="readable camelCase handle, unique; becomes the Obsidian alias")
    n.add_argument("--body-file", dest="body_file", default=None,
                   help="markdown file whose sections become the body verbatim (C20); beats --decision/--why")
    n.add_argument("--by", required=True)
    n.add_argument("--parents", default=None, help="comma-separated parent ids")
    n.add_argument("--made-by", dest="made_by", default="ai", help="ai | human | joint")
    n.add_argument("--status", default="active", help="active | proposed")
    n.add_argument("--confidence", default=None, help="low | medium | high")
    n.add_argument("--decision", default=None, help="text of the Decision section")
    n.add_argument("--why", default=None, help="text of the Why section")
    n.add_argument("--consequences", default=None, help="text of the Consequences section")
    n.add_argument("--authorized-by", dest="authorized_by", default=None,
                   help="human authorising an agent to write this node above its ring")
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
    st = sub.add_parser("set")
    st.add_argument("id")
    st.add_argument("field", help="one of: %s (B29); the body is edited by hand" % ", ".join(SETTABLE))
    st.add_argument("value")
    st.add_argument("--by", required=True)
    st.add_argument("--authorized-by", dest="authorized_by", default=None,
                    help="the human authorising a change to a human-held node (B11)")
    ct = sub.add_parser("contest")
    ct.add_argument("id")
    ct.add_argument("--record", action="store_true", help="write the verdict instead of printing the brief")
    ct.add_argument("--chosen", choices=CONTEST_CHOICES, default=None)
    ct.add_argument("--by", default=None, help="who judged")
    ct.add_argument("--note", default=None, help="the alternatives, their scoped costs, and the verdict")
    ct.add_argument("--file", default=None, help="markdown file holding the same, appended before --note")
    ct.add_argument("--again", action="store_true", help="contest a node that was already contested")
    ct.add_argument("--title", default=None, help="with --record and a non-keep verdict: write the winner with this title (C22)")
    ct.add_argument("--name", default=None, help="the winner's camelCase name")
    ct.add_argument("--body-file", dest="body_file", default=None, help="the winner's body; or use --decision/--why")
    ct.add_argument("--decision", default=None)
    ct.add_argument("--why", default=None)
    ct.add_argument("--consequences", default=None)
    ct.add_argument("--retire", action="store_true", help="with --chosen deletion: revert the node now")
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
    br.add_argument("--under", default=None, metavar="ID", help="restrict binding nodes to one subtree")
    br.add_argument("--builder", default=None, metavar="SPEC", help="brief an agent that builds to this spec and holds no ring (C27)")
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
    decisions = args.decisions or os.path.join(args.root, "decisions")
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
    }[args.cmd](tree, args)


if __name__ == "__main__":
    # Windows consoles default to cp1252; a node body with an arrow must not crash show.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())
