"""Análise pré-registrada (Haiku e Sonnet). Uso: python analise.py > dados/analise.txt
Itens = estímulos (média das 3 amostras por item). Testes pareados de Wilcoxon, IC95 por bootstrap de itens (10.000), Holm em H1-H7."""
import json, collections, sys, io
import numpy as np
from scipy.stats import wilcoxon, mannwhitneyu
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
PRECO = {"haiku": (0.10, 0.50, 0.01), "sonnet": (2.0, 10.0, 0.10)}
rng = np.random.default_rng(20261110)
CAT = {x["id"]: x["categoria"] for x in json.load(open("dados/estimulos/t3.json", encoding="utf-8"))}


def cust(r):
    pi, po, pc = PRECO[r["modelo"]]
    return sum((c["in"] + 1.25 * c["cache_w"]) * pi / 1e6 + c["cache_r"] * pc / 1e6 + c["out"] * po / 1e6 for c in r["chamadas"])


R = []
for m in ("haiku", "sonnet"):
    for l in open(f"dados/bruto/principal-{m}-p.jsonl", encoding="utf-8"):
        r = json.loads(l)
        if "erro" in r: continue
        t = r["tarefa"]
        if t == "T1": s = (r["n_regras"] - r["n_falhas"]) / r["n_regras"]
        elif t == "T2": s = max(0, min(1, (r["removidos"] - r["introduzidos"]) / r["n_defeitos"]))
        elif r["n_chave"] == 0: s = 1.0 if r["n_resposta"] == 0 else 0.0
        else: s = 2 * r["acertos"] / (r["n_chave"] + r["n_resposta"]) if (r["n_chave"] + r["n_resposta"]) else 0.0
        R.append({"m": m, "t": t, "c": r["cond"], "id": r["id"], "s": s, "usd": cust(r), "seg_kit": r.get("kit_seg", 0),
                  "recall": (r["acertos"] / r["n_chave"]) if t == "T3" and r["n_chave"] else None,
                  "alarme": (1.0 if r["alarmes_falsos"] > 0 else 0.0) if t == "T3" else None,
                  "introd": r.get("introduzidos"), "cat": CAT.get(r["id"]), "json_ok": r.get("json_ok")})


def por_item(m, t, c, campo="s", filtro=None):
    d = collections.defaultdict(list)
    for r in R:
        if r["m"] == m and r["t"] == t and r["c"] == c and r[campo] is not None and (filtro is None or filtro(r)): d[r["id"]].append(r[campo])
    return {k: float(np.mean(v)) for k, v in d.items()}


def comp(a, b):  # dicionários id->valor, retorna arrays pareados
    ks = sorted(set(a) & set(b)); return np.array([a[k] for k in ks]), np.array([b[k] for k in ks])


def boot(x, y):
    d = x - y; bs = [rng.choice(d, len(d)).mean() for _ in range(10000)]; return d.mean(), np.percentile(bs, 2.5), np.percentile(bs, 97.5)


def teste(nome, a, b, maior="a"):
    x, y = comp(a, b)
    m, lo, hi = boot(x, y)
    try: p = wilcoxon(x, y, alternative="greater" if maior == "a" else "two-sided").pvalue if np.any(x != y) else 1.0
    except ValueError: p = 1.0
    print(f"  {nome}: n={len(x)} média {x.mean():.3f} vs {y.mean():.3f}; diferença {m:+.3f} IC95 [{lo:+.3f},{hi:+.3f}]; p={p:.4f}")
    return nome, p, m


print("=== Médias por modelo, tarefa e condição (pontuação 0 a 1) e custo nominal por tarefa (US$) ===")
for t in ("T1", "T2", "T3"):
    for m in ("haiku", "sonnet"):
        for c in ("A0", "A1", "A2", "A3", "AC"):
            it = por_item(m, t, c)
            if not it: continue
            cs = [r["usd"] for r in R if r["m"] == m and r["t"] == t and r["c"] == c]
            print(f"{t} {m:6s} {c}: score {np.mean(list(it.values())):.3f} (n itens {len(it)}); custo médio/tarefa US${np.mean(cs):.4f}")

print("\n=== Hipóteses confirmatórias (p unilateral de Wilcoxon, depois Holm) ===")
P = []
P.append(teste("H1 T3 recall Haiku A2>A0 (pares com diferença)", por_item("haiku", "T3", "A2", "recall"), por_item("haiku", "T3", "A0", "recall")))
ru = lambda r: CAT[r["id"]] in ("ruido", "identico")
a2 = por_item("haiku", "T3", "A2", "alarme", ru); a0 = por_item("haiku", "T3", "A0", "alarme", ru)
P.append(teste("H2 T3 alarme falso (ruído+idêntico) Haiku A0>A2 [menor é melhor]", a0, a2))
P.append(teste("H3 T2 Haiku A3>A0", por_item("haiku", "T2", "A3"), por_item("haiku", "T2", "A0")))
P.append(teste("H3b T2 Haiku A3 menos defeitos novos que A0", por_item("haiku", "T2", "A0", "introd"), por_item("haiku", "T2", "A3", "introd")))
P.append(teste("H4 T1 Haiku A3>A0", por_item("haiku", "T1", "A3"), por_item("haiku", "T1", "A0")))
# H5: ganho de A3 sobre A0 maior no Haiku que no Sonnet (diferença de ganhos por item)
for t in ("T1", "T2", "T3"):
    gh = {k: v for k, v in zip(sorted(por_item("haiku", t, "A3")), comp(por_item("haiku", t, "A3"), por_item("haiku", t, "A0"))[0] - comp(por_item("haiku", t, "A3"), por_item("haiku", t, "A0"))[1])}
    gs = {k: v for k, v in zip(sorted(por_item("sonnet", t, "A3")), comp(por_item("sonnet", t, "A3"), por_item("sonnet", t, "A0"))[0] - comp(por_item("sonnet", t, "A3"), por_item("sonnet", t, "A0"))[1])}
    P.append(teste(f"H5 {t} ganho(A3-A0) Haiku > Sonnet", gh, gs))
P.append(teste("H6 T1 Haiku A2>AC", por_item("haiku", "T1", "A2"), por_item("haiku", "T1", "AC")))
P.append(teste("H7a T1 Haiku A1>A0", por_item("haiku", "T1", "A1"), por_item("haiku", "T1", "A0")))
P.append(teste("H7b T2 Haiku A1>A0", por_item("haiku", "T2", "A1"), por_item("haiku", "T2", "A0")))
P.append(teste("H7c T3 Haiku A2>A1", por_item("haiku", "T3", "A2"), por_item("haiku", "T3", "A1")))
ps = sorted(P, key=lambda x: x[1]); m = len(ps); print("\nHolm (alfa 0,05):")
bloq = False
for i, (n, p, d) in enumerate(ps):
    lim = 0.05 / (m - i); ok = (p <= lim) and not bloq; bloq = bloq or not ok
    print(f"  {'REJEITA H0' if ok else 'não rejeita'} | p={p:.4f} limiar={lim:.4f} | {n}")

print("\n=== H9: Haiku A3 vs Sonnet A0 (acurácia combinada = média de T1, T2, T3; custo por tarefa) ===")
def comb(m, c): return np.mean([np.mean(list(por_item(m, t, c).values())) for t in ("T1", "T2", "T3")])
def custo(m, c): return np.mean([np.mean([r["usd"] for r in R if r["m"] == m and r["t"] == t and r["c"] == c]) for t in ("T1", "T2", "T3")])
for c in ("A0", "A1", "A2", "A3"):
    print(f"  Haiku {c}: acurácia {comb('haiku', c):.3f}, custo médio/tarefa US${custo('haiku', c):.4f} | Sonnet {c}: {comb('sonnet', c):.3f}, US${custo('sonnet', c):.4f}")
ac_h, ac_s = comb("haiku", "A3"), comb("sonnet", "A0"); cu_h, cu_s = custo("haiku", "A3"), custo("sonnet", "A0")
print(f"  Razão de acurácia Haiku A3 / Sonnet A0 = {ac_h/ac_s:.3f} (critério >= 0,90); razão de custo = {cu_h/cu_s:.3f} (critério <= 0,50)")
print("  H9 (com Sonnet apenas; Opus fora por custo):", "SUPORTADA" if ac_h / ac_s >= .9 and cu_h / cu_s <= .5 else "NÃO SUPORTADA")

print("\n=== H10 descritiva: T3 por categoria (F1 médio por item) ===")
for cat in ("css", "conteudo", "fluxo", "composto", "ruido", "identico"):
    linha = []
    for m in ("haiku", "sonnet"):
        for c in ("A0", "A1", "A2", "A3"):
            it = por_item(m, "T3", c, "s", lambda r, cat=cat: r["cat"] == cat); linha.append(f"{m[0].upper()}{c[1]}={np.mean(list(it.values())):.2f}")
    print(f"  {cat:9s}", " ".join(linha))
print("\nJSON válido no T3:", {m: round(np.mean([r["json_ok"] for r in R if r["m"] == m and r["t"] == "T3"]), 3) for m in ("haiku", "sonnet")})
print("Custo nominal total (Haiku+Sonnet) US$", round(sum(r["usd"] for r in R), 2))
