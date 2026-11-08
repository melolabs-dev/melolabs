#!/usr/bin/env python3
"""Figuras e tabelas do artigo, geradas só a partir dos dados (passo F9.2). Todo número do texto vem destas saídas.

Uso: python -I analise/figuras.py   -> dados/processado/{tabela-*.csv, fig-*.svg} e cópia das figuras em assets/haiku-sdd-producao/
"""
import csv
import json
import shutil
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

sys.argv.append("--estendida")  # usa o conjunto estendido (adendo 2b)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analise as A  # noqa: E402

PROC = A.PROC
ASSETS = A.ROOT.parents[1] / "assets" / "haiku-sdd-producao"
NOMES = {"C0": "Sonnet\npadrão", "C1": "Haiku\nsimples", "C4": "Haiku +\ntestes + loop", "C5": "Cascata", "C6": "Híbrido",
         "C2": "Gate +\nloop", "C2n": "Autorrevisão", "C10": "Persona", "C11": "Contexto", "C12": "Persona +\ncontexto", "C13": "Controle de\ntamanho"}
COR = {"C0": "#2f4b7c", "C1": "#d9822b", "C4": "#2b8a6e", "C5": "#6d6d6d", "C6": "#8a5a9e"}
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#555", "axes.labelcolor": "#222", "xtick.color": "#222", "ytick.color": "#222", "svg.fonttype": "none"})


def salva(fig, nome):
    p = PROC / nome
    fig.savefig(p, format="svg", bbox_inches="tight")
    fig.savefig(PROC / nome.replace(".svg", ".png"), format="png", dpi=130, bbox_inches="tight", facecolor="white")
    ASSETS.mkdir(parents=True, exist_ok=True)
    shutil.copy(p, ASSETS / nome)
    shutil.copy(PROC / nome.replace(".svg", ".png"), ASSETS / nome.replace(".svg", ".png"))
    plt.close(fig)


def main():
    runs = A.carrega()
    art = A.carrega_rubrica()
    cond = ["C0", "C1", "C4", "C5", "C6", "C2", "C2n", "C10", "C11", "C12", "C13"]

    # tabela 1: por condição
    linhas = []
    for c in cond:
        rs = [r for r in runs.values() if r["cond"] == c]
        k = sum(r["nucleo_100"] for r in rs)
        lo, hi = A.wilson(k, len(rs), 1.96)
        linhas.append({"condicao": c, "n": len(rs), "nucleo_100": k, "taxa": round(k / len(rs), 4), "wilson_lo": round(lo, 4), "wilson_hi": round(hi, 4),
                       "fracao_testes": round(st.mean(r["frac"] for r in rs), 4), "custo_lista_usd": round(st.mean(r["custo"] for r in rs), 4),
                       "tokens_totais": round(st.mean(r["tok"] for r in rs)), "tokens_novos": round(st.mean(r["novos"] for r in rs))})
    with open(PROC / "tabela-condicoes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0]))
        w.writeheader()
        w.writerows(linhas)

    # tabela 2: núcleo por variante e condição (C0, C1, C4)
    pv = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for r in runs.values():
        if r["cond"] in ("C0", "C1", "C4"):
            pv[r["var"]][r["cond"]][0] += r["nucleo_100"]
            pv[r["var"]][r["cond"]][1] += 1
    with open(PROC / "tabela-variantes.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["variante", "C0_acertos", "C0_n", "C1_acertos", "C1_n", "C4_acertos", "C4_n"])
        for v in sorted(pv):
            w.writerow([v] + [x for c in ("C0", "C1", "C4") for x in pv[v][c]])

    # tabela 3: rubrica por condição e tipo (média ± erro-padrão por artefato)
    linhas_r = []
    for tipo in ("techspec", "tasks"):
        for c in cond:
            v = [a["soma"] for (rid, t), a in art.items() if t == tipo and a["cond"] == c]
            if v:
                linhas_r.append({"tipo": tipo, "condicao": c, "n": len(v), "media": round(st.mean(v), 2), "erro_padrao": round(st.stdev(v) / len(v) ** 0.5, 2) if len(v) > 1 else None,
                                 "maximo": 35 if tipo == "techspec" else 25})
    with open(PROC / "tabela-rubrica.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas_r[0]))
        w.writeheader()
        w.writerows(linhas_r)

    # figura 1: núcleo 100% (C0, C1, C4) no geral e por variante
    fig, axs = plt.subplots(1, 2, figsize=(11, 4), gridspec_kw={"width_ratios": [1, 2.6]})
    ax = axs[0]
    for i, c in enumerate(["C0", "C1", "C4"]):
        l = next(x for x in linhas if x["condicao"] == c)
        ax.bar(i, l["taxa"] * 100, color=COR[c], width=0.6)
        ax.errorbar(i, l["taxa"] * 100, yerr=[[l["taxa"] * 100 - l["wilson_lo"] * 100], [l["wilson_hi"] * 100 - l["taxa"] * 100]], color="#222", capsize=3)
        ax.text(i, 3, f'{l["nucleo_100"]}/{l["n"]}', ha="center", color="white", fontsize=9)
    ax.set_xticks(range(3), [NOMES[c] for c in ("C0", "C1", "C4")])
    ax.set_ylabel("execuções com núcleo 100% (%)")
    ax.set_ylim(0, 105)
    ax.set_title("Todas as variantes (IC 95% de Wilson)", fontsize=10, loc="left")
    ax = axs[1]
    vs = sorted(pv)
    for j, c in enumerate(["C0", "C1", "C4"]):
        xs = [i + (j - 1) * 0.27 for i in range(len(vs))]
        ys = [100 * pv[v][c][0] / pv[v][c][1] for v in vs]
        ax.bar(xs, ys, width=0.26, color=COR[c], label=NOMES[c].replace("\n", " "))
        for x, y, v in zip(xs, ys, vs):
            ax.text(x, y + 1.5, f"{pv[v][c][0]}/{pv[v][c][1]}", ha="center", fontsize=6.5, color="#333")
    ax.set_xticks(range(len(vs)), [v.replace("problem-", "#").replace("range-", "#").replace("session-", "#") for v in vs], rotation=0, fontsize=8)
    ax.set_ylim(0, 112)
    ax.legend(frameon=False, fontsize=8, loc="upper center", ncol=3, bbox_to_anchor=(0.5, 1.0))
    ax.set_title("Por variante de tarefa (acertos/execuções)", fontsize=10, loc="left")
    fig.tight_layout()
    salva(fig, "fig-nucleo.svg")

    # figura 2: custo de lista e tokens relativos ao Sonnet
    ref = next(x for x in linhas if x["condicao"] == "C0")
    fig, axs = plt.subplots(1, 2, figsize=(10, 3.8))
    for ax, chave, titulo in ((axs[0], "custo_lista_usd", "Custo de lista (Sonnet = 1)"), (axs[1], "tokens_totais", "Tokens totais (Sonnet = 1)")):
        cs = ["C0", "C1", "C4", "C5"]
        vals = [next(x for x in linhas if x["condicao"] == c)[chave] / ref[chave] for c in cs]
        ax.bar(range(len(cs)), vals, color=[COR[c] for c in cs], width=0.6)
        for i, v in enumerate(vals):
            ax.text(i, v + 0.02 * max(vals), f"{v:.2f}", ha="center", fontsize=9)
        ax.set_xticks(range(len(cs)), [NOMES[c] for c in cs], fontsize=8)
        ax.set_title(titulo, fontsize=10, loc="left")
    fig.tight_layout()
    salva(fig, "fig-custo.svg")

    # figura 3: rubrica por condição, gráfico de pontos (posição, não comprimento) com eixo truncado declarado
    curto = {"C0": "Sonnet", "C1": "Haiku\nsimples", "C4": "Haiku +\ntestes", "C5": "Cascata", "C6": "Híbrido", "C10": "Persona",
             "C11": "Contexto", "C12": "Pers. +\ncont.", "C13": "Controle"}
    fig, axs = plt.subplots(1, 2, figsize=(11, 4))
    for ax, tipo, mx in ((axs[0], "techspec", 35), (axs[1], "tasks", 25)):
        ls = [x for x in linhas_r if x["tipo"] == tipo and x["condicao"] in curto]
        ax.errorbar(range(len(ls)), [x["media"] for x in ls], yerr=[x["erro_padrao"] or 0 for x in ls], fmt="none", ecolor="#222", capsize=3, zorder=3)
        for i, x in enumerate(ls):
            ax.plot(i, x["media"], "o", color=COR.get(x["condicao"], "#9a9a9a"), markersize=9, zorder=4)
        ax.set_xticks(range(len(ls)), [curto[x["condicao"]] for x in ls], fontsize=7.5)
        ax.set_ylim(mx * 0.78, mx)
        ax.set_ylabel(f"nota (máx. {mx}); eixo truncado")
        ax.set_title(f"{'TechSpec' if tipo == 'techspec' else 'Tasks'}: média ± erro-padrão", fontsize=10, loc="left")
        ax.axhline(mx, color="#bbb", lw=0.6)
    fig.tight_layout()
    salva(fig, "fig-rubrica.svg")
    print("figuras e tabelas geradas em", PROC)


if __name__ == "__main__":
    main()
