#!/usr/bin/env python3
"""Writes the test workbooks in fixtures/xlsx/ (tree/specs/computation/live-connections.md § Excel workbooks).

Hand-built XML, so each case is exactly what the reader is held to: an answer Excel saved, a formula it never
calculated, a computed blank, an error cell, a stray in a typed column. Run: python3 scripts/xlsx-fixtures.py
"""
import os
import zipfile

OUT = os.path.join(os.path.dirname(__file__), "..", "fixtures", "xlsx")
NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' \
     'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def cell(ref, v):
    """A cell from a Python value: str is inline text, bool, int/float a number, ('date', serial) date-styled,
    ('f', formula, saved) a formula with a saved answer (None: never calculated), ('err', '#DIV/0!')."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return f'<c r="{ref}" t="b"><v>{int(v)}</v></c>'
    if isinstance(v, (int, float)):
        return f'<c r="{ref}"><v>{v}</v></c>'
    if isinstance(v, str):
        return f'<c r="{ref}" t="inlineStr"><is><t>{esc(v)}</t></is></c>'
    kind = v[0]
    if kind == "date":
        return f'<c r="{ref}" s="1"><v>{v[1]}</v></c>'
    if kind == "err":
        return f'<c r="{ref}" t="e"><v>{esc(v[1])}</v></c>'
    if kind == "f":
        f, saved = v[1], v[2]
        if saved is None:
            return f'<c r="{ref}"><f>{esc(f)}</f></c>'
        if isinstance(saved, str):
            return f'<c r="{ref}" t="str"><f>{esc(f)}</f><v>{esc(saved)}</v></c>'
        return f'<c r="{ref}"><f>{esc(f)}</f><v>{saved}</v></c>'
    if kind == "shared":  # ('shared', si, formula or None for a child, ref range or None)
        _, si, f, rng = v
        if f is None:
            return f'<c r="{ref}"><f t="shared" si="{si}"/></c>'
        return f'<c r="{ref}"><f t="shared" ref="{rng}" si="{si}">{esc(f)}</f></c>'
    raise ValueError(v)


def col_letter(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def sheet_xml(rows, n_tables, first_table_rel):
    body = []
    for r, cells in rows:
        # A dict places its cells by column letter, for a row that doesn't start at A.
        at = cells.items() if isinstance(cells, dict) else ((col_letter(c), v) for c, v in enumerate(cells))
        xs = "".join(cell(f"{c}{r}", v) for c, v in at)
        body.append(f'<row r="{r}">{xs}</row>')
    parts = ""
    if n_tables:
        parts = f'<tableParts count="{n_tables}">' + "".join(
            f'<tablePart r:id="rId{first_table_rel + k}"/>' for k in range(n_tables)) + "</tableParts>"
    return f'<?xml version="1.0" encoding="UTF-8"?><worksheet {NS}><sheetData>{"".join(body)}</sheetData>{parts}</worksheet>'


def table_xml(tid, name, ref, columns, attrs=""):
    """attrs: extra attributes on the table element, such as ' totalsRowCount="1"'."""
    cols = "".join(f'<tableColumn id="{k + 1}" name="{esc(c)}"/>' for k, c in enumerate(columns))
    return (f'<?xml version="1.0" encoding="UTF-8"?><table {NS.split(" ")[0]} id="{tid}" name="{name}" '
            f'displayName="{name}" ref="{ref}"{attrs}><autoFilter ref="{ref}"/>'
            f'<tableColumns count="{len(columns)}">{cols}</tableColumns></table>')


STYLES = ('<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
          '<fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders>'
          '<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/>'
          '<xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>')


def workbook(path, sheets, date1904=False):
    """sheets: [(name, rows, [(table name, ref, columns) or (table name, ref, columns, table attributes)])]."""
    z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    # A fixed time on every entry, so a rerun writes the same bytes.
    plain_writestr = z.writestr
    z.writestr = lambda name, data: plain_writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
    overrides = ['<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
                 '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
    wb_sheets, wb_rels = [], []
    table_no = 0
    for k, (name, rows, tables) in enumerate(sheets, 1):
        overrides.append(f'<Override PartName="/xl/worksheets/sheet{k}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        wb_sheets.append(f'<sheet name="{esc(name)}" sheetId="{k}" r:id="rId{k}"/>')
        wb_rels.append(f'<Relationship Id="rId{k}" Type="{REL}/worksheet" Target="worksheets/sheet{k}.xml"/>')
        z.writestr(f"xl/worksheets/sheet{k}.xml", sheet_xml(rows, len(tables), 1))
        rels = []
        for j, (tname, ref, columns, *attrs) in enumerate(tables):
            table_no += 1
            overrides.append(f'<Override PartName="/xl/tables/table{table_no}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>')
            rels.append(f'<Relationship Id="rId{j + 1}" Type="{REL}/table" Target="../tables/table{table_no}.xml"/>')
            z.writestr(f"xl/tables/table{table_no}.xml", table_xml(table_no, tname, ref, columns, *attrs))
        if rels:
            z.writestr(f"xl/worksheets/_rels/sheet{k}.xml.rels",
                       f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG}">{"".join(rels)}</Relationships>')
    n = len(sheets)
    wb_rels.append(f'<Relationship Id="rId{n + 1}" Type="{REL}/styles" Target="styles.xml"/>')
    z.writestr("[Content_Types].xml",
               '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
               '<Default Extension="xml" ContentType="application/xml"/>' + "".join(overrides) + "</Types>")
    z.writestr("_rels/.rels", f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    pr = '<workbookPr date1904="1"/>' if date1904 else ""
    z.writestr("xl/workbook.xml", f'<?xml version="1.0" encoding="UTF-8"?><workbook {NS}>{pr}<sheets>{"".join(wb_sheets)}</sheets></workbook>')
    z.writestr("xl/_rels/workbook.xml.rels", f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG}">{"".join(wb_rels)}</Relationships>')
    z.writestr("xl/styles.xml", STYLES)
    z.close()


os.makedirs(OUT, exist_ok=True)

# A Table under a title, with every kind of cell the reader sorts, and a second Table on its own sheet.
SALES = ["region", "amount", "when", "paid", "code", "calc"]
workbook(os.path.join(OUT, "sales.xlsx"), [
    ("Report", [
        (1, ["Quarterly sales (title row, not data)"]),
        (3, SALES),
        (4, ["East", 100, ("date", 46037), True, "02134", ("f", "B4*2", 200)]),
        (5, ["West", 250.5, ("date", 46038), False, "00017", ("f", '""', "")]),
        (6, ["East", "n/a", ("date", 46039), True, "10001", ("f", "B6*2", None)]),
        (7, ["North", 75, None, False, "20002", ("err", "#DIV/0!")]),
        (8, ["South", 12, ("date", 46040), True, "30003", ("shared", 0, "B8+1", "F8:F9")]),
        (9, ["West", 40, ("date", 46041), None, "40004", ("shared", 0, None, None)]),
        (10, ["East", 8, ("date", 46042), True, "50005", ("f", "B10", 8)]),
        (11, ["East", 9, ("date", 46043), False, "60006", ("f", "B11", 9)]),
        (12, ["West", 10, ("date", 46044), True, "70007", ("f", "B12", 10)]),
        (13, ["West", "eleven", ("date", 46045), True, "80008", ("f", "B13", 11)]),
        (14, ["West", 12, ("date", 46046), True, "90009", ("f", "B14", 12)]),
    ], [("Sales", "A3:F14", SALES)]),
    ("Lookup", [
        (1, ["region", "manager"]),
        (2, ["East", "Ann"]),
        (3, ["West", "Bo"]),
    ], [("Regions", "A1:B3", ["region", "manager"])]),
])

# A stray among numbers past one in ten: the column reads as text.
workbook(os.path.join(OUT, "mixed.xlsx"), [
    ("Sheet1", [
        (1, ["value"]),
        (2, [1]), (3, ["two"]), (4, [3]), (5, ["four"]),
    ], [("Mixed", "A1:A5", ["value"])]),
])

# The 1904 date system: day 0 is 01-Jan-1904.
workbook(os.path.join(OUT, "dates1904.xlsx"), [
    ("Sheet1", [(1, ["day"]), (2, [("date", 0)]), (3, [("date", 1)])], [("Days", "A1:A3", ["day"])]),
], date1904=True)

# Tables at their edges, on a sheet with one stray cell in its last row and column (a dense read of that sheet would
# hold 17 billion cells): a small Table beside it, one with a totals row, one with a totals row and no header row, and
# one that is a header row alone.
workbook(os.path.join(OUT, "edges.xlsx"), [
    ("Edges", [
        (1, {"A": "k", "B": "v", "D": "item", "E": "cost", "G": "p", "H": 1, "J": "a", "K": "b"}),
        (2, {"A": 1, "B": "one", "D": "x", "E": 10, "G": "q", "H": 2}),
        (3, {"A": 2, "B": "two", "D": "y", "E": 20, "G": "Total", "H": 3}),
        (4, {"D": "Total", "E": ("f", "SUM(E2:E3)", 30)}),
        (1048576, {"XFD": 9}),
    ], [
        ("Small", "A1:B3", ["k", "v"]),
        ("Totals", "D1:E4", ["item", "cost"], ' totalsRowCount="1"'),
        ("NoHeader", "G1:H3", ["Column1", "Column2"], ' headerRowCount="0" totalsRowCount="1"'),
        ("HeaderOnly", "J1:K1", ["a", "b"]),
    ]),
])

# No Tables at all.
workbook(os.path.join(OUT, "no-tables.xlsx"), [("Sheet1", [(1, ["a", "b"]), (2, [1, 2])], [])])

print("wrote", sorted(os.listdir(OUT)))

# The demo vault's sample workbook (demo-vault/Data/): each rep's quarterly target, a saved formula for the stretch
# goal, and a second Table on its own sheet, so the Table pick has a choice to show.
DEMO = os.path.join(os.path.dirname(__file__), "..", "demo-vault", "Data", "sales-targets.xlsx")
REPS = ["John McCarthy", "Mary Jackson", "Tim Berners-Lee", "Claude Shannon"]
TARGETS = ["Rep", "Quarter", "Target", "Stretch", "Set on", "Signed off"]
rows = [(1, ["Sales targets, 2026 (set by the regional leads)"]), (3, TARGETS)]
r = 4
for q, (quarter, set_on) in enumerate([("Q1", 46020), ("Q2", 46111), ("Q3", 46203), ("Q4", 46295)]):
    for k, rep in enumerate(REPS):
        target = 1200 + 150 * k + 200 * q
        rows.append((r, [rep, quarter, target, ("f", f"C{r}*1.15", round(target * 1.15, 2)), ("date", set_on), q < 3]))
        r += 1
workbook(DEMO, [
    ("Targets", rows, [("Targets", f"A3:F{r - 1}", TARGETS)]),
    ("Reps", [
        (1, ["Rep", "Territory", "Started"]),
        (2, ["John McCarthy", "West", ("date", 44410)]),
        (3, ["Mary Jackson", "East", ("date", 44929)]),
        (4, ["Tim Berners-Lee", "North", ("date", 45302)]),
        (5, ["Claude Shannon", "South", ("date", 45667)]),
    ], [("Reps", "A1:C5", ["Rep", "Territory", "Started"])]),
])
print("wrote", os.path.relpath(DEMO))
