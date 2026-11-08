#!/usr/bin/env python3
"""RAG local do blog.

Fonte de verdade: notas Markdown em knowledge/notes/ (versionáveis, abrem no Obsidian).
Índice derivado: SQLite FTS5 (BM25) em knowledge/index/rag.sqlite — pode ser apagado e reconstruído.

Comandos:
  python tools/rag/rag.py import-html          # converte HTMLs de inbox/_raw/ em notas (via knowledge/sources.json)
  python tools/rag/rag.py build                # (re)constrói o índice a partir das notas
  python tools/rag/rag.py search "consulta"    # busca; --validated para só notas validadas por você
  python tools/rag/rag.py stats
"""
import argparse
import json
import re
import sqlite3
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NOTES = ROOT / "knowledge" / "notes"
DB = ROOT / "knowledge" / "index" / "rag.sqlite"
SOURCES = ROOT / "knowledge" / "sources.json"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


# ---------- HTML -> Markdown (stdlib, sem dependências) ----------
class HtmlToMd(HTMLParser):
    SKIP = {"style", "script", "svg", "head", "title"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.buf = [], []
        self.skip = 0
        self.heading = None
        self.lists = []
        self.prefix = ""
        self.table = None
        self.row = None
        self.cell = None

    def _flush(self, prefix=""):
        text = " ".join("".join(self.buf).split())
        self.buf = []
        if text:
            self.out.append((prefix or self.prefix) + text)
            self.out.append("")
        self.prefix = ""

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if tag in ("h1", "h2", "h3", "h4"):
            self._flush()
            self.heading = int(tag[1])
        elif tag in ("p", "div", "section", "main", "figcaption", "blockquote"):
            self._flush()
        elif tag in ("ul", "ol"):
            self._flush()
            self.lists.append([tag, 0])
        elif tag == "li":
            self._flush()
            if self.lists:
                self.lists[-1][1] += 1
                kind, n = self.lists[-1]
                self.prefix = "  " * (len(self.lists) - 1) + ("- " if kind == "ul" else f"{n}. ")
        elif tag == "table":
            self._flush()
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = []
        elif tag in ("b", "strong"):
            self._emit("**")
        elif tag in ("i", "em"):
            self._emit("*")
        elif tag == "code":
            self._emit("`")
        elif tag == "br":
            self._emit(" ")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag in ("h1", "h2", "h3", "h4"):
            self._flush("#" * (self.heading or 2) + " ")
            self.heading = None
        elif tag in ("p", "div", "section", "main", "figcaption", "blockquote", "li"):
            self._flush()
        elif tag in ("ul", "ol"):
            self._flush()
            if self.lists:
                self.lists.pop()
        elif tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join("".join(self.cell).split()).replace("|", "\\|"))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row:
                self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self._emit_table()
            self.table = None
        elif tag in ("b", "strong"):
            self._emit("**")
        elif tag in ("i", "em"):
            self._emit("*")
        elif tag == "code":
            self._emit("`")

    def handle_data(self, data):
        if not self.skip:
            self._emit(data)

    def _emit(self, s):
        (self.cell if self.cell is not None else self.buf).append(s)

    def _emit_table(self):
        if not self.table:
            return
        width = max(len(r) for r in self.table)
        rows = [r + [""] * (width - len(r)) for r in self.table]
        self.out.append("| " + " | ".join(rows[0]) + " |")
        self.out.append("| " + " | ".join(["---"] * width) + " |")
        for r in rows[1:]:
            self.out.append("| " + " | ".join(r) + " |")
        self.out.append("")


def html_to_md(html):
    p = HtmlToMd()
    p.feed(html)
    p._flush()
    return re.sub(r"\n{3,}", "\n\n", "\n".join(p.out)).strip() + "\n"


def frontmatter(meta):
    lines = ["---"]
    for k, v in meta.items():
        if isinstance(v, bool):
            v = str(v).lower()
        elif isinstance(v, list):
            v = "[" + ", ".join(v) + "]"
        elif isinstance(v, str) and re.search(r"[:#]", v):
            v = '"' + v.replace('"', "'") + '"'
        lines.append(f"{k}: {v}")
    lines.append("---\n")
    return "\n".join(lines)


def cmd_import_html(_args):
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    NOTES.mkdir(parents=True, exist_ok=True)
    for s in sources:
        raw = s.get("raw")
        if not raw:
            continue
        html = (ROOT / raw).read_text(encoding="utf-8")
        meta = {
            "id": s["slug"],
            "title": s["title"],
            "source_url": s["url"],
            "kind": s["kind"],
            "evidence": s["evidence"],
            "validated_by_author": bool(s.get("validated", False)),
            "publishable": False,
            "fidelity": "lossless-html",
            "date": s["date"],
            "tags": s["tags"],
        }
        (NOTES / f"{s['slug']}.md").write_text(
            frontmatter(meta) + f"# {s['title']}\n\n" + html_to_md(html), encoding="utf-8"
        )
        print("nota criada:", s["slug"])


# ---------- Índice SQLite FTS5 ----------
def parse_note(path):
    text = path.read_text(encoding="utf-8")
    meta, body = {}, text
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if m:
        body = m.group(2)
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                v = v.strip().strip('"')
                if v.startswith("[") and v.endswith("]"):
                    v = [x.strip() for x in v[1:-1].split(",") if x.strip()]
                elif v in ("true", "false"):
                    v = v == "true"
                meta[k.strip()] = v
    return meta, body


def split_long(text, limit=1500):
    units = []
    for u in text.split("\n\n"):
        units.extend(u.splitlines() if len(u) > limit else [u])
    pieces, cur = [], ""
    for u in units:
        if cur and len(cur) + len(u) > limit:
            pieces.append(cur.strip())
            cur = ""
        cur += u + "\n"
    if cur.strip():
        pieces.append(cur.strip())
    return pieces


def chunk(body):
    out, head, buf = [], "", []
    for line in body.splitlines():
        m = re.match(r"^(#{1,3})\s+(.*)", line)
        if m:
            t = "\n".join(buf).strip()
            if t:
                out.extend((head, p) for p in split_long(t))
            head, buf = m.group(2).strip(), []
        else:
            buf.append(line)
    t = "\n".join(buf).strip()
    if t:
        out.extend((head, p) for p in split_long(t))
    return out


def cmd_build(_args):
    DB.parent.mkdir(parents=True, exist_ok=True)
    DB.unlink(missing_ok=True)
    con = sqlite3.connect(DB)
    con.executescript(
        """
        CREATE TABLE docs(id TEXT PRIMARY KEY, title TEXT, source_url TEXT, kind TEXT,
                          evidence TEXT, validated INTEGER, publishable INTEGER, fidelity TEXT,
                          date TEXT, tags TEXT, path TEXT);
        CREATE TABLE chunks(id INTEGER PRIMARY KEY, doc_id TEXT, heading TEXT, text TEXT);
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
            heading, text, content='chunks', content_rowid='id',
            tokenize='unicode61 remove_diacritics 2');
        """
    )
    n_docs = n_chunks = 0
    for path in sorted(list(NOTES.glob("*.md")) + [f for f in ROOT.glob("studies/*/fontes/*.md") if not f.name.startswith("_")]):
        meta, body = parse_note(path)
        doc_id = meta.get("id", path.stem)
        con.execute(
            "INSERT INTO docs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (doc_id, meta.get("title", path.stem), meta.get("source_url", ""), meta.get("kind", ""),
             meta.get("evidence", ""), int(bool(meta.get("validated_by_author") or meta.get("verificada"))),
             int(bool(meta.get("publishable"))), meta.get("fidelity", ""), str(meta.get("date", "")),
             ",".join(meta.get("tags", [])), str(path.relative_to(ROOT))),
        )
        n_docs += 1
        for head, text in chunk(body):
            cur = con.execute("INSERT INTO chunks(doc_id, heading, text) VALUES (?,?,?)", (doc_id, head, text))
            con.execute("INSERT INTO chunks_fts(rowid, heading, text) VALUES (?,?,?)", (cur.lastrowid, head, text))
            n_chunks += 1
    con.commit()
    con.close()
    print(f"índice reconstruído: {n_docs} notas, {n_chunks} trechos -> {DB.relative_to(ROOT)}")


def cmd_search(args):
    if not DB.exists():
        sys.exit("índice não existe; rode: python tools/rag/rag.py build")
    stop = {"de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "com", "para", "por", "que",
            "um", "uma", "os", "as", "ao", "ou", "se", "como", "mais", "foi", "the", "and", "of", "to"}
    toks = [t for t in re.findall(r"\w{2,}", args.query.lower()) if t not in stop]
    if not toks:
        sys.exit("consulta vazia")
    q = " OR ".join(f'"{t}"' for t in toks)
    sql = """
        SELECT d.title, d.source_url, d.validated, d.evidence, d.fidelity, c.heading,
               snippet(chunks_fts, 1, '[', ']', ' … ', 28)
        FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN docs d ON d.id = c.doc_id
        WHERE chunks_fts MATCH ? {extra} ORDER BY bm25(chunks_fts, 4.0, 1.0) LIMIT ?
    """.format(extra="AND d.validated = 1" if args.validated else "")
    con = sqlite3.connect(DB)
    rows = con.execute(sql, (q, args.n)).fetchall()
    if not rows:
        print("nada encontrado" + (" (entre as notas validadas)" if args.validated else ""))
    for i, (title, url, val, ev, fid, head, snip) in enumerate(rows, 1):
        flag = "validada por você" if val else "NÃO validada"
        print(f"{i}. {title}  [{flag} · {ev} · {fid}]\n   seção: {head or '(topo)'}\n   {snip}\n   fonte: {url}\n")


def cmd_stats(_args):
    if not DB.exists():
        sys.exit("índice não existe")
    con = sqlite3.connect(DB)
    d, v, c = (con.execute(q).fetchone()[0] for q in (
        "SELECT COUNT(*) FROM docs", "SELECT COUNT(*) FROM docs WHERE validated=1", "SELECT COUNT(*) FROM chunks"))
    print(f"notas: {d} (validadas por você: {v}) · trechos: {c}")
    for row in con.execute("SELECT id, validated, publishable, fidelity FROM docs ORDER BY id"):
        print(f"  - {row[0]}  validada={bool(row[1])} publicável={bool(row[2])} fidelidade={row[3]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("import-html").set_defaults(fn=cmd_import_html)
    sub.add_parser("build").set_defaults(fn=cmd_build)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("-n", type=int, default=5)
    s.add_argument("--validated", action="store_true")
    s.set_defaults(fn=cmd_search)
    sub.add_parser("stats").set_defaults(fn=cmd_stats)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
