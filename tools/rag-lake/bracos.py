#!/usr/bin/env python3
"""Braços A5 (lake curado), A6 (A5 com portão de abstenção) e controles N1, N1b, N2 do estudo 2.

Definições fixas (entram no pré-registro):
- Consulta de recuperação: só o texto da pergunta.
- A5: top-k trechos (base 'rerank' ou 'rrf', k=10) + top-3 cartões por similaridade vetorial. Regras de curadoria:
  (1) cartão substituído traz junto o cartão que o substitui, e o vigente traz o que ele substitui;
  (2) cada cartão mostra estado (vigente, substituída, contexto), quando vale e documentos-fonte;
  (3) trecho que contém o trecho-fonte de um cartão leva a etiqueta do cartão e do estado.
- A6: A5, mas se a nota máxima do reranker entre os 30 candidatos for menor que tau (lake/indice/gate.json,
  calibrado só nas 20 perguntas de calibração), responde "informação insuficiente" sem chamar o modelo.
- N1: 10 trechos sorteados (semente fixa por pergunta) de documentos fora dos documentos-ouro, no lugar da recuperação.
- N1b: N1 e depois os documentos-ouro inteiros (o ouro fica mais perto da pergunta).
- N2: documentos-ouro inteiros e depois 3 trechos de documentos de decisões substituídas (mais parecidos com a pergunta).
"""
import json, random, re
import numpy as np
import indice as ix

INSUF = "Informação insuficiente no material"
SEMENTE = 20261109


def norm(s):
    return re.sub(r"\s+", " ", s.replace("’", "'").replace("‘", "'")).strip().lower()


class Extras:
    def __init__(self, indice):
        self.ix = indice
        indice.vetor("aquecer", 1)
        self.m = indice.m
        self.cards = json.load(open(ix.LAKE / "curado" / "cartoes.json", encoding="utf-8"))
        self.por_id = {c["id"]: c for c in self.cards}
        self.subst_por = {}
        for c in self.cards:
            for o in c.get("substitui", []):
                self.subst_por.setdefault(o, []).append(c["id"])
        self.card_emb = ix.embed(self.m, [f"{c['decisao']} Vale quando: {c['vale_quando']}" for c in self.cards])
        self.trechos = [(c["id"], norm(f["trecho"])) for c in self.cards for f in c["fontes"]]
        self.docs_antigos = {f["doc"] for c in self.cards if c["status"] == "substituida" for f in c["fontes"]}
        self.manifest = {i["id"]: i for i in json.load(open(ix.LAKE / "manifesto-bruto.json", encoding="utf-8"))["itens"]}

    # ---- formatação
    def fmt_chunk(self, i, tag=""):
        m = self.ix.meta[i]
        return f"[{m[1]} | {m[2]}]{tag}\n{m[4]}"

    def doc_inteiro(self, d):
        it = self.manifest[d]
        return f"=== {d} | {it['path']} ===\n" + (ix.LAKE / "bruto" / it["path"]).read_text(encoding="utf-8")

    def fmt_card(self, c):
        docs = ", ".join(dict.fromkeys(f["doc"] for f in c["fontes"]))
        extra = ""
        if c["status"] == "substituida" and c["id"] in self.subst_por:
            extra = " Substituída por: " + ", ".join(self.subst_por[c["id"]]) + "."
        if c.get("substitui"):
            extra += " Substitui: " + ", ".join(c["substitui"]) + "."
        return f"[cartão {c['id']} | {c['status']}] {c['decisao']} (vale quando: {c['vale_quando']}; fontes: {docs}).{extra}"

    # ---- A5
    def cartoes_top(self, consulta, n=3):
        v = ix.embed(self.m, [consulta])[0]
        ids = [self.cards[j]["id"] for j in np.argsort(-(self.card_emb @ v))[:n]]
        mais = []
        for cid in ids:
            c = self.por_id[cid]
            if c["status"] == "substituida":
                mais += self.subst_por.get(cid, [])
            else:
                mais += c.get("substitui", [])
        return list(dict.fromkeys(ids + mais))

    def ctx_a5(self, consulta, k=10, base="rerank"):
        idx = self.ix.rerank(consulta, k) if base == "rerank" else self.ix.rrf(consulta, k)
        cartoes = [self.por_id[c] for c in self.cartoes_top(consulta)]
        partes = []
        for i in idx:
            t = norm(self.ix.meta[i][4])
            achados = [cid for cid, tr in self.trechos if tr and tr in t]
            tag = ""
            if achados:
                tag = " (contém decisão: " + ", ".join(f"{c} {self.por_id[c]['status']}" for c in dict.fromkeys(achados)) + ")"
            partes.append(self.fmt_chunk(i, tag))
        return "Decisões registradas (cartões):\n" + "\n".join(self.fmt_card(c) for c in cartoes) + "\n\nTrechos dos documentos:\n" + "\n\n".join(partes)

    def sinal(self, consulta):
        _, sc = self.ix.pontuar(consulta)
        return max(sc)

    # ---- controles
    def ruido(self, qid, ouro_docs, k=10):
        pool = [i for i, m in enumerate(self.ix.meta) if m[1] not in ouro_docs]
        rng = random.Random(f"{SEMENTE}-{qid}-ruido")
        return "\n\n".join(self.fmt_chunk(i) for i in rng.sample(pool, k))

    def antigos(self, consulta, ouro_docs, n=3):
        pool = [i for i, m in enumerate(self.ix.meta) if m[1] in self.docs_antigos and m[1] not in ouro_docs]
        v = ix.embed(self.m, [consulta])[0]
        pool.sort(key=lambda i: -float(self.ix.emb[i] @ v))
        return "\n\n".join(self.fmt_chunk(i) for i in pool[:n])
