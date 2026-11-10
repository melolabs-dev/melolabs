#!/usr/bin/env python3
"""Análise do estudo 2 (roda sobre os .jsonl do executor). Regras fixas no pré-registro.

Uso: python tools/rag-lake/analisar.py ARQ1.jsonl [ARQ2.jsonl ...] [--sem-qids q001 ...] [--saida resultado.json]

- Voto por pergunta: maioria das amostras; empate vai para a menor letra.
- Acerto por bloco, intervalo de Wilson 95%, McNemar exato pareado entre braços.
- Custo nominal por chamada = tokens_entrada*r_in + tokens_saida*r_out, com r_in e r_out ajustados por mínimos
  quadrados nas chamadas dos braços fora do A2 (o A2 com cache leu o cache e não serve para o ajuste).
  Gasto real = custo_usd devolvido pelo claude -p.
- Custo por decisão correta = soma do custo nominal / soma das perguntas acertadas (voto), por braço.
- Hipóteses confirmatórias (Holm entre 6): p unilateral por bootstrap de perguntas (10.000 réplicas, semente fixa),
  p = fração das réplicas em que o critério falha. Exploratórias não entram no Holm.
"""
import argparse, json, math, random
from collections import Counter, defaultdict
from pathlib import Path


def carregar(arqs):
    R = []
    for a in arqs:
        for linha in open(a, encoding="utf-8"):
            r = json.loads(linha)
            if not r.get("erro") and r.get("letra"):
                R.append(r)
    return R


def voto(letras):
    c = Counter(letras)
    return sorted(c.items(), key=lambda x: (-x[1], x[0]))[0][0]


def wilson(k, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def mcnemar(a, b):
    q = [x for x in a if x in b]
    n01 = sum(1 for x in q if (not a[x]) and b[x])
    n10 = sum(1 for x in q if a[x] and not b[x])
    n = n01 + n10
    if n == 0:
        return 1.0, n01, n10
    k = min(n01, n10)
    p = min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)
    return p, n01, n10


# Preço efetivo a frio do `claude -p` (US$ por token), medido com chamadas de prefixo único (tools/rag-lake/medir_preco.py,
# dados em studies/rag-data-lake-haiku/piloto/preco-frio.jsonl): ajuste exato (erro < US$ 0,00001) em todos os pontos.
# Haiku: entrada 0,20 e saída 0,50 por milhão até ~43 mil tokens; 1,00 por milhão de entrada nos pedidos de 125 mil tokens
# ou mais (patamar longo; nenhum braço fica entre 43 e 125 mil). Sonnet: entrada 4,00 e saída 10,00 por milhão.
PRECO = {"haiku": {"in": 0.2e-6, "out": 0.5e-6, "in_longo": 1.0e-6, "limite": 100_000},
         "sonnet": {"in": 4.0e-6, "out": 10.0e-6, "in_longo": 4.0e-6, "limite": 10 ** 12}}


def ajustar_taxas(R):
    return PRECO


def _ajustar_taxas_antigo(R):
    taxas = {}
    for m in {r["modelo"] for r in R}:
        pts = [(r["tokens_entrada"], r["tokens_saida"], r["custo_usd"]) for r in R
               if r["modelo"] == m and r["braco"] != "A2" and r["tokens_entrada"] > 0]
        if len(pts) < 5:
            continue
        sxx = sum(x * x for x, _, _ in pts)
        sxy = sum(x * y for x, y, _ in pts)
        syy = sum(y * y for _, y, _ in pts)
        sxz = sum(x * z for x, _, z in pts)
        syz = sum(y * z for _, y, z in pts)
        det = sxx * syy - sxy * sxy
        if abs(det) < 1e-9:
            continue
        taxas[m] = ((sxz * syy - syz * sxy) / det, (syz * sxx - sxz * sxy) / det)
    return taxas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arqs", nargs="+")
    ap.add_argument("--saida")
    ap.add_argument("--sem-qids", nargs="*", default=[])
    ap.add_argument("--replicas", type=int, default=10000)
    a = ap.parse_args()
    excl = set(a.sem_qids)
    R = [r for r in carregar(a.arqs) if r["qid"] not in excl]
    taxas = ajustar_taxas(R)

    def nominal(m, x):
        if m in PRECO and x["tokens_entrada"] > 0:
            t = PRECO[m]
            ra = t["in_longo"] if x["tokens_entrada"] >= t["limite"] else t["in"]
            return x["tokens_entrada"] * ra + x["tokens_saida"] * t["out"]
        return 0.0  # A6 abstida pelo portão: nenhuma chamada

    por = defaultdict(list)
    for r in R:
        por[(r["modelo"], r["braco"], r["k"], r["qid"])].append(r)
    cel = {}
    for (m, b, k, q), rs in por.items():
        ok = voto([x["letra"] for x in rs]) == rs[0]["correta"]
        n = len(rs)
        cel.setdefault((m, b, k), {})[q] = {
            "ok": ok, "bloco": rs[0]["bloco"], "n": n,
            "nominal": sum(nominal(m, x) for x in rs) / n,
            "real": sum((x["custo_usd"] or 0) for x in rs) / n,
            "tok_in": sum(x["tokens_entrada"] for x in rs) / n,
            "tok_out": sum(x["tokens_saida"] for x in rs) / n}
    sai = {"taxas_usd_por_token": PRECO, "celulas": {}}
    print("(modelo, braço, k): acertos/n [Wilson] | comum conflito sem_resposta | tokens_in | US$ nominal/chamada | real/chamada | nominal por decisão correta")
    for key, d in sorted(cel.items()):
        n = len(d)
        k_ok = sum(v["ok"] for v in d.values())
        blocos = {b: (sum(v["ok"] for v in d.values() if v["bloco"] == b), sum(1 for v in d.values() if v["bloco"] == b))
                  for b in ("comum", "conflito", "sem_resposta")}
        nom = sum(v["nominal"] for v in d.values())
        real = sum(v["real"] for v in d.values())
        lo, hi = wilson(k_ok, n)
        linha = {"n": n, "acertos": k_ok, "wilson": [lo, hi], "blocos": blocos,
                 "tok_in": sum(v["tok_in"] for v in d.values()) / n, "nominal_chamada": nom / n,
                 "real_chamada": real / n, "nominal_por_correta": (nom / k_ok if k_ok else None)}
        sai["celulas"]["|".join(map(str, key))] = linha
        pc = round(linha["nominal_por_correta"], 5) if linha["nominal_por_correta"] else None
        print(key, f"{k_ok}/{n} [{lo:.2f},{hi:.2f}]", " ".join(f"{b[:3]}:{x}/{y}" for b, (x, y) in blocos.items()),
              f"tok {linha['tok_in']:.0f}", f"nom {nom / n:.5f}", f"real {real / n:.5f}", f"por_correta {pc}")

    rng = random.Random(20261109)

    def get(m, b, k=None):
        for (mm, bb, kk), d in cel.items():
            if mm == m and bb == b and (k is None or kk == k):
                return d
        return None

    resp = lambda d: {q: v for q, v in d.items() if v["bloco"] != "sem_resposta"}

    def boot(fun, qids):
        out = []
        for _ in range(a.replicas):
            amostra = [rng.choice(qids) for _ in qids]
            try:
                out.append(fun(amostra))
            except ZeroDivisionError:
                continue
        return out

    def ic(b):
        s = sorted(b)
        return [s[int(.025 * len(s))], s[int(.975 * len(s))]]

    acc = lambda d, s: sum(d[x]["ok"] for x in s) / len(s)
    cpc = lambda d, s: sum(d[x]["nominal"] for x in s) / max(1, sum(d[x]["ok"] for x in s))
    H = {}
    A0, A1, S1 = get("haiku", "A0"), get("haiku", "A1"), get("sonnet", "A1")
    rags = [d for (m, b, k), d in cel.items() if m == "haiku" and b in ("A3", "A4a", "A4b", "A5")]
    if A0 and A1:
        q = sorted(set(resp(A0)) & set(A1))
        f = lambda s: acc(A1, s) - acc(A0, s)
        b = boot(f, q)
        H["H1"] = {"estimativa": f(q), "criterio": ">= 0.25", "p": sum(1 for x in b if x < 0.25) / len(b), "ic95": ic(b), "n": len(q)}
    if A1 and S1:
        q = sorted(set(A1) & set(S1))
        f = lambda s: acc(A1, s) - acc(S1, s)
        b = boot(f, q)
        H["H2"] = {"estimativa": f(q), "criterio": "> -0.10", "p": sum(1 for x in b if x <= -0.10) / len(b), "ic95": ic(b), "n": len(q)}
    if A0 and A1 and rags:
        q = sorted(set(resp(A0)) & set(A1))

        def f3(s):
            cand = [d for d in rags if all(x in d for x in s)]
            melhor = max(acc(d, s) for d in cand)
            return min(1.0, (melhor - acc(A0, s)) / (acc(A1, s) - acc(A0, s)))
        q = [x for x in q if all(x in d for d in rags)] or q
        b = boot(f3, q)
        H["H3"] = {"estimativa": f3(q), "criterio": ">= 0.80 (melhor RAG escolhido dentro de cada réplica)", "p": sum(1 for x in b if x < 0.8) / len(b), "n": len(q)}
    if rags and S1:
        q = sorted(set(resp(rags[0])) & set(S1))

        def f9(s):
            cand = [d for d in rags if all(x in d for x in s)]
            melhor = max(cand, key=lambda d: acc(d, s))
            return min(acc(melhor, s) / acc(S1, s) / 0.9, 0.5 / (cpc(melhor, s) / cpc(S1, s)))
        b = boot(f9, q)
        H["H9"] = {"estimativa": f9(q), "criterio": ">= 1.0 (acerto >= 90% e custo por correta <= 50% do Sonnet+oráculo)", "p": sum(1 for x in b if x < 1.0) / len(b), "n": len(q)}
    A2, A5, A3 = get("haiku", "A2"), get("haiku", "A5"), get("haiku", "A3")
    if A2 and A5:
        q = sorted(set(A2) & set(A5))

        def f10a(s):
            dif = acc(A5, s) - acc(A2, s)
            return min(0.25 / (cpc(A5, s) / cpc(A2, s)), 1.0 if dif >= 0 else (dif + 0.10) / 0.10)
        b = boot(f10a, q)
        H["H10a"] = {"estimativa": f10a(q), "criterio": ">= 1 (custo A5 <= 25% do A2 e acerto A5 >= A2 - 10 pp)", "p": sum(1 for x in b if x < 1.0) / len(b), "n": len(q)}
    if A5 and A3:
        q = sorted(set(A5) & set(A3))
        f = lambda s: cpc(A5, s) - cpc(A3, s)
        b = boot(f, q)
        H["H10b"] = {"estimativa": f(q), "criterio": "< 0 (IC95 inteiro abaixo de zero)", "p": sum(1 for x in b if x >= 0) / len(b), "ic95": ic(b), "n": len(q)}
    ps = sorted((v["p"], k) for k, v in H.items())
    m, maxp = len(ps), 0.0
    ajust = {}
    for i, (p, k) in enumerate(ps):
        maxp = max(maxp, min(1.0, (m - i) * p))
        ajust[k] = maxp
    for k, v in H.items():
        v["p_holm"] = ajust[k]
        v["apoiada"] = bool(v["p_holm"] < 0.05)
    sai["hipoteses"] = H
    print("\nHipóteses confirmatórias (Holm):")
    for k, v in H.items():
        print(k, json.dumps(v, ensure_ascii=False))
    sai["mcnemar"] = {}
    chaves = [k for k in cel if k[0] == "haiku"]
    for i, k1 in enumerate(chaves):
        for k2 in chaves[i + 1:]:
            p, n01, n10 = mcnemar({q: v["ok"] for q, v in cel[k1].items()}, {q: v["ok"] for q, v in cel[k2].items()})
            sai["mcnemar"]["|".join(map(str, k1)) + " x " + "|".join(map(str, k2))] = {"p": p, "so_no_segundo": n01, "so_no_primeiro": n10}
    if a.saida:
        Path(a.saida).write_text(json.dumps(sai, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
