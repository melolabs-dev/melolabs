#!/usr/bin/env python3
"""Compara as respostas da revisão cega (lake/revisao/saida-*.json) com o gabarito rascunho.

Saída: concordância por bloco, lista de discordâncias e de marcações de ambiguidade ou resposta parcial.
Grava lake/revisao/comparacao.json. Não altera o gabarito.
"""
import json, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
E2 = RAIZ / "studies" / "rag-data-lake-haiku"


def main():
    gab = {g["qid"]: g for g in json.load(open(E2 / "gabarito" / "rascunho.json", encoding="utf-8"))}
    perg = {p["qid"]: p for p in json.load(open(E2 / "lake" / "perguntas" / "perguntas.json", encoding="utf-8"))}
    resp = {}
    for f in sorted((E2 / "lake" / "revisao").glob("saida-*.json")):
        for r in json.load(open(f, encoding="utf-8")):
            resp[r["qid"]] = r
    falta = [q for q in gab if q not in resp]
    por_bloco = {}
    disc, amb = [], []
    for qid, g in gab.items():
        r = resp.get(qid)
        if not r:
            continue
        b = por_bloco.setdefault(g["bloco"], [0, 0])
        b[1] += 1
        if r["resposta"] == g["correta"]:
            b[0] += 1
        else:
            disc.append({"qid": qid, "id_origem": g["id_origem"], "bloco": g["bloco"], "gabarito": g["correta"],
                         "revisor": r["resposta"], "confianca": r.get("confianca"), "nota": r.get("nota", ""),
                         "arquivos": r.get("arquivos", []), "trecho": r.get("trecho", "")})
        if r.get("ambigua") or r.get("parcial"):
            amb.append({"qid": qid, "id_origem": g["id_origem"], "bloco": g["bloco"], "ambigua": r.get("ambigua"),
                        "parcial": r.get("parcial"), "nota": r.get("nota", ""), "concorda": r["resposta"] == g["correta"]})
    total = sum(v[1] for v in por_bloco.values())
    ok = sum(v[0] for v in por_bloco.values())
    print(f"respondidas: {total} de {len(gab)}  faltam: {len(falta)}")
    print(f"concordância geral: {ok}/{total}" + (f" ({100*ok/total:.0f}%)" if total else ""))
    for b, (a, n) in sorted(por_bloco.items()):
        print(f"  {b}: {a}/{n}")
    print(f"discordâncias: {len(disc)}  ambíguas ou parciais: {len(amb)}")
    saida = {"concordancia": {b: v for b, v in por_bloco.items()}, "discordancias": disc, "ambiguas_parciais": amb, "faltam": falta}
    (E2 / "lake" / "revisao" / "comparacao.json").write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    for d in disc:
        print(" DISC", d["id_origem"], d["bloco"], "gab", d["gabarito"], "rev", d["revisor"], "conf", d["confianca"], "|", (d["nota"] or "")[:110])
    for a in amb:
        print(" AMB ", a["id_origem"], a["bloco"], "ambigua" if a["ambigua"] else "parcial", "concorda" if a["concorda"] else "DISCORDA", "|", (a["nota"] or "")[:110])


if __name__ == "__main__":
    sys.exit(main())
