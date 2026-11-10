#!/usr/bin/env python3
"""Confere os cartões de decisão do lake: cada trecho tem de existir literalmente no documento citado.

Uso: python tools/rag-lake/verificar_cartoes.py [--juntar]
  --juntar  grava lake/curado/cartoes.json só com os cartões aprovados (todos os trechos conferem,
            ids únicos, substituições apontando para cartões que existem).
"""
import json, re, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
LAKE = RAIZ / "studies" / "rag-data-lake-haiku" / "lake"


def norm(s):
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip()


def main():
    man = json.load(open(LAKE / "manifesto-bruto.json", encoding="utf-8"))
    por_id = {m["id"]: m for m in man["itens"]}
    texto = {}
    cartoes = []
    for f in sorted((LAKE / "curado").glob("cartoes-*.json")):
        if f.name == "cartoes.json":
            continue
        for c in json.load(open(f, encoding="utf-8")):
            c["_arquivo"] = f.name
            cartoes.append(c)
    ids = [c["id"] for c in cartoes]
    dup = {i for i in ids if ids.count(i) > 1}
    ok, falhas = [], []
    for c in cartoes:
        motivos = []
        if c["id"] in dup:
            motivos.append("id duplicado")
        if c.get("status") not in ("vigente", "substituida", "contexto"):
            motivos.append("status inválido")
        if not c.get("fontes"):
            motivos.append("sem fonte")
        for fo in c.get("fontes", []):
            m = por_id.get(fo.get("doc"))
            if not m:
                motivos.append(f"doc inexistente {fo.get('doc')}")
                continue
            if m["id"] not in texto:
                texto[m["id"]] = norm((LAKE / "bruto" / m["path"]).read_text(encoding="utf-8"))
            if len(fo.get("trecho", "")) > 300:
                motivos.append("trecho longo")
            if norm(fo.get("trecho", "")) not in texto[m["id"]]:
                motivos.append(f"trecho não encontrado em {fo['doc']}")
        for s in c.get("substitui", []):
            if s not in ids:
                motivos.append(f"substitui id inexistente {s}")
        (falhas if motivos else ok).append((c, motivos))
    print(f"cartões: {len(cartoes)}  conferem: {len(ok)}  com falha: {len(falhas)}")
    for c, m in falhas:
        print(" ", c["_arquivo"], c["id"], "|", "; ".join(m))
    pares = sum(1 for c, _ in ok if c.get("substitui"))
    print(f"cartões que substituem outro (entre os aprovados): {pares}")
    if "--juntar" in sys.argv:
        aprov = {c["id"] for c, _ in ok}
        saida = []
        for c, _ in ok:
            c = {k: v for k, v in c.items() if not k.startswith("_")}
            c["substitui"] = [s for s in c.get("substitui", []) if s in aprov]
            saida.append(c)
        (LAKE / "curado" / "cartoes.json").write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
        print("gravado lake/curado/cartoes.json com", len(saida))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
