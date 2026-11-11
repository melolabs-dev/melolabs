"""Compara violações do axe-core entre condições (T1/T2). Uso: python gerador/axe_analise.py"""
import json, collections, numpy as np
from scipy.stats import wilcoxon
D = collections.defaultdict(lambda: collections.defaultdict(list))
for m in ("haiku", "sonnet"):
    for r in json.load(open(f"dados/bruto/axe-{m}.json")):
        if "erro" not in r: D[(m, r["tarefa"], r["cond"])][r["id"]].append(r["violacoes"])
it = lambda k: {i: np.mean(v) for i, v in D[k].items()}
for t in ("T1", "T2"):
    for m in ("haiku", "sonnet"):
        print(t, m, {c: round(float(np.mean(list(it((m, t, c)).values()))), 2) for c in ("A0", "A1", "A2", "A3", "AC") if (m, t, c) in D})
def w(a, b, nome):
    ks = sorted(set(a) & set(b)); x = np.array([a[k] for k in ks]); y = np.array([b[k] for k in ks])
    p = wilcoxon(x, y, alternative="greater").pvalue if np.any(x != y) else 1
    print(f"{nome}: {x.mean():.2f} vs {y.mean():.2f}; p={p:.4f} n={len(ks)}")
w(it(("haiku", "T1", "A0")), it(("haiku", "T1", "A3")), "T1 Haiku A0 > A3")
w(it(("haiku", "T2", "A0")), it(("haiku", "T2", "A3")), "T2 Haiku A0 > A3")
w(it(("haiku", "T1", "A0")), it(("haiku", "T1", "A1")), "T1 Haiku A0 > A1")
w(it(("haiku", "T1", "AC")), it(("haiku", "T1", "A2")), "T1 Haiku AC > A2")
