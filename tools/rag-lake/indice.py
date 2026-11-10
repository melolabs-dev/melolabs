#!/usr/bin/env python3
"""Índice do mini data lake do estudo 2: BM25 (SQLite FTS5) e vetorial (embeddings locais).

Uso:
  python tools/rag-lake/indice.py build            constrói lake/indice/lake.sqlite
  python tools/rag-lake/indice.py recall [--k 3 5 10 15]   recall@k por método com os documentos-ouro do gabarito

Parâmetros fixos do piloto (entram no pré-registro depois de confirmados):
  chunk de até 600 caracteres, sobreposição de 100, quebra por linha ou parágrafo; embedding
  sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 (fastembed, ONNX, local).
Consulta de recuperação = só o texto da pergunta (as opções não entram).
"""
import argparse, json, re, sqlite3, sys
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[2]
E2 = RAIZ / "studies" / "rag-data-lake-haiku"
LAKE = E2 / "lake"
DB = LAKE / "indice" / "lake.sqlite"
MODELO = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
CACHE = str(Path.home() / ".cache" / "fastembed")
CHUNK, SOBRE = 600, 100


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def dividir(texto):
    """Chunks gulosos por linha, até CHUNK caracteres, com sobreposição de SOBRE caracteres."""
    partes, atual = [], ""
    for linha in texto.replace("\r\n", "\n").split("\n"):
        while len(linha) > CHUNK:  # linha longa: corte duro
            if atual:
                partes.append(atual)
                atual = ""
            partes.append(linha[:CHUNK])
            linha = linha[CHUNK - SOBRE:]
        if len(atual) + len(linha) + 1 > CHUNK and atual:
            partes.append(atual)
            atual = atual[-SOBRE:] + "\n" + linha if SOBRE else linha
        else:
            atual = (atual + "\n" + linha) if atual else linha
    if atual.strip():
        partes.append(atual)
    return [p.strip() for p in partes if len(p.strip()) >= 40]


def modelo():
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=MODELO, cache_dir=CACHE)


def embed(m, textos):
    v = np.array(list(m.embed(textos, batch_size=64)), dtype="float32")
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)


def build():
    man = json.load(open(LAKE / "manifesto-bruto.json", encoding="utf-8"))
    DB.parent.mkdir(parents=True, exist_ok=True)
    if DB.exists():
        DB.unlink()
    con = sqlite3.connect(DB)
    con.executescript("""
      CREATE TABLE chunks(id INTEGER PRIMARY KEY, doc_id TEXT, path TEXT, tipo TEXT, ord INTEGER, texto TEXT, emb BLOB);
      CREATE VIRTUAL TABLE fts USING fts5(texto, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    """)
    linhas = []
    for it in man["itens"]:
        t = (LAKE / "bruto" / it["path"]).read_text(encoding="utf-8")
        for i, c in enumerate(dividir(t)):
            linhas.append((it["id"], it["path"], it["tipo"], i, c))
    m = modelo()
    emb = embed(m, [l[4] for l in linhas])
    for n, (l, e) in enumerate(zip(linhas, emb), 1):
        con.execute("INSERT INTO chunks VALUES(?,?,?,?,?,?,?)", (n, *l, e.tobytes()))
    con.execute("INSERT INTO fts(rowid, texto) SELECT id, texto FROM chunks")
    con.commit()
    print("chunks:", len(linhas), "em", DB)


class Indice:
    def __init__(self):
        self.con = sqlite3.connect(DB)
        rows = self.con.execute("SELECT id, doc_id, path, tipo, texto, emb FROM chunks ORDER BY id").fetchall()
        self.meta = [(r[0], r[1], r[2], r[3], r[4]) for r in rows]
        self.emb = np.vstack([np.frombuffer(r[5], dtype="float32") for r in rows])
        self.m = None

    def bm25(self, consulta, k):
        termos = re.findall(r"[\wÀ-ÿ]+", consulta.lower())
        if not termos:
            return []
        q = " OR ".join(f'"{t}"' for t in dict.fromkeys(termos))
        r = self.con.execute("SELECT rowid FROM fts WHERE fts MATCH ? ORDER BY bm25(fts) LIMIT ?", (q, k)).fetchall()
        return [x[0] - 1 for x in r]

    def vetor(self, consulta, k):
        if self.m is None:
            self.m = modelo()
        v = embed(self.m, [consulta])[0]
        return list(np.argsort(-(self.emb @ v))[:k])

    def rrf(self, consulta, k, fundo=50, c=60):
        pont = {}
        for lista in (self.bm25(consulta, fundo), self.vetor(consulta, fundo)):
            for r, i in enumerate(lista):
                pont[i] = pont.get(i, 0) + 1 / (c + r + 1)
        return [i for i, _ in sorted(pont.items(), key=lambda x: -x[1])[:k]]


RERANKER = "BAAI/bge-reranker-v2-m3-int8"
_rr = None


def pontuar(self, consulta, fundo=30):
    """Candidatos do híbrido RRF (top `fundo`) com a nota do cross-encoder multilíngue (com cache em disco)."""
    global _rr
    arq = LAKE / "indice" / "pontuacoes.json"
    if not hasattr(self, "_pc"):
        self._pc = json.load(open(arq, encoding="utf-8")) if arq.exists() else {}
    chave = f"{fundo}|{consulta}"
    if chave in self._pc:
        c = self._pc[chave]
        return c["cand"], c["sc"]
    if _rr is None:
        from fastembed.rerank.cross_encoder import TextCrossEncoder
        _rr = TextCrossEncoder(model_name=RERANKER, cache_dir=CACHE)
    cand = [int(i) for i in self.rrf(consulta, fundo)]
    sc = [float(x) for x in _rr.rerank(consulta, [self.meta[i][4] for i in cand])]
    self._pc[chave] = {"cand": cand, "sc": sc}
    arq.write_text(json.dumps(self._pc), encoding="utf-8")
    return cand, sc


def reranquear(self, consulta, k, fundo=30):
    """A4b: reordena o top-`fundo` do híbrido pela nota do cross-encoder e devolve os k melhores."""
    cand, sc = self.pontuar(consulta, fundo)
    return [cand[j] for j in sorted(range(len(cand)), key=lambda j: -sc[j])[:k]]


Indice.pontuar = pontuar
Indice.rerank = reranquear


def acerto_trecho(chunk, trecho):
    """O chunk traz o trecho-ouro (80% das palavras do trecho aparecem no chunk, em sequência de pelo menos 6)?"""
    pt, pc = re.findall(r"[\wÀ-ÿ]+", trecho.lower()), re.findall(r"[\wÀ-ÿ]+", chunk.lower())
    if len(pt) < 3:
        return norm(trecho).lower() in norm(chunk).lower()
    conjunto = set(pc)
    return sum(w in conjunto for w in pt) / len(pt) >= 0.8


def recall(ks):
    ix = Indice()
    perg = {p["qid"]: p for p in json.load(open(LAKE / "perguntas" / "perguntas.json", encoding="utf-8"))}
    gab = [g for g in json.load(open(E2 / "gabarito" / "rascunho.json", encoding="utf-8")) if g["fontes"]]
    metodos = {"bm25": ix.bm25, "vetor": ix.vetor, "hibrido_rrf": ix.rrf, "hibrido_rerank": ix.rerank}
    res = {}
    for nome, f in metodos.items():
        for k in ks:
            doc_any = doc_all = tr_any = tr_all = 0
            por_bloco = {"comum": [0, 0], "conflito": [0, 0]}
            for g in gab:
                idx = f(perg[g["qid"]]["pergunta"], k)
                docs = {ix.meta[i][1] for i in idx}
                textos = [ix.meta[i][4] for i in idx]
                ouro_docs = {s["doc"] for s in g["fontes"]}
                a = bool(docs & ouro_docs)
                tt = all(any(acerto_trecho(t, s["trecho"]) for t in textos) for s in g["fontes"])
                doc_any += a
                doc_all += ouro_docs <= docs
                tr_any += any(any(acerto_trecho(t, s["trecho"]) for t in textos) for s in g["fontes"])
                tr_all += tt
                por_bloco[g["bloco"]][1] += 1
                por_bloco[g["bloco"]][0] += tt
            n = len(gab)
            res[(nome, k)] = (doc_any / n, doc_all / n, tr_any / n, tr_all / n, por_bloco)
    print(f"{len(gab)} perguntas com ouro (comuns e conflito). recall = fração com o ouro entre os k chunks.")
    print("método       k   doc(algum) doc(todos) trecho(algum) trecho(todos)  trecho(todos) comum/conflito")
    for (nome, k), (da, dt, ta, tt, pb) in res.items():
        print(f"{nome:12s} {k:2d}   {da:8.2f}  {dt:9.2f}   {ta:11.2f}  {tt:12.2f}   {pb['comum'][0]}/{pb['comum'][1]}  {pb['conflito'][0]}/{pb['conflito'][1]}")
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build", "recall"])
    ap.add_argument("--k", type=int, nargs="+", default=[3, 5, 10, 15])
    a = ap.parse_args()
    build() if a.cmd == "build" else recall(a.k)
