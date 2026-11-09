#!/usr/bin/env python3
"""Stops an agent creating a decision-tree leaf on its own say-so.

A leaf is a product decision the author holds, never a description of how something works (CLAUDE.md, the Docs map).
`dte.py new` runs only when the command names the person who authorized it (`--authorized-by`), which an agent can
only write truthfully after asking the author in chat. Mechanics go in a spec; a feature that applies an existing
leaf cites that leaf.
"""
import json
import re
import sys

command = (json.load(sys.stdin).get("tool_input") or {}).get("command") or ""
creates = re.search(r"dte\.py\s+new\b", command)
if creates and "--authorized-by" not in command:
    sys.stderr.write(
        "Blocked: `dte.py new` creates a decision-tree leaf, and a leaf is a product decision, not a description of "
        "a system. Name the call and its opposite. If it only says what the code does, write it in the spec. If it "
        "only applies an existing leaf, cite that leaf. If it is a real new product call, ask the author in chat, "
        "and once they agree, rerun with --authorized-by \"<their name>\".\n"
    )
    sys.exit(2)
