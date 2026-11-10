#!/usr/bin/env python3
"""Monta e confere o banco de perguntas do estudo 2 a partir dos rascunhos em lake/perguntas/.

Confere: campos, contagens por bloco, trechos literais, cópia excessiva, equilíbrio de comprimento,
fontes proibidas. Gera (com --montar):
  lake/perguntas/perguntas.json                  qid opaco, pergunta, opções A a D (sem resposta, sem bloco)
  gabarito/rascunho.json (em studies/rag-data-lake-haiku)  resposta, bloco, fontes, justificativa
A opção "Informação insuficiente no material" é acrescentada aqui e as letras são embaralhadas com
semente fixa; os agentes nunca escolhem letras.
"""
import json, random, re, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
E2 = RAIZ / "studies" / "rag-data-lake-haiku"
LAKE = E2 / "lake"
SEMENTE = 20261109
INSUF = "Informação insuficiente no material"
ESPERADO = {"comum": 60, "conflito": 30, "sem_resposta": 30}
PROIBIDOS_DOC = {"doc-0056"}


def norm(s):
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip()


def palavras(s):
    return re.findall(r"[\wÀ-ÿ]+", s.lower())


def maior_sequencia_comum(a, b):
    """maior número de palavras seguidas comuns a duas listas de palavras"""
    melhor = 0
    pos = {}
    for j, w in enumerate(b):
        pos.setdefault(w, []).append(j)
    for i, w in enumerate(a):
        for j in pos.get(w, []):
            k = 0
            while i + k < len(a) and j + k < len(b) and a[i + k] == b[j + k]:
                k += 1
            melhor = max(melhor, k)
    return melhor


def main():
    man = json.load(open(LAKE / "manifesto-bruto.json", encoding="utf-8"))
    por_id = {m["id"]: m for m in man["itens"]}
    cartoes = {c["id"]: c for c in json.load(open(LAKE / "curado" / "cartoes.json", encoding="utf-8"))}
    texto = {}
    qs = []
    for f in sorted((LAKE / "perguntas").glob("rascunho-*.json")):
        for q in json.load(open(f, encoding="utf-8")):
            q["_arquivo"] = f.name
            qs.append(q)
    problemas = []

    def erro(q, msg):
        problemas.append((q.get("id", "?"), q["_arquivo"], msg))

    ids = [q.get("id") for q in qs]
    for q in qs:
        i = q.get("id")
        if ids.count(i) > 1:
            erro(q, "id duplicado")
        if q.get("bloco") not in ESPERADO:
            erro(q, "bloco inválido")
            continue
        op = q.get("opcoes") or []
        if len(op) != 3 or any(not isinstance(o, str) or not o.strip() for o in op):
            erro(q, "precisa de 3 opções de texto")
            continue
        if INSUF.lower()[:12] in " ".join(op).lower():
            erro(q, "opção 'insuficiente' escrita pelo agente")
        c = q.get("correta")
        if q["bloco"] == "sem_resposta":
            if c is not None or q.get("fontes"):
                erro(q, "sem_resposta deve ter correta null e fontes vazias")
        else:
            if c not in (0, 1, 2):
                erro(q, "correta inválida")
                continue
            if not q.get("fontes"):
                erro(q, "sem fontes")
        n_alt = len(q.get("alt_tipo") or [])
        if q["bloco"] == "conflito":
            if n_alt != 3 or "substituida" not in (q.get("alt_tipo") or []):
                erro(q, "conflito sem opção 'substituida'")
            elif (q["alt_tipo"][c] if c in (0, 1, 2) else "") == "substituida":
                erro(q, "a correta é a substituída")
            if len(q.get("fontes", [])) < 2:
                erro(q, "conflito precisa de 2 fontes")
        for fo in q.get("fontes", []):
            if fo.get("doc") in PROIBIDOS_DOC:
                erro(q, f"fonte proibida {fo['doc']}")
            m = por_id.get(fo.get("doc"))
            if not m:
                erro(q, f"doc inexistente {fo.get('doc')}")
                continue
            if m["id"] not in texto:
                texto[m["id"]] = norm((LAKE / "bruto" / m["path"]).read_text(encoding="utf-8"))
            if norm(fo.get("trecho", "")) not in texto[m["id"]]:
                erro(q, f"trecho não encontrado em {fo['doc']}")
            if len(fo.get("trecho", "")) > 300:
                erro(q, "trecho longo")
        for cid in q.get("cartoes", []):
            if cid not in cartoes:
                erro(q, f"cartão inexistente {cid}")
            elif "inferido" in (cartoes[cid]["motivo"] + cartoes[cid]["decisao"]).lower():
                erro(q, f"cartão inferido {cid}")
        # cópia e comprimento
        lens = [len(o) for o in op]
        if max(lens) > 1.4 * max(1, min(lens)):
            erro(q, f"comprimento desigual {lens}")
        if q["bloco"] != "sem_resposta" and c in (0, 1, 2):
            pw = palavras(q["pergunta"] + " " + op[c])
            for fo in q.get("fontes", []):
                k = maior_sequencia_comum(pw, palavras(fo.get("trecho", "")))
                if k > 6:
                    erro(q, f"cópia de {k} palavras seguidas do trecho")
    cont = {b: sum(1 for q in qs if q.get("bloco") == b) for b in ESPERADO}
    print("contagem por bloco:", cont, "(esperado", ESPERADO, ")")
    com = [q for q in qs if q.get("bloco") in ("comum", "conflito") and q.get("correta") in (0, 1, 2) and len(q.get("opcoes") or []) == 3]
    if com:
        mais_longa = sum(1 for q in com if len(q["opcoes"][q["correta"]]) == max(len(o) for o in q["opcoes"]))
        print(f"opção correta é a mais longa em {mais_longa}/{len(com)} ({100*mais_longa/len(com):.0f}%; acaso ~33%)")
    print("problemas:", len(problemas))
    for p in problemas:
        print(" ", *p, sep=" | ")
    if "--montar" in sys.argv:
        if problemas or cont != ESPERADO:
            print("não montado: resolva os problemas e as contagens")
            return 1
        rng = random.Random(SEMENTE)
        ordem = list(range(len(qs)))
        rng.shuffle(ordem)
        pergs, gab = [], []
        for n, idx in enumerate(ordem, 1):
            q = qs[idx]
            opcoes = list(q["opcoes"]) + [INSUF]
            alt = list(q.get("alt_tipo") or ["", "", ""]) + [""]
            correta = q["correta"] if q["correta"] is not None else 3
            perm = list(range(4))
            random.Random(f"{SEMENTE}-{q['id']}").shuffle(perm)
            letras = "ABCD"
            qid = f"q{n:03d}"
            pergs.append({"qid": qid, "pergunta": q["pergunta"], "opcoes": {letras[k]: opcoes[perm[k]] for k in range(4)}})
            gab.append({
                "qid": qid, "id_origem": q["id"], "bloco": q["bloco"],
                "correta": letras[perm.index(correta)],
                "letra_substituida": next((letras[k] for k in range(4) if alt[perm[k]] == "substituida"), None),
                "fontes": q.get("fontes", []), "cartoes": q.get("cartoes", []), "justificativa": q.get("justificativa", ""),
            })
        (LAKE / "perguntas" / "perguntas.json").write_text(json.dumps(pergs, ensure_ascii=False, indent=1), encoding="utf-8")
        (E2 / "gabarito").mkdir(exist_ok=True)
        (E2 / "gabarito" / "rascunho.json").write_text(json.dumps(gab, ensure_ascii=False, indent=1), encoding="utf-8")
        letras_c = {}
        for g in gab:
            letras_c[g["correta"]] = letras_c.get(g["correta"], 0) + 1
        print("montado:", len(pergs), "perguntas; distribuição da letra correta:", dict(sorted(letras_c.items())))
    return 1 if problemas else 0


if __name__ == "__main__":
    sys.exit(main())
